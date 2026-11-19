import { NextResponse } from "next/server";

import {
  CONSULTATION_ATTACHMENT_MAX_BYTES,
  CONSULTATION_ATTACHMENT_MIME_TYPES,
} from "@/config/appointments";
import {
  LAB_REPORT_ATTACHMENT_MAX_BYTES,
  LAB_REPORT_ATTACHMENT_MIME_TYPES,
} from "@/config/lab-reports";
import { ROLES } from "@/config/roles";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_MIME_TYPES,
  uploadCloudinaryFile,
} from "@/lib/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/cloudinary
 *
 * Multipart image upload for doctor and clinic profile images. Accessible to
 * administrators and doctors; the file is validated before being forwarded to
 * Cloudinary with a short-lived server-side signature.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: { role: string };
  try {
    user = await requireRole(
      ROLES.SUPER_ADMIN,
      ROLES.ADMIN,
      ROLES.DOCTOR,
      ROLES.LAB_MANAGER,
      ROLES.STAFF,
    );
  } catch (error) {
    return (
      authErrorResponse(error) ?? errorResponse(401, "Authentication required.")
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "Invalid upload request.");
  }

  const kind = form.get("kind");
  if (
    kind !== "doctor" &&
    kind !== "clinic" &&
    kind !== "consultation" &&
    kind !== "lab-report"
  ) {
    return errorResponse(400, "Choose a valid upload type.");
  }

  if (
    kind === "lab-report" &&
    user.role !== ROLES.SUPER_ADMIN &&
    user.role !== ROLES.ADMIN &&
    user.role !== ROLES.LAB_MANAGER &&
    user.role !== ROLES.STAFF
  ) {
    return errorResponse(403, "You do not have permission to upload this file.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse(400, "Choose a file to upload.");
  }

  const isAttachment = kind === "consultation" || kind === "lab-report";
  const isLabReport = kind === "lab-report";
  const allowedMimeTypes: readonly string[] = isLabReport
    ? LAB_REPORT_ATTACHMENT_MIME_TYPES
    : kind === "consultation"
      ? CONSULTATION_ATTACHMENT_MIME_TYPES
      : IMAGE_UPLOAD_MIME_TYPES;

  if (!allowedMimeTypes.includes(file.type)) {
    return errorResponse(
      400,
      isAttachment
        ? "Only JPG, PNG, WebP, GIF or PDF files are supported."
        : "Only JPG, PNG, WebP or GIF images are supported.",
    );
  }

  const maxBytes = isLabReport
    ? LAB_REPORT_ATTACHMENT_MAX_BYTES
    : kind === "consultation"
      ? CONSULTATION_ATTACHMENT_MAX_BYTES
      : IMAGE_UPLOAD_MAX_BYTES;
  if (file.size > maxBytes) {
    return errorResponse(
      400,
      isAttachment
        ? "Each file must be 10 MB or smaller."
        : "Image must be 5 MB or smaller.",
    );
  }

  try {
    const uploaded = await uploadCloudinaryFile(
      file,
      kind === "doctor"
        ? "healthcare/doctors"
        : kind === "clinic"
          ? "healthcare/clinics"
          : isLabReport
            ? "healthcare/lab-reports"
            : "healthcare/consultations",
      isAttachment ? "auto" : "image",
    );
    return itemResponse(uploaded, 201);
  } catch (error) {
    logApiFailure("uploads/cloudinary", error);
    return errorResponse(
      502,
      "Unable to upload the file right now. Please try again.",
    );
  }
}
