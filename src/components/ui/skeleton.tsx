import { cn } from "@/lib/utils/cn";

export interface SkeletonProps {
  className?: string;
  /** Accessible label; the block is decorative by default. */
  label?: string;
}

export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <div
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("skeleton", className)}
    />
  );
}

/** Convenience layouts for common loading patterns. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3.5", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("card p-5", className)} aria-hidden="true">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-4 h-7 w-20" />
      <Skeleton className="mt-3 h-3 w-36" />
    </div>
  );
}
