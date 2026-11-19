import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { formatLabReportCode } from "@/config/lab-reports";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope, scopeFilter } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { ensureCollectionInvoice } from "@/lib/billing/collection-invoice";
import { toLabReportDto } from "@/lib/lab-report/dto";
import { LabReport } from "@/models/LabReport";
import { HomeCollection } from "@/models/HomeCollection";
import { toFieldIssues } from "@/lib/validation/common";
import {
  labReportCreateSchema,
  labReportListQuerySchema,
} from "@/lib/validation/lab-report";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
] as const;

const WRITE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

function populateReport() {
  return [
    { path: "patientId", select: "name" },
    { path: "laboratoryId", select: "name code" },
    { path: "createdBy", select: "name" },
    { path: "invoiceId", select: "invoiceCode status totalAmount" },
  ];
}

function parseReportDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = labReportListQuerySchema.safeParse({
    collectionId: searchParams.get("collectionId") ?? undefined,
    patient: searchParams.get("patient") ?? undefined,
    laboratory: searchParams.get("laboratory") ?? undefined,
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

  const { collectionId, patient, laboratory, page, limit } = parsed.data;
  const filter: Record<string, unknown> = {};

  if (user.role === ROLES.PATIENT) {
    filter.patientId = user.id;
  } else {
    Object.assign(filter, scopeFilter(user));
    if (patient !== undefined) filter.patientId = patient;
    if (laboratory !== undefined) filter.laboratoryId = laboratory;
  }
  if (collectionId !== undefined) filter.collectionId = collectionId;

  try {
    await connectToDatabase();
    const [total, docs] = await Promise.all([
      LabReport.countDocuments(filter),
      LabReport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(populateReport())
        .lean(),
    ]);

    return listResponse(
      docs.map((doc) => toLabReportDto(doc)),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("lab-reports", error);
    return errorResponse(
      503,
      "Unable to load lab reports right now. Please try again.",
    );
  }
}

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

  const parsed = labReportCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the report details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findById(input.collectionId).lean();
    if (!collection) return errorResponse(404, "Collection not found.");
    if (!isLaboratoryInScope(user, String(collection.laboratoryId))) {
      return errorResponse(404, "Collection not found.");
    }
    if (collection.status !== "COLLECTED") {
      return errorResponse(
        400,
        "A lab report can be added only after the home collection is completed.",
      );
    }

    const existing = await LabReport.findOne({
      collectionId: collection._id,
    }).lean();
    if (existing) {
      return errorResponse(409, "This collection already has a lab report.");
    }

    const report = await LabReport.create({
      reportCode: formatLabReportCode(collection.collectionCode),
      collectionId: collection._id,
      collectionCode: collection.collectionCode,
      patientId: collection.patientId,
      laboratoryId: collection.laboratoryId,
      invoiceId: null,
      title: input.title,
      summary: input.summary ?? null,
      findings: input.findings,
      conclusion: input.conclusion ?? null,
      attachments: input.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        url: attachment.url,
        mimeType: attachment.mimeType,
        size: attachment.size,
        uploadedAt: new Date(),
      })),
      reportDate: parseReportDate(input.reportDate),
      status: "PUBLISHED",
      createdBy: user.id,
      updatedBy: null,
    });

    try {
      const invoice = await ensureCollectionInvoice(collection, user.id);
      report.invoiceId = invoice._id;
      await report.save();
    } catch (error) {
      logApiFailure("lab-reports/invoice", error);
    }

    const populated = await LabReport.findById(report._id)
      .populate(populateReport())
      .lean();

    return itemResponse(
      toLabReportDto(populated ?? report.toObject()),
      201,
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "This collection already has a lab report.");
    }
    logApiFailure("lab-reports/create", error);
    return errorResponse(
      503,
      "Unable to add the lab report right now. Please try again.",
    );
  }
}
