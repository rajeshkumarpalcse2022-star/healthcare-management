"use client";

import * as React from "react";

import { IconCamera, IconTrash } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { apiUpload, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import { cn } from "@/lib/utils/cn";
import { EntityAvatar } from "./entity-avatar";

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageUploadFieldProps {
  kind: "doctor" | "clinic";
  value: string | null;
  onChange: (url: string | null) => void;
  fallback: React.ReactNode;
  label: string;
  description?: string;
  className?: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to preview the image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Profile image picker with an immediate local preview. The selected file is
 * uploaded to Cloudinary through the authenticated server route; only the
 * resulting secure URL is stored on the doctor or clinic record.
 */
export function ImageUploadField({
  kind,
  value,
  onChange,
  fallback,
  label,
  description,
  className,
}: ImageUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Only JPG, PNG, WebP or GIF images are supported.");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be 5 MB or smaller.");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const preview = await readFileAsDataUrl(file);
      setPreviewUrl(preview);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const result = await apiUpload<ItemResponse<{ url: string }>>(
        "/api/uploads/cloudinary",
        formData,
      );
      onChange(result.data.url);
      setPreviewUrl(null);
    } catch (uploadError) {
      setPreviewUrl(null);
      setError(
        uploadError instanceof ApiRequestError
          ? uploadError.message
          : "Unable to upload the image. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  const shownImage = previewUrl ?? value;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <EntityAvatar
          src={shownImage}
          alt={label}
          fallback={fallback}
          className="size-20 shrink-0 sm:size-24"
          sizes="96px"
        />

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <IconCamera className="size-4" />
              {value ? "Change photo" : "Add photo"}
            </Button>
            {value && !uploading ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPreviewUrl(null);
                  setError(null);
                  onChange(null);
                }}
              >
                <IconTrash className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {description ?? "JPG, PNG, WebP or GIF. Maximum 5 MB."}
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={handleFileChange}
        disabled={uploading}
      />
    </div>
  );
}
