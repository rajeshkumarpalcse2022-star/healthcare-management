import Image from "next/image";
import * as React from "react";

import { cn } from "@/lib/utils/cn";

export type EntityAvatarShape = "circle" | "square";

export interface EntityAvatarProps {
  src: string | null | undefined;
  alt: string;
  fallback: React.ReactNode;
  className?: string;
  shape?: EntityAvatarShape;
  sizes?: string;
}

/**
 * Shared doctor/clinic image with a deterministic icon fallback.
 *
 * Uses `next/image` so Cloudinary assets are served through the configured
 * remote pattern and optimised for the rendered size.
 */
export function EntityAvatar({
  src,
  alt,
  fallback,
  className,
  shape = "circle",
  sizes = "96px",
}: EntityAvatarProps) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-primary-light text-primary-hover ring-1 ring-border dark:bg-primary/10 dark:text-brand-400",
        shape === "circle" ? "rounded-full" : "rounded-control",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          unoptimized
          className="object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center" aria-hidden="true">
          {fallback}
        </span>
      )}
    </span>
  );
}
