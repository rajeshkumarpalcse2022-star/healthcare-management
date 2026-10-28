import * as React from "react";

import { cn } from "@/lib/utils/cn";

export type ContainerSize = "default" | "narrow" | "wide" | "full";

const sizeClasses: Record<ContainerSize, string> = {
  default: "",
  narrow: "container-page-narrow",
  wide: "container-page-wide",
  full: "max-w-none",
};

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
}

/**
 * Responsive container system shared by every screen.
 * Padding and max-width scale from mobile to large desktop.
 */
export function Container({
  size = "default",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn("container-page", sizeClasses[size], className)}
      {...props}
    />
  );
}
