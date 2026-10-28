import * as React from "react";

import { IconShieldCheck } from "@/components/icons";
import { cn } from "@/lib/utils/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-active text-white shadow-sm",
        className,
      )}
      aria-hidden="true"
    >
      <IconShieldCheck className="size-5" />
    </span>
  );
}
