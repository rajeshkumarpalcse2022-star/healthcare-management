import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
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
import { toParameterDto } from "@/lib/api/serializers";
import { LabTest } from "@/models/LabTest";
import { LabTestParameter } from "@/models/LabTestParameter";
import { labTestIdSchema } from "@/lib/validation/lab-test";
import {
  parameterCreateSchema,
} from "@/lib/validation/lab-test-parameter";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/** Parameters per test are few; a single generous page covers every test. */
const PARAMETER_PAGE_LIMIT = 50;

/**
 * GET /api/lab-tests/[id]/parameters
 *
 * Ordered parameter list for one lab test. Parameters are scoped through
 * their parent test: out-of-scope tests answer 404.
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
  const parsedId = labTestIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid lab test id.");
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);

  try {
    await connectToDatabase();

    const test = await LabTest.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("_id")
      .lean();
    if (!test) {
      return errorResponse(404, "Lab test not found.");
    }

    const filter = { labTestId: parsedId.data.id };
    const [total, docs] = await Promise.all([
      LabTestParameter.countDocuments(filter),
      LabTestParameter.find(filter)
        .sort({ displayOrder: 1, createdAt: 1 })
        .skip((page - 1) * PARAMETER_PAGE_LIMIT)
        .limit(PARAMETER_PAGE_LIMIT)
        .lean(),
    ]);

    return listResponse(
      docs.map(toParameterDto),
      buildListMeta(page, PARAMETER_PAGE_LIMIT, total),
    );
  } catch (error) {
    logApiFailure("lab-tests/[id]/parameters", error);
    return errorResponse(
      503,
      "Unable to load parameters right now. Please try again.",
    );
  }
}

/**
 * POST /api/lab-tests/[id]/parameters
 *
 * Adds a parameter to a lab test. The test must exist; the code must be
 * unique within the test. When `displayOrder` is omitted it is auto-assigned
 * to the next position in the list. LAB_MANAGER can only add parameters to
 * tests inside their scope (404 otherwise).
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
  const parsedId = labTestIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid lab test id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = parameterCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  if (parsed.data.labTestId !== parsedId.data.id) {
    return errorResponse(
      400,
      "The lab test in the request does not match the route.",
    );
  }

  try {
    await connectToDatabase();

    const test = await LabTest.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("_id")
      .lean();
    if (!test) {
      return errorResponse(404, "Lab test not found.");
    }

    const existing = await LabTestParameter.findOne({
      labTestId: parsedId.data.id,
      code: parsed.data.code,
    })
      .select("_id")
      .lean();
    if (existing) {
      return errorResponse(
        409,
        "A parameter with this code already exists for this test. Choose a different code.",
      );
    }

    let displayOrder = parsed.data.displayOrder;
    if (displayOrder === undefined) {
      const last = await LabTestParameter.findOne({ labTestId: parsedId.data.id })
        .sort({ displayOrder: -1 })
        .select("displayOrder")
        .lean();
      displayOrder = last ? last.displayOrder + 1 : 1;
      if (displayOrder > 999) {
        return errorResponse(
          400,
          "This test already has the maximum number of parameters.",
        );
      }
    } else {
      const count = await LabTestParameter.countDocuments({
        labTestId: parsedId.data.id,
      });
      if (displayOrder > count + 1) {
        displayOrder = count + 1;
      }
    }

    const parameter = await LabTestParameter.create({
      labTestId: parsedId.data.id,
      name: parsed.data.name,
      code: parsed.data.code,
      dataType: parsed.data.dataType,
      unit: parsed.data.unit ?? null,
      referenceRange: {
        low: parsed.data.referenceRange?.low ?? null,
        high: parsed.data.referenceRange?.high ?? null,
        text: parsed.data.referenceRange?.text ?? null,
      },
      criticalLow: parsed.data.criticalLow ?? null,
      criticalHigh: parsed.data.criticalHigh ?? null,
      displayOrder,
      isRequired: parsed.data.isRequired ?? true,
    });

    return itemResponse(toParameterDto(parameter.toObject()), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A parameter with this code already exists for this test. Choose a different code.",
      );
    }
    logApiFailure("lab-tests/[id]/parameters/create", error);
    return errorResponse(
      503,
      "Unable to create the parameter right now. Please try again.",
    );
  }
}
