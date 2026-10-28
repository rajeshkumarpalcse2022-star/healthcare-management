import "server-only";

import { createHash } from "node:crypto";

/** Image formats accepted by the upload endpoint. */
export const IMAGE_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Maximum upload size in bytes (5 MB). */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export interface CloudinaryImageResult {
  url: string;
  publicId: string;
}

export type CloudinaryUploadResourceType = "image" | "auto";

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary is not configured.");
  }

  return { cloudName, apiKey, apiSecret };
}

/**
 * Uploads an image to Cloudinary using the signed upload API.
 *
 * Server-side only: the API secret is used to sign `folder` and `timestamp`
 * and is never sent to the browser.
 */
export async function uploadCloudinaryFile(
  file: File,
  folder: string,
  resourceType: CloudinaryUploadResourceType = "image",
): Promise<CloudinaryImageResult> {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("api_key", apiKey);
  body.append("timestamp", String(timestamp));
  body.append("folder", folder);
  body.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: "POST", body, cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Cloudinary upload failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    secure_url?: unknown;
    public_id?: unknown;
  };

  if (
    typeof payload.secure_url !== "string" ||
    typeof payload.public_id !== "string"
  ) {
    throw new Error("Cloudinary response did not include an image URL.");
  }

  return {
    url: payload.secure_url,
    publicId: payload.public_id,
  };
}

/** Uploads a doctor or clinic profile image. */
export function uploadCloudinaryImage(
  file: File,
  folder: string,
): Promise<CloudinaryImageResult> {
  return uploadCloudinaryFile(file, folder, "image");
}
