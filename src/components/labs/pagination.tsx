"use client";

import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ListMeta } from "@/types/api";
import { rangeLabel } from "./shared";

const PAGE_SIZE_OPTIONS = [
  { value: "10", label: "10 / page" },
  { value: "20", label: "20 / page" },
  { value: "50", label: "50 / page" },
];

export interface PaginationProps {
  meta: ListMeta;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  /** Hides the page-size control (e.g. single-page parameter lists). */
  compact?: boolean;
}

/**
 * Server-driven pagination bar: range summary, page-size control and
 * previous / next navigation. All controls are real buttons/inputs so they
 * stay keyboard accessible.
 */
export function Pagination({
  meta,
  onPageChange,
  onLimitChange,
  compact = false,
}: PaginationProps) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-sm text-ink-muted" aria-live="polite">
        {rangeLabel(meta.page, meta.limit, meta.total)}
        {meta.totalPages > 1 ? (
          <span className="text-ink-subtle">
            {" "}
            · page {meta.page} of {meta.totalPages}
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {!compact && onLimitChange ? (
          <Select
            aria-label="Results per page"
            className="form-control-sm w-auto min-w-28"
            value={String(meta.limit)}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            options={PAGE_SIZE_OPTIONS}
          />
        ) : null}

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(meta.page - 1)}
            disabled={!meta.hasPrev}
            aria-label="Previous page"
          >
            <IconChevronLeft className="size-4" />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(meta.page + 1)}
            disabled={!meta.hasNext}
            aria-label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
