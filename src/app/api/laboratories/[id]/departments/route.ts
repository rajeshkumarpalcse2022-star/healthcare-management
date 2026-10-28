import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireRole,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toDepartmentDto } from "@/lib/api/serializers";
import { Laboratory } from "@/models/Laboratory";
import { LabDepartment } from "@/models/LabDepartment";
import {
  departmentCreateSchema,
  departmentListQuerySchema,
} from "@/lib/validation/lab-department";
import { laboratoryIdSchema } from "@/lib/validation/laboratory";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/laboratories/[id]/departments
 *
 * Paginated department list for one laboratory, with server-side search and
 * status filtering. Out-of-scope laboratories answer 404 for LAB_MANAGER/
 * STAFF (the parent id is the laboratory id, so scoping is checked first).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = laboratoryIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid laboratory id.");
  }
  if (!isLaboratoryInScope(user, parsedId.data.id)) {
    return errorResponse(404, "Laboratory not found.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = departmentListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? "all",
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

  const { search, status, page, limit } = parsed.data;
  const isActive = statusToBoolean(status);

  const filter: Record<string, unknown> = {
    laboratoryId: parsedId.data.id,
  };
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { code: containsRegex(search) },
      { description: containsRegex(search) },
    ];
  }

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      LabDepartment.countDocuments(filter),
      LabDepartment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("laboratoryId", "name code isActive")
        .lean(),
    ]);

    return listResponse(docs.map(toDepartmentDto), buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("laboratories/[id]/departments", error);
    return errorResponse(
      503,
      "Unable to load departments right now. Please try again.",
    );
  }
}

/**
 * POST /api/laboratories/[id]/departments
 *
 * Creates a department inside an active laboratory. The laboratory must
 * exist and be active, and the code must be unique within it. LAB_MANAGER
 * can only add departments to laboratories in their scope (404 otherwise).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = laboratoryIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid laboratory id.");
  }
  if (!isLaboratoryInScope(user, parsedId.data.id)) {
    return errorResponse(404, "Laboratory not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = departmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  if (parsed.data.laboratoryId !== parsedId.data.id) {
    return errorResponse(
      400,
      "The laboratory in the request does not match the route.",
    );
  }

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(parsedId.data.id)
      .select("_id isActive")
      .lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }
    if (!laboratory.isActive) {
      return errorResponse(
        400,
        "This laboratory is inactive. Activate it before adding departments.",
      );
    }

    const existing = await LabDepartment.findOne({
      laboratoryId: parsedId.data.id,
      code: parsed.data.code,
    })
      .select("_id")
      .lean();
    if (existing) {
      return errorResponse(
        409,
        "A department with this code already exists in this laboratory. Choose a different code.",
      );
    }

    const department = await LabDepartment.create({
      laboratoryId: parsedId.data.id,
      name: parsed.data.name,
      code: parsed.data.code,
      description: parsed.data.description ?? null,
      isActive: true,
    });

    const populated = await LabDepartment.findById(department._id)
      .populate("laboratoryId", "name code isActive")
      .lean();

    return itemResponse(toDepartmentDto(populated ?? department.toObject()), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A department with this code already exists in this laboratory. Choose a different code.",
      );
    }
    logApiFailure("laboratories/[id]/departments/create", error);
    return errorResponse(
      503,
      "Unable to create the department right now. Please try again.",
    );
  }
}
