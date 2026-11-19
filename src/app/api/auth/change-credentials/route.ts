import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCurrentUser,
  hashPassword,
  toSafeUser,
  verifyPassword,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { logApiFailure } from "@/lib/api/response";
import { User } from "@/models/User";
import {
  isUniqueIdShape,
  normalizeUniqueId,
  uniqueIdPrefixForRole,
} from "@/lib/unique-id";
import type { AuthErrorBody, ChangeCredentialsSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Roles allowed to change their own unique ID + password. */
const CHANGEABLE_ROLES = new Set(["DOCTOR", "LAB_MANAGER"]);

const changeCredentialsSchema = z
  .object({
    currentPassword: z
      .string("Current password is required.")
      .min(1, "Current password is required."),
    newUniqueId: z
      .string()
      .trim()
      .max(20, "Unique ID is too long.")
      .optional(),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters.")
      .max(128, "Password is too long.")
      .optional(),
    confirmNewPassword: z.string().optional(),
  })
  .refine(
    (data) => data.newUniqueId !== undefined || data.newPassword !== undefined,
    "Provide a new unique ID or a new password.",
  )
  .refine(
    (data) =>
      data.newPassword === undefined ||
      data.newPassword === data.confirmNewPassword,
    { message: "Passwords do not match.", path: ["confirmNewPassword"] },
  );

function errorResponse(
  status: number,
  error: string,
  issues?: AuthErrorBody["issues"],
): NextResponse {
  return NextResponse.json<AuthErrorBody>(
    { success: false, error, ...(issues ? { issues } : {}) },
    { status, headers: NO_STORE },
  );
}

/**
 * POST /api/auth/change-credentials
 *
 * Lets a DOCTOR or LAB_MANAGER change their own unique login ID and/or
 * password. Requires the current password as proof of possession. Patients
 * and privileged admin roles are not allowed - their identifiers are managed
 * differently.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    // InfrastructureError -> serialised as 503 by callers that use
    // authErrorResponse; here we answer a generic 503.
    console.error(
      "[api/auth/change-credentials] session failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return errorResponse(
      503,
      "Service temporarily unavailable. Please try again.",
    );
  }

  if (!user) {
    return errorResponse(401, "Authentication required.");
  }

  if (!CHANGEABLE_ROLES.has(user.role)) {
    return errorResponse(
      403,
      "Only doctors and laboratory managers can change their login credentials.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = changeCredentialsSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "form",
      message: issue.message,
    }));
    return errorResponse(400, "Check your details and try again.", issues);
  }

  const { currentPassword, newUniqueId, newPassword } = parsed.data;

  try {
    await connectToDatabase();

    const record = await User.findById(user.id).select("+passwordHash");
    if (!record) {
      return errorResponse(401, "Authentication required.");
    }

    const passwordValid = await verifyPassword(currentPassword, record.passwordHash);
    if (!passwordValid) {
      return errorResponse(400, "Your current password is incorrect.", [
        { field: "currentPassword", message: "Your current password is incorrect." },
      ]);
    }

    const updates: Record<string, unknown> = {};

    if (newUniqueId !== undefined && newUniqueId !== "") {
      const kind = uniqueIdPrefixForRole(user.role);
      if (!kind) {
        return errorResponse(400, "Unique ID changes are not supported for this role.");
      }

      const normalized = normalizeUniqueId(newUniqueId);
      if (!isUniqueIdShape(normalized)) {
        return errorResponse(400, "Enter a valid unique ID.", [
          {
            field: "newUniqueId",
            message: "Use the format PREFIX-XXXXX (e.g. DOC-8F3K2).",
          },
        ]);
      }

      // Enforce the correct prefix for this role.
      const expectedPrefix = normalized.split("-")[0];
      const rolePrefix = kind === "PATIENT" ? "PAT" : kind === "DOCTOR" ? "DOC" : "LAB";
      if (expectedPrefix !== rolePrefix) {
        return errorResponse(400, "Enter a valid unique ID.", [
          {
            field: "newUniqueId",
            message: `Your unique ID must start with ${rolePrefix}-.`,
          },
        ]);
      }

      if (normalized !== record.uniqueId) {
        const taken = await User.findOne({ uniqueId: normalized })
          .select("_id")
          .lean();
        if (taken) {
          return errorResponse(400, "That unique ID is already taken.", [
            { field: "newUniqueId", message: "That unique ID is already taken." },
          ]);
        }
        updates.uniqueId = normalized;
      }
    }

    if (newPassword !== undefined && newPassword !== "") {
      updates.passwordHash = await hashPassword(newPassword);
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(400, "Nothing to update.");
    }

    const updated = await User.findByIdAndUpdate(user.id, updates, {
      new: true,
    });

    if (!updated) {
      return errorResponse(500, "Unable to update your credentials right now.");
    }

    return NextResponse.json<ChangeCredentialsSuccessBody>(
      { success: true, user: toSafeUser(updated) },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    logApiFailure("auth/change-credentials", error);
    return errorResponse(
      503,
      "Unable to update your credentials right now. Please try again.",
    );
  }
}
