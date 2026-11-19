import { NextResponse } from "next/server";

import { Types } from "mongoose";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toLabReportDto } from "@/lib/lab-report/dto";
import { LabReport } from "@/models/LabReport";
import { toFieldIssues } from "@/lib/validation/common";
import {
  labReportIdSchema,
  labReportUpdateSchema,
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

function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in (value as object)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function reportPopulate() {
  return [
    { path: "patientId", select: "name" },
    { path: "laboratoryId", select: "name code" },
    { path: "createdBy", select: "name" },
    { path: "invoiceId", select: "invoiceCode status totalAmount" },
  ];
}

function canView(
  user: SafeUser,
  report: { patientId: unknown; laboratoryId: unknown },
): boolean {
  if (user.role === ROLES.PATIENT) {
    return refId(report.patientId) === user.id;
  }
  const labId = refId(report.laboratoryId);
  return labId !== null && isLaboratoryInScope(user, labId);
}

function parseReportDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
      .populate(reportPopulate())
      .lean();
    if (!report || !canView(user, report)) {
      return errorResponse(404, "Lab report not found.");
    }
    return itemResponse(toLabReportDto(report));
  } catch (error) {
    logApiFailure("lab-reports/[id]", error);
    return errorResponse(
      503,
      "Unable to load the lab report right now. Please try again.",
    );
  }
}

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
  const parsedId = labReportIdSchema.safeParse({ id });
  if (!parsedId.success) return errorResponse(404, "Lab report not found.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = labReportUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the report changes and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;
  if (
    input.title === undefined &&
    input.summary === undefined &&
    input.findings === undefined &&
    input.conclusion === undefined &&
    input.reportDate === undefined &&
    input.attachments === undefined
  ) {
    return errorResponse(400, "Provide at least one field to update.");
  }

  try {
    await connectToDatabase();
    const report = await LabReport.findById(parsedId.data.id);
    if (!report) return errorResponse(404, "Lab report not found.");
    if (!isLaboratoryInScope(user, String(report.laboratoryId))) {
      return errorResponse(404, "Lab report not found.");
    }

    if (input.title !== undefined) report.title = input.title;
    if (input.summary !== undefined) report.summary = input.summary;
    if (input.findings !== undefined) report.findings = input.findings;
    if (input.conclusion !== undefined) report.conclusion = input.conclusion;
    if (input.attachments !== undefined) {
      report.attachments = input.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        url: attachment.url,
        mimeType: attachment.mimeType,
        size: attachment.size,
        uploadedAt: new Date(),
      }));
    }
    if (input.reportDate !== undefined) {
      report.reportDate = parseReportDate(input.reportDate);
    }
    report.updatedBy = new Types.ObjectId(user.id);
    await report.save();

    const populated = await LabReport.findById(report._id)
      .populate(reportPopulate())
      .lean();
    return itemResponse(toLabReportDto(populated ?? report.toObject()));
  } catch (error) {
    logApiFailure("lab-reports/[id]/patch", error);
    return errorResponse(
      503,
      "Unable to update the lab report right now. Please try again.",
    );
  }
}
