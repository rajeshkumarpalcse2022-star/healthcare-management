import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireRole,
  scopeFilter,
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
import { toLabTestDto } from "@/lib/api/serializers";
import { LabDepartment } from "@/models/LabDepartment";
import { LabTest } from "@/models/LabTest";
import { Laboratory } from "@/models/Laboratory";
import {
  labTestCreateSchema,
  labTestListQuerySchema,
} from "@/lib/validation/lab-test";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";

export const dynamic = "force-dynamic";

const POPULATE = "name code isActive";

/**
 * GET /api/lab-tests
 *
 * Paginated test catalogue with server-side search, relationship filters,
 * category / specimen filters and status filtering. LAB_MANAGER and STAFF
 * only ever see tests belonging to their assigned laboratories; a
 * `laboratory` filter pointing outside the scope yields an empty page.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = labTestListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    laboratory: searchParams.get("laboratory") ?? undefined,
    department: searchParams.get("department") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    specimen: searchParams.get("specimen") ?? undefined,
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

  const { search, laboratory, department, category, specimen, status, page, limit } =
    parsed.data;
  const isActive = statusToBoolean(status);

  const filter: Record<string, unknown> = {
    ...scopeFilter(user),
  };
  if (department) filter.departmentId = department;
  if (category) filter.category = category;
  if (specimen) filter.specimenType = specimen;
  if (isActive !== undefined) filter.isActive = isActive;
  if (laboratory) {
    // Intersect the requested laboratory with the account's scope: outside
    // the scope the filter can never match (empty page, no probing).
    filter.laboratoryId = isLaboratoryInScope(user, laboratory)
      ? laboratory
      : { $in: [] };
  }
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { code: containsRegex(search) },
    ];
  }

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      LabTest.countDocuments(filter),
      LabTest.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("laboratoryId", POPULATE)
        .populate("departmentId", POPULATE)
        .lean(),
    ]);

    return listResponse(docs.map(toLabTestDto), buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("lab-tests", error);
    return errorResponse(
      503,
      "Unable to load lab tests right now. Please try again.",
    );
  }
}

/**
 * POST /api/lab-tests
 *
 * Creates a test. The laboratory and department must exist and be active,
 * the department must belong to the laboratory, and the code must be unique
 * within the laboratory. LAB_MANAGER can only create tests inside their
 * scope (404 for out-of-scope laboratories, no existence probing).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = labTestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  if (!isLaboratoryInScope(user, parsed.data.laboratoryId)) {
    return errorResponse(404, "Laboratory not found.");
  }

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(parsed.data.laboratoryId)
      .select("_id isActive")
      .lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }
    if (!laboratory.isActive) {
      return errorResponse(
        400,
        "This laboratory is inactive. Activate it before adding tests.",
      );
    }

    const department = await LabDepartment.findById(parsed.data.departmentId)
      .select("_id laboratoryId isActive")
      .lean();
    if (!department) {
      return errorResponse(404, "Department not found.");
    }
    if (String(department.laboratoryId) !== parsed.data.laboratoryId) {
      return errorResponse(
        400,
        "The selected department does not belong to the selected laboratory.",
      );
    }
    if (!department.isActive) {
      return errorResponse(
        400,
        "This department is inactive. Activate it before adding tests.",
      );
    }

    const existing = await LabTest.findOne({
      laboratoryId: parsed.data.laboratoryId,
      code: parsed.data.code,
    })
      .select("_id")
      .lean();
    if (existing) {
      return errorResponse(
        409,
        "A test with this code already exists in this laboratory. Choose a different code.",
      );
    }

    const test = await LabTest.create({
      laboratoryId: parsed.data.laboratoryId,
      departmentId: parsed.data.departmentId,
      name: parsed.data.name,
      code: parsed.data.code,
      category: parsed.data.category,
      specimenType: parsed.data.specimenType,
      methodology: parsed.data.methodology ?? null,
      turnaroundTimeMinutes: parsed.data.turnaroundTimeMinutes,
      description: parsed.data.description ?? null,
      preparationInstructions: parsed.data.preparationInstructions ?? null,
      price: parsed.data.price,
      labVisitEnabled: parsed.data.labVisitEnabled,
      homeCollectionEnabled: parsed.data.homeCollectionEnabled,
      isActive: true,
    });

    const populated = await LabTest.findById(test._id)
      .populate("laboratoryId", POPULATE)
      .populate("departmentId", POPULATE)
      .lean();

    return itemResponse(toLabTestDto(populated ?? test.toObject()), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A test with this code already exists in this laboratory. Choose a different code.",
      );
    }
    logApiFailure("lab-tests/create", error);
    return errorResponse(
      503,
      "Unable to create the lab test right now. Please try again.",
    );
  }
}
