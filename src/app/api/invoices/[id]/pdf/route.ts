import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import { errorResponse, logApiFailure } from "@/lib/api/response";
import { netPaid, outstandingBalance } from "@/lib/billing/balance";
import { buildInvoicePdf } from "@/lib/billing/invoice-pdf";
import { Invoice } from "@/models/Invoice";
import { Payment } from "@/models/Payment";
import { invoiceIdSchema } from "@/lib/validation/billing";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
] as const;

const STAFF_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in (value as object)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

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
  if (!parsedId.success) return errorResponse(404, "Invoice not found.");

  try {
    await connectToDatabase();
    const invoice = await Invoice.findById(parsedId.data.id)
      .populate("patientId", "name uniqueId phone")
      .populate(
        "laboratoryId",
        "name code phone email address city state pincode registrationNumber",
      )
      .populate("createdBy", "name")
      .lean();
    if (!invoice) return errorResponse(404, "Invoice not found.");

    const includeInternal = STAFF_ROLES.includes(user.role);
    if (includeInternal) {
      if (!isLaboratoryInScope(user, String(invoice.laboratoryId))) {
        return errorResponse(404, "Invoice not found.");
      }
    } else if (refId(invoice.patientId) !== user.id) {
      return errorResponse(404, "Invoice not found.");
    }

    const payments = await Payment.find({ invoiceId: invoice._id })
      .sort({ createdAt: 1 })
      .lean();

    const lab =
      invoice.laboratoryId !== null &&
      typeof invoice.laboratoryId === "object" &&
      "_id" in invoice.laboratoryId
        ? (invoice.laboratoryId as unknown as Record<string, unknown>)
        : null;
    const patient =
      invoice.patientId !== null &&
      typeof invoice.patientId === "object" &&
      "_id" in invoice.patientId
        ? (invoice.patientId as unknown as Record<string, unknown>)
        : null;

    const pdf = await buildInvoicePdf({
      invoice: {
        code: invoice.invoiceCode,
        status: invoice.status,
        createdAt: invoice.createdAt.toISOString(),
        notes: includeInternal ? invoice.notes ?? null : null,
      },
      patient: {
        name: text(patient?.name) ?? "Patient",
        uniqueId: text(patient?.uniqueId),
        phone: text(patient?.phone),
      },
      laboratory: {
        name: text(lab?.name) ?? "Laboratory",
        code: text(lab?.code) ?? "",
        phone: text(lab?.phone),
        email: text(lab?.email),
        address: text(lab?.address),
        city: text(lab?.city),
        state: text(lab?.state),
        pincode: text(lab?.pincode),
        registrationNumber: text(lab?.registrationNumber),
      },
      source: {
        type: invoice.sourceType,
        code: invoice.sourceKey ?? null,
      },
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: invoice.subtotal,
      totalAmount: invoice.totalAmount,
      netPaid: netPaid(payments),
      balance: outstandingBalance(invoice.totalAmount, payments),
      payments: payments.map((payment) => ({
        code: payment.paymentCode,
        kind: payment.kind,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference ?? null,
        createdAt: payment.createdAt.toISOString(),
      })),
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceCode}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logApiFailure("invoices/[id]/pdf", error);
    return errorResponse(
      503,
      "Unable to generate the invoice right now. Please try again.",
    );
  }
}
