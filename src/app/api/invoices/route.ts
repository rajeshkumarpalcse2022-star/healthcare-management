import { NextResponse } from "next/server";

import {
  INVOICEABLE_BOOKING_STATUSES,
  INVOICEABLE_COLLECTION_STATUSES,
} from "@/config/billing";
import { ROLES } from "@/config/roles";
import {
  authErrorResponse,
  requireRole,
} from "@/lib/auth";
import {
  isLaboratoryInScope,
  scopeFilter,
} from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { money } from "@/lib/billing/money";
import { nextInvoiceCode } from "@/lib/billing/counter";
import { appendPaymentEvent } from "@/lib/billing/events";
import { toInvoiceDto, type InvoiceItemDto } from "@/lib/billing/dto";
import { Invoice } from "@/models/Invoice";
import { Payment } from "@/models/Payment";
import { LabBooking } from "@/models/LabBooking";
import { HomeCollection } from "@/models/HomeCollection";
import { Laboratory } from "@/models/Laboratory";
import { LabTest } from "@/models/LabTest";
import { User } from "@/models/User";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  invoiceCreateSchema,
  invoiceListQuerySchema,
} from "@/lib/validation/billing";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Roles allowed to browse invoices (PATIENT gets own-only below). */
const LIST_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
] as const;

/** Roles allowed to create invoices / act on money. */
const WRITE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/**
 * GET /api/invoices
 *
 * Staff (LM/STAFF/ADMIN/SA): laboratory-scoped ledger via `scopeFilter` -
 * legacy platform-wide accounts see every lab, LM/STAFF only their assigned
 * ones. PATIENT: forced to `patientId = self` regardless of query params and
 * rendered with `includeInternal=false` so notes, void reasons, payment memos
 * and actor ids are absent from the payload entirely. Each page loads its
 * payments in one extra query (no N+1) so balance/netPaid are recomputed
 * from the ledger on every read.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LIST_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = invoiceListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    sourceType: searchParams.get("sourceType") ?? undefined,
    patient: searchParams.get("patient") ?? undefined,
    laboratory: searchParams.get("laboratory") ?? undefined,
    sourceId: searchParams.get("sourceId") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, status, sourceType, patient, laboratory, sourceId, page, limit } =
    parsed.data;

  const isPatient = user.role === ROLES.PATIENT;
  const filter: Record<string, unknown> = {};

  if (isPatient) {
    // Own ledger only - query params can narrow but never widen.
    filter.patientId = user.id;
  } else {
    Object.assign(filter, scopeFilter(user));
    if (patient !== undefined) filter.patientId = patient;
    if (laboratory !== undefined) filter.laboratoryId = laboratory;
    if (search) filter.$or = [{ invoiceCode: containsRegex(search) }];
  }

  if (status !== "all") filter.status = status;
  if (sourceType !== undefined) filter.sourceType = sourceType;
  if (sourceId !== undefined) filter.sourceId = sourceId;

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("patientId", "name")
        .populate("laboratoryId", "name code")
        .populate("createdBy", "name")
        .lean(),
    ]);

    const invoiceIds = docs.map((doc) => doc._id);
    const payments = await Payment.find({ invoiceId: { $in: invoiceIds } })
      .sort({ createdAt: 1 })
      .lean();
    const paymentsByInvoice = new Map<string, typeof payments>();
    for (const payment of payments) {
      const key = String(payment.invoiceId);
      const bucket = paymentsByInvoice.get(key);
      if (bucket) bucket.push(payment);
      else paymentsByInvoice.set(key, [payment]);
    }

    const rows = docs.map((doc) =>
      toInvoiceDto(
        doc,
        paymentsByInvoice.get(String(doc._id)) ?? [],
        !isPatient,
      ),
    );
    return listResponse(rows, buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("invoices", error);
    return errorResponse(
      503,
      "Unable to load invoices right now. Please try again.",
    );
  }
}

/** Computes per-line totals and the cent-rounded subtotal. */
function computeSubtotal(
  items: { unitPrice: number; quantity: number }[],
): { lineTotals: number[]; subtotal: number } {
  const lineTotals = items.map((item) => money(item.unitPrice * item.quantity));
  const subtotal = money(lineTotals.reduce((sum, value) => sum + value, 0));
  return { lineTotals, subtotal };
}

/**
 * POST /api/invoices
 *
 * Creates a DRAFT invoice. Two shapes:
 * - source-based (BOOKING / HOME_COLLECTION): items, prices, patient and
 *   laboratory are COPIED from the source's immutable snapshots - the client
 *   cannot supply money fields. The source must be invoiceable, in scope
 *   (cross-laboratory -> 404) and not already invoiced (409 via the partial
 *   unique `activeSourceKey`).
 * - MANUAL: staff supplies patient/laboratory/items; relationships and scope
 *   are re-verified server-side.
 *
 * Optional `idempotencyKey` makes retried submissions replay the original
 * invoice instead of creating a second one. Status is always DRAFT - issuing
 * is an explicit later transition.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the invoice details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    if (input.idempotencyKey) {
      const replay = await Invoice.findOne({
        idempotencyKey: input.idempotencyKey,
      }).lean();
      if (replay) {
        return itemResponse(toInvoiceDto(replay, [], true), 200);
      }
    }

    let sourceKey: string | null = null;
    let sourceIdValue: string | null = null;
    let patientId: string;
    let laboratoryId: string;
    let draftItems: InvoiceItemDto[];
    let subtotalValue: number;

    if (input.sourceType === "MANUAL") {
      if (!isLaboratoryInScope(user, input.laboratoryId)) {
        return errorResponse(404, "Laboratory not found.");
      }
      const laboratory = await Laboratory.findById(input.laboratoryId)
        .select("_id")
        .lean();
      if (!laboratory) return errorResponse(404, "Laboratory not found.");

      const patient = await User.findOne({
        _id: input.patientId,
        role: ROLES.PATIENT,
      })
        .select("_id")
        .lean();
      if (!patient) return errorResponse(404, "Patient not found.");

      const testIds = input.items
        .map((item) => item.labTestId)
        .filter((id): id is string => Boolean(id));
      if (testIds.length > 0) {
        const tests = await LabTest.find({
          _id: { $in: testIds },
          laboratoryId: input.laboratoryId,
        })
          .select("_id")
          .lean();
        if (tests.length !== new Set(testIds).size) {
          return errorResponse(
            400,
            "One or more items do not belong to this laboratory.",
          );
        }
      }

      const { lineTotals, subtotal } = computeSubtotal(input.items);
      draftItems = input.items.map((item, index) => ({
        labTestId: item.labTestId ?? null,
        description: item.description,
        unitPrice: money(item.unitPrice),
        quantity: item.quantity,
        lineTotal: lineTotals[index],
      }));
      patientId = String(patient._id);
      laboratoryId = String(laboratory._id);
      subtotalValue = subtotal;
    } else {
      const isBooking = input.sourceType === "BOOKING";
      const source = isBooking
        ? await LabBooking.findById(input.sourceId).lean()
        : await HomeCollection.findById(input.sourceId).lean();

      if (!source) return errorResponse(404, "Source not found.");

      const sourceLabId = String(
        (source as { laboratoryId: unknown }).laboratoryId,
      );
      if (!isLaboratoryInScope(user, sourceLabId)) {
        return errorResponse(404, "Source not found.");
      }

      const sourceStatus = (source as { status: string }).status;
      const allowed = isBooking
        ? INVOICEABLE_BOOKING_STATUSES
        : INVOICEABLE_COLLECTION_STATUSES;
      if (!(allowed as readonly string[]).includes(sourceStatus)) {
        return errorResponse(
          400,
          "This request cannot be invoiced in its current status.",
        );
      }

      sourceKey = isBooking
        ? (source as { bookingCode: string }).bookingCode
        : (source as { collectionCode: string }).collectionCode;
      sourceIdValue = String((source as { _id: unknown })._id);

      const sourceItems = (source as {
        items: { labTestId: unknown; testName: string; price: number }[];
      }).items;

      const { lineTotals, subtotal } = computeSubtotal(
        sourceItems.map((item) => ({
          unitPrice: item.price,
          quantity: 1,
        })),
      );
      draftItems = sourceItems.map((item, index) => ({
        labTestId:
          item.labTestId === null || item.labTestId === undefined
            ? null
            : String(item.labTestId),
        description: item.testName,
        unitPrice: money(item.price),
        quantity: 1,
        lineTotal: lineTotals[index],
      }));
      patientId = String((source as { patientId: unknown }).patientId);
      laboratoryId = sourceLabId;
      subtotalValue = subtotal;
    }

    const invoiceCode = await nextInvoiceCode();

    let created;
    try {
      created = await Invoice.create({
        invoiceCode,
        patientId,
        laboratoryId,
        sourceType: input.sourceType,
        sourceId: sourceIdValue,
        sourceKey,
        activeSourceKey: sourceKey,
        items: draftItems,
        subtotal: subtotalValue,
        totalAmount: subtotalValue,
        status: "DRAFT",
        notes: input.notes ?? null,
        voidReason: null,
        createdBy: user.id,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("activeSourceKey")) {
          return errorResponse(
            409,
            "This request already has an active invoice.",
          );
        }
        if (message.includes("idempotencyKey") && input.idempotencyKey) {
          const replay = await Invoice.findOne({
            idempotencyKey: input.idempotencyKey,
          }).lean();
          if (replay) return itemResponse(toInvoiceDto(replay, [], true), 200);
        }
        return errorResponse(409, "Duplicate invoice.");
      }
      throw error;
    }

    await appendPaymentEvent({
      invoiceId: String(created._id),
      action: "INVOICE_CREATED",
      fromStatus: null,
      toStatus: "DRAFT",
      actorId: user.id,
      metadata: { total: subtotalValue },
    });

    return itemResponse(toInvoiceDto(created, [], true), 201);
  } catch (error) {
    logApiFailure("invoices/create", error);
    return errorResponse(
      503,
      "Unable to create the invoice right now. Please try again.",
    );
  }
}
