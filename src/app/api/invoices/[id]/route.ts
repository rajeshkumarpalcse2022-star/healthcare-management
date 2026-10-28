import { NextResponse } from "next/server";

import { INVOICE_TRANSITIONS } from "@/config/billing";
import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase, runInTransaction } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { money } from "@/lib/billing/money";
import { appendPaymentEvent } from "@/lib/billing/events";
import {
  toInvoiceDto,
  toInvoiceEventDto,
  type PaymentShape,
} from "@/lib/billing/dto";
import { Invoice, type InvoiceDocument } from "@/models/Invoice";
import { Payment } from "@/models/Payment";
import { PaymentEvent } from "@/models/PaymentEvent";
import { netPaid, outstandingBalance } from "@/lib/billing/balance";
import { toFieldIssues } from "@/lib/validation/common";
import {
  invoiceIdSchema,
  invoiceUpdateSchema,
} from "@/lib/validation/billing";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Roles that may READ invoices (PATIENT gets own-only below). */
const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
] as const;

/** Roles that may edit / issue / void invoices. */
const WRITE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

const STAFF_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/**
 * Loads an invoice with its payments, enforcing read authorization:
 * PATIENT owner-only, staff laboratory-scoped (out-of-scope -> null -> 404).
 * `includeInternal` decides whether notes/actor keys exist on the DTO at all.
 */
async function loadInvoiceScoped(
  id: string,
  user: SafeUser,
): Promise<{
  invoice: InvoiceDocument;
  payments: PaymentShape[];
  includeInternal: boolean;
} | null> {
  const invoice = await Invoice.findById(id);
  if (!invoice) return null;

  const includeInternal = STAFF_ROLES.includes(user.role);
  if (includeInternal) {
    if (!isLaboratoryInScope(user, String(invoice.laboratoryId))) return null;
  } else if (String(invoice.patientId) !== user.id) {
    return null;
  }

  const payments = await Payment.find({ invoiceId: invoice._id })
    .sort({ createdAt: 1 })
    .lean();
  return { invoice, payments, includeInternal };
}

/**
 * GET /api/invoices/[id]
 *
 * Full invoice detail. PATIENT sees only its own invoice (else 404) with
 * internal keys stripped; staff see laboratory-scoped invoices (cross-lab
 * -> 404) including notes, payment memos, actor ids and the append-only
 * event timeline. Balances are always recomputed from the ledger.
 *
 * Self-healing read: when a non-transactional payment commit crashed between
 * the payment insert and the settlement update, the ledger shows ISSUED with
 * zero balance - the next read repairs the stored status (and appends the
 * settlement event) instead of surfacing the stale state forever.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = invoiceIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(404, "Invoice not found.");
  }

  try {
    await connectToDatabase();

    const loaded = await loadInvoiceScoped(parsedId.data.id, user);
    if (!loaded) return errorResponse(404, "Invoice not found.");

    const { invoice, payments, includeInternal } = loaded;
    const balance = outstandingBalance(invoice.totalAmount, payments);
    const net = netPaid(payments);

    if (
      invoice.status === "ISSUED" &&
      balance === 0 &&
      net > 0 &&
      invoice.totalAmount > 0
    ) {
      // Crash-recovery: settle retroactively (transaction path normally does
      // this; the fallback path self-heals here on the next read).
      invoice.status = "PAID";
      if (includeInternal) {
        const updated = await Invoice.updateOne(
          { _id: invoice._id, status: "ISSUED" },
          { $set: { status: "PAID" } },
        );
        if (updated.modifiedCount === 1) {
          await appendPaymentEvent({
            invoiceId: String(invoice._id),
            action: "INVOICE_SETTLED",
            fromStatus: "ISSUED",
            toStatus: "PAID",
            actorId: String(invoice.createdBy),
            metadata: { total: invoice.totalAmount },
          });
        }
      }
    }

    const dto = toInvoiceDto(invoice, payments, includeInternal);

    if (includeInternal) {
      const events = await PaymentEvent.find({ invoiceId: invoice._id })
        .sort({ createdAt: 1 })
        .populate("actorId", "name")
        .lean();
      dto.events = events.map((event) =>
        toInvoiceEventDto(
          event,
          event.actorId !== null &&
            typeof event.actorId === "object" &&
            "name" in event.actorId
            ? String((event.actorId as { name: unknown }).name)
            : null,
        ),
      );
    }

    return itemResponse(dto);
  } catch (error) {
    logApiFailure("invoices/[id]", error);
    return errorResponse(
      503,
      "Unable to load the invoice right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/invoices/[id]
 *
 * Three server-enforced operations, all guarded so a stale client can never
 * double-apply a transition (optimistic `status` filters; conflicts -> 409):
 * - DRAFT field edits (items/notes) with server-side total recomputation;
 * - DRAFT -> ISSUED (explicit issue action, optionally alongside edits);
 * - DRAFT/ISSUED/PAID -> VOID with a required reason; any non-zero payment
 *   ledger requires refunds first (answered with a specific 400 message).
 *   VOID clears `activeSourceKey` so the
 *   source becomes invoicable again while the void row keeps its history.
 *
 * Payment-ledger reads for the VOID branch participate in the caller's
 * transaction when the deployment supports one (see `runInTransaction`),
 * so a concurrent payment cannot slip in between check and commit.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = invoiceIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(404, "Invoice not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = invoiceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the invoice changes and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;
  if (
    input.items === undefined &&
    input.notes === undefined &&
    input.status === undefined
  ) {
    return errorResponse(400, "Provide at least one field to update.");
  }

  try {
    await connectToDatabase();

    const invoice = await Invoice.findById(parsedId.data.id);
    if (!invoice) return errorResponse(404, "Invoice not found.");
    if (!isLaboratoryInScope(user, String(invoice.laboratoryId))) {
      return errorResponse(404, "Invoice not found.");
    }

    const currentStatus = invoice.status;

    // --- field edits (DRAFT only) -----------------------------------------
    if (input.items !== undefined || input.notes !== undefined) {
      if (input.status === undefined && currentStatus !== "DRAFT") {
        return errorResponse(400, "Only draft invoices can be edited.");
      }
    }

    const $set: Record<string, unknown> = {};
    let editedSubtotal: number | null = null;
    if (input.items !== undefined && currentStatus === "DRAFT") {
      const lineTotals = input.items.map((item) =>
        money(item.unitPrice * item.quantity),
      );
      editedSubtotal = money(
        lineTotals.reduce((sum, value) => sum + value, 0),
      );
      $set.items = input.items.map((item, index) => ({
        labTestId: item.labTestId ?? null,
        description: item.description,
        unitPrice: money(item.unitPrice),
        quantity: item.quantity,
        lineTotal: lineTotals[index],
      }));
      $set.subtotal = editedSubtotal;
      $set.totalAmount = editedSubtotal;
    }
    if (input.notes !== undefined) $set.notes = input.notes;

    // --- no transition requested: plain DRAFT edit ------------------------
    if (input.status === undefined) {
      if (Object.keys($set).length === 0) {
        return errorResponse(400, "Provide at least one field to update.");
      }
      const updated = await Invoice.findOneAndUpdate(
        { _id: invoice._id, status: "DRAFT" },
        $set,
        { new: true },
      );
      if (!updated) {
        return errorResponse(409, "This invoice changed - reload and retry.");
      }
      await appendPaymentEvent({
        invoiceId: String(invoice._id),
        action: "INVOICE_UPDATED",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        actorId: user.id,
        ...(editedSubtotal !== null ? { metadata: { total: editedSubtotal } } : {}),
      });
      const payments = await Payment.find({ invoiceId: invoice._id })
        .sort({ createdAt: 1 })
        .lean();
      return itemResponse(toInvoiceDto(updated, payments, true));
    }

    const target = input.status;
    // PAID -> VOID is not a client transition (step9 pins PAID: []), but it
    // is the legitimate path after refunds; let the ledger check below reply
    // with the specific refunds-first message instead of the generic one.
    const paidVoid = target === "VOID" && currentStatus === "PAID";
    if (!INVOICE_TRANSITIONS[currentStatus].includes(target) && !paidVoid) {
      return errorResponse(
        400,
        target === "VOID"
          ? "This invoice cannot be voided in its current status."
          : "This invoice cannot be issued from its current status.",
      );
    }

    // --- VOID --------------------------------------------------------------
    if (target === "VOID") {
      const reason = input.voidReason ?? null;
      const result = await runInTransaction(async (session) => {
        const payments = await Payment.find({ invoiceId: invoice._id })
          .session(session)
          .sort({ createdAt: 1 })
          .lean();
        const net = netPaid(payments);
        if (net !== 0) {
          return { ok: false as const, code: 400 as const, message: "Record refunds before voiding a paid invoice." };
        }

        const updated = await Invoice.findOneAndUpdate(
          { _id: invoice._id, status: currentStatus },
          {
            $set: {
              ...$set,
              status: "VOID",
              voidReason: reason,
              activeSourceKey: null,
            },
          },
          { new: true, session },
        );
        if (!updated) {
          return { ok: false as const, code: 409 as const, message: "This invoice changed - reload and retry." };
        }

        await appendPaymentEvent({
          invoiceId: String(invoice._id),
          action: "INVOICE_VOIDED",
          fromStatus: currentStatus,
          toStatus: "VOID",
          actorId: user.id,
          metadata: reason ? { reason: reason.slice(0, 200) } : null,
          session,
        });
        return { ok: true as const, updated, payments };
      });

      if (!result.ok) {
        return errorResponse(result.code, result.message);
      }
      return itemResponse(
        toInvoiceDto(result.updated as InvoiceDocument, result.payments, true),
      );
    }

    // --- DRAFT -> ISSUED ---------------------------------------------------
    {
      const updated = await Invoice.findOneAndUpdate(
        { _id: invoice._id, status: "DRAFT" },
        { $set: { ...$set, status: "ISSUED" } },
        { new: true },
      );
      if (!updated) {
        return errorResponse(409, "This invoice changed - reload and retry.");
      }
      await appendPaymentEvent({
        invoiceId: String(invoice._id),
        action: "INVOICE_ISSUED",
        fromStatus: "DRAFT",
        toStatus: "ISSUED",
        actorId: user.id,
        metadata: { total: updated.totalAmount },
      });

      // Zero-total invoices settle immediately (nothing left to pay).
      const payments = await Payment.find({ invoiceId: invoice._id })
        .sort({ createdAt: 1 })
        .lean();
      if (updated.totalAmount === 0) {
        await Invoice.updateOne(
          { _id: updated._id, status: "ISSUED" },
          { $set: { status: "PAID" } },
        );
        updated.status = "PAID";
        await appendPaymentEvent({
          invoiceId: String(invoice._id),
          action: "INVOICE_SETTLED",
          fromStatus: "ISSUED",
          toStatus: "PAID",
          actorId: user.id,
          metadata: { total: updated.totalAmount },
        });
      }

      return itemResponse(toInvoiceDto(updated, payments, true));
    }
  } catch (error) {
    logApiFailure("invoices/[id]/patch", error);
    return errorResponse(
      503,
      "Unable to update the invoice right now. Please try again.",
    );
  }
}
