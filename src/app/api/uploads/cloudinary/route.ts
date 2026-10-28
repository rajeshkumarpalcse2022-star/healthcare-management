import { NextResponse } from "next/server";

import {
  CONSULTATION_ATTACHMENT_MAX_BYTES,
  CONSULTATION_ATTACHMENT_MIME_TYPES,
} from "@/config/appointments";
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
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.DOCTOR);
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
  if (kind !== "doctor" && kind !== "clinic" && kind !== "consultation") {
    return errorResponse(400, "Choose a valid upload type.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse(400, "Choose a file to upload.");
  }

  const isConsultation = kind === "consultation";
  const allowedMimeTypes: readonly string[] = isConsultation
    ? CONSULTATION_ATTACHMENT_MIME_TYPES
    : IMAGE_UPLOAD_MIME_TYPES;

  if (!allowedMimeTypes.includes(file.type)) {
    return errorResponse(
      400,
      isConsultation
        ? "Only JPG, PNG, WebP, GIF or PDF files are supported."
        : "Only JPG, PNG, WebP or GIF images are supported.",
    );
  }

  const maxBytes = isConsultation
    ? CONSULTATION_ATTACHMENT_MAX_BYTES
    : IMAGE_UPLOAD_MAX_BYTES;
  if (file.size > maxBytes) {
    return errorResponse(
      400,
      isConsultation
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
          : "healthcare/consultations",
      isConsultation ? "auto" : "image",
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
