import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import { errorResponse, logApiFailure } from "@/lib/api/response";
import { buildLabReportPdf } from "@/lib/lab-report/pdf";
import { LabReport } from "@/models/LabReport";
import { HomeCollection } from "@/models/HomeCollection";
import { labReportIdSchema } from "@/lib/validation/lab-report";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
] as const;

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
  const parsedId = labReportIdSchema.safeParse({ id });
  if (!parsedId.success) return errorResponse(404, "Lab report not found.");

  try {
    await connectToDatabase();
    const report = await LabReport.findById(parsedId.data.id)
      .populate("patientId", "name uniqueId phone")
      .populate(
        "laboratoryId",
        "name code phone email address city state pincode accreditation",
      )
      .populate("createdBy", "name")
      .populate("invoiceId", "invoiceCode status totalAmount")
      .lean();

    if (!report) return errorResponse(404, "Lab report not found.");

    const labId = refId(report.laboratoryId);
    if (user.role === ROLES.PATIENT) {
      if (refId(report.patientId) !== user.id) {
        return errorResponse(404, "Lab report not found.");
      }
    } else if (labId === null || !isLaboratoryInScope(user, labId)) {
      return errorResponse(404, "Lab report not found.");
    }

    const collection = await HomeCollection.findById(report.collectionId).lean();
    if (!collection) return errorResponse(404, "Lab report not found.");

    const lab =
      report.laboratoryId !== null &&
      typeof report.laboratoryId === "object" &&
      "_id" in report.laboratoryId
        ? (report.laboratoryId as unknown as Record<string, unknown>)
        : null;
    const patient =
      report.patientId !== null &&
      typeof report.patientId === "object" &&
      "_id" in report.patientId
        ? (report.patientId as unknown as Record<string, unknown>)
        : null;
    const creator =
      report.createdBy !== null &&
      typeof report.createdBy === "object" &&
      "_id" in report.createdBy
        ? (report.createdBy as unknown as Record<string, unknown>)
        : null;
    const invoice =
      report.invoiceId !== null &&
      report.invoiceId !== undefined &&
      typeof report.invoiceId === "object" &&
      "_id" in report.invoiceId
        ? (report.invoiceId as unknown as Record<string, unknown>)
        : null;

    const pdf = await buildLabReportPdf({
      report: {
        code: report.reportCode,
        title: report.title,
        summary: report.summary ?? null,
        findings: report.findings,
        conclusion: report.conclusion ?? null,
        reportDate: report.reportDate.toISOString(),
        createdAt: report.createdAt.toISOString(),
      },
      collection: {
        code: collection.collectionCode,
        scheduledDate: collection.scheduledDate.toISOString(),
        timeSlot: collection.timeSlot,
        timezone: collection.timezone,
        appliedAt: collection.createdAt.toISOString(),
        collectedAt: collection.collectedAt
          ? collection.collectedAt.toISOString()
          : null,
        notes: collection.collectionNotes ?? null,
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
        accreditation: text(lab?.accreditation),
      },
      patient: {
        name: text(patient?.name) ?? "Patient",
        uniqueId: text(patient?.uniqueId),
        phone: text(patient?.phone),
      },
      createdBy: text(creator?.name),
      tests: collection.items.map((item) => ({
        testCode: item.testCode,
        testName: item.testName,
        specimenType: item.specimenType ?? null,
      })),
      invoice: invoice
        ? {
            invoiceCode: String(invoice.invoiceCode ?? ""),
            status: String(invoice.status ?? ""),
            totalAmount: Number(invoice.totalAmount ?? 0),
          }
        : null,
      attachments: (report.attachments ?? []).map((attachment) => ({
        fileName: attachment.fileName,
      })),
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.reportCode}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logApiFailure("lab-reports/[id]/pdf", error);
    return errorResponse(
      503,
      "Unable to generate the lab report right now. Please try again.",
    );
  }
}
