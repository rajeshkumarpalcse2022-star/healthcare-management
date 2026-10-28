import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase, runInTransaction } from "@/lib/db";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { money, moneyNonNegative } from "@/lib/billing/money";
import {
  isFullyRefunded,
  netPaid,
  outstandingBalance,
} from "@/lib/billing/balance";
import { nextPaymentCode } from "@/lib/billing/counter";
import { appendPaymentEvent } from "@/lib/billing/events";
import { toInvoiceDto } from "@/lib/billing/dto";
import { Invoice } from "@/models/Invoice";
import { Payment } from "@/models/Payment";
import { toFieldIssues } from "@/lib/validation/common";
import {
  invoiceIdSchema,
  paymentCreateSchema,
} from "@/lib/validation/billing";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Roles allowed to record payments and refunds. */
const WRITE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/** Raised when a guarded invoice write loses a concurrency race. */
class InvoiceRaceError extends Error {
  constructor() {
    super("Invoice changed concurrently.");
    this.name = "InvoiceRaceError";
  }
}

type WriteOutcome = { ok: true } | { ok: false; code: number; message: string };

/**
 * POST /api/invoices/[id]/payments
 *
 * Records one ledger row (PAYMENT or REFUND, amount always positive - the
 * `kind` carries direction) and applies the matching automatic status
 * transition in the same commit:
 * - PAYMENT that clears the balance: ISSUED -> PAID (INVOICE_SETTLED);
 * - REFUND that returns net paid to zero: PAID -> ISSUED (INVOICE_REVERTED).
 *
 * Guard rails: PAYMENT only against ISSUED/PAID and never above the
 * outstanding balance; REFUND only against PAID and never above net paid -
 * so the ledger can never go negative or overpaid (400s, enforced before any
 * write).
 *
 * Concurrency: validation reads, the payment insert and a guarded invoice
 * write happen inside `runInTransaction` when the deployment supports one -
 * the invoice write doubles as the write-conflict point, so two simultaneous
 * payments are serialised and the loser re-validates against fresh ledger
 * state (Mongo retries transient conflicts automatically). Without
 * transaction support the same steps run sequentially with a post-insert
 * re-read: if the ledger overshoots, the LATEST inserted row compensates by
 * deleting itself (400), and a crash between insert and status update is
 * repaired by the reconciling read in `GET /api/invoices/[id]`.
 */
export async function POST(
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

  const parsed = paymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the payment details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;
  const amount = money(input.amount);
  if (amount < 0.01) {
    return errorResponse(400, "Amount must be at least 0.01.");
  }

  try {
    await connectToDatabase();

    // Fast 404/403 before any counter allocation or transaction work.
    const probe = await Invoice.findById(parsedId.data.id)
      .select("laboratoryId")
      .lean();
    if (!probe) return errorResponse(404, "Invoice not found.");
    if (!isLaboratoryInScope(user, String(probe.laboratoryId))) {
      return errorResponse(404, "Invoice not found.");
    }

    const paymentCode = await nextPaymentCode();

    const outcome: WriteOutcome = await runInTransaction(async (session) => {
      const invoice = await Invoice.findById(parsedId.data.id).session(session);
      if (!invoice) {
        return { ok: false, code: 404, message: "Invoice not found." };
      }
      if (!isLaboratoryInScope(user, String(invoice.laboratoryId))) {
        return { ok: false, code: 404, message: "Invoice not found." };
      }

      const prior = await Payment.find({ invoiceId: invoice._id })
        .session(session)
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const net = netPaid(prior);
      const balance = outstandingBalance(invoice.totalAmount, prior);

      if (input.kind === "PAYMENT") {
        if (invoice.status !== "ISSUED" && invoice.status !== "PAID") {
          return {
            ok: false,
            code: 400,
            message: "Payments can only be recorded against issued invoices.",
          };
        }
        if (amount > balance) {
          return {
            ok: false,
            code: 400,
            message: "Amount exceeds the outstanding balance.",
          };
        }
      } else {
        if (invoice.status !== "PAID") {
          return {
            ok: false,
            code: 400,
            message: "Refunds require a paid invoice.",
          };
        }
        if (amount > net) {
          return {
            ok: false,
            code: 400,
            message: "Amount exceeds the net paid amount.",
          };
        }
      }

      const [payment] = await Payment.create(
        [
          {
            paymentCode,
            invoiceId: invoice._id,
            laboratoryId: invoice.laboratoryId,
            kind: input.kind,
            amount,
            method: input.method,
            reference: input.reference ?? null,
            note: input.note ?? null,
            receivedBy: user.id,
          },
        ],
        session ? { session } : undefined,
      );

      const ledger = [...prior, payment];
      const newNet = netPaid(ledger);
      const newBalance = moneyNonNegative(
        money(invoice.totalAmount) - newNet,
      );

      let targetStatus: typeof invoice.status | null = null;
      if (
        input.kind === "PAYMENT" &&
        newBalance === 0 &&
        invoice.status === "ISSUED"
      ) {
        targetStatus = "PAID";
      } else if (
        input.kind === "REFUND" &&
        isFullyRefunded(invoice.totalAmount, ledger) &&
        invoice.status === "PAID"
      ) {
        targetStatus = "ISSUED";
      }

      const updated = await Invoice.findOneAndUpdate(
        { _id: invoice._id, status: invoice.status },
        {
          $set: {
            status: targetStatus ?? invoice.status,
            updatedAt: new Date(),
          },
        },
        { new: true, session },
      );
      if (!updated) {
        // Guard lost a race (concurrent status change): undo our insert -
        // inside a transaction the throw aborts everything anyway.
        if (!session) {
          await Payment.deleteOne({ _id: payment._id });
        }
        throw new InvoiceRaceError();
      }

      // Fallback-only overshoot compensation: with concurrent writers the
      // pre-insert validation above can race; the LATEST row settles it.
      if (!session) {
        const after = await Payment.find({ invoiceId: invoice._id })
          .sort({ createdAt: 1, _id: 1 })
          .lean();
        const afterNet = netPaid(after);
        const over =
          input.kind === "PAYMENT"
            ? afterNet > money(invoice.totalAmount)
            : afterNet < 0;
        if (over) {
          const latest = after[after.length - 1];
          if (latest && String(latest._id) === String(payment._id)) {
            await Payment.deleteOne({ _id: payment._id });
            return {
              ok: false,
              code: 400,
              message:
                input.kind === "PAYMENT"
                  ? "Amount exceeds the outstanding balance."
                  : "Amount exceeds the net paid amount.",
            };
          }
        }
      }

      await appendPaymentEvent({
        invoiceId: String(invoice._id),
        paymentId: String(payment._id),
        action:
          input.kind === "PAYMENT" ? "PAYMENT_RECORDED" : "REFUND_RECORDED",
        fromStatus: invoice.status,
        toStatus: targetStatus ?? invoice.status,
        actorId: user.id,
        metadata: { amount },
        session,
      });
      if (targetStatus && targetStatus !== invoice.status) {
        await appendPaymentEvent({
          invoiceId: String(invoice._id),
          action:
            targetStatus === "PAID" ? "INVOICE_SETTLED" : "INVOICE_REVERTED",
          fromStatus: invoice.status,
          toStatus: targetStatus,
          actorId: user.id,
          metadata: { total: invoice.totalAmount },
          session,
        });
      }

      return { ok: true };
    });

    if (!outcome.ok) {
      return errorResponse(outcome.code, outcome.message);
    }

    const [invoice, payments] = await Promise.all([
      Invoice.findById(parsedId.data.id)
        .populate("patientId", "name")
        .populate("laboratoryId", "name code")
        .populate("createdBy", "name"),
      Payment.find({ invoiceId: parsedId.data.id })
        .sort({ createdAt: 1 })
        .lean(),
    ]);
    if (!invoice) return errorResponse(404, "Invoice not found.");

    return itemResponse(toInvoiceDto(invoice, payments, true), 201);
  } catch (error) {
    if (error instanceof InvoiceRaceError) {
      return errorResponse(409, "This invoice changed - reload and retry.");
    }
    logApiFailure("invoices/payments", error);
    return errorResponse(
      503,
      "Unable to record the payment right now. Please try again.",
    );
  }
}
