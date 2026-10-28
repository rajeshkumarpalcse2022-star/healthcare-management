"use client";

import Link from "next/link";
import * as React from "react";

import { IconArrowRight } from "@/components/icons";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiListResult } from "@/hooks/use-api-list";
import { cn } from "@/lib/utils/cn";
import type { IconComponent } from "@/types/navigation";

/**
 * Shared dashboard widget shell (Phase 2).
 *
 * One compact card per data section: header (title + exact count pill +
 * optional extra badges + view-all link), then exactly one of loading
 * skeleton / error-with-retry / empty state / rows. Every card wraps an
 * existing read API - the shell never invents data and shows no placeholder
 * metrics.
 */
export interface DashboardWidgetProps<T> {
  title: string;
  /** Exact `meta.total` from the API, rendered as a header pill. */
  count?: number | null;
  /** Extra header badges (for example "2 awaiting acceptance"). */
  badges?: React.ReactNode;
  /** Header link, e.g. "View all" or "Open queue". */
  link?: { label: string; href: string };
  /** List state of the underlying request. */
  state: ApiListResult<T>;
  /** Final rows to render; `null` while they are still being shaped. */
  rows: T[] | null;
  onRetry: () => void;
  emptyIcon?: IconComponent;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  renderItem: (row: T, index: number) => React.ReactNode;
  skeletonRows?: number;
}

export function DashboardWidget<T>({
  title,
  count,
  badges,
  link,
  state,
  rows,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  renderItem,
  skeletonRows = 3,
}: DashboardWidgetProps<T>) {
  const items = rows ?? [];
  const loading = state.loading || rows === null;
  const showCount = !state.error && !loading && typeof count === "number";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="min-w-0 truncate">{title}</CardTitle>
            {showCount ? (
              <Badge variant="primary" size="sm">
                {count}
              </Badge>
            ) : null}
            {badges}
          </div>
          {link ? (
            <Link
              href={link.href}
              className="shrink-0 text-xs font-medium text-primary transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {link.label}
              <IconArrowRight className="ml-1 inline size-3.5" />
            </Link>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {!state.loading && state.error ? (
          <ErrorState
            description={state.error}
            onRetry={onRetry}
            className="py-6"
          />
        ) : loading ? (
          <div className="space-y-3" aria-hidden="true">
            {Array.from({ length: skeletonRows }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <ul className="space-y-1">
            {items.map((row, index) => renderItem(row, index))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface DashboardRowProps {
  href: string;
  /** Primary line - reference code or display name. */
  title: string;
  /** Secondary line - schedule, laboratory, patient, items. */
  meta?: React.ReactNode;
  badge?: string;
  badgeVariant?: BadgeVariant;
  /** Renders the primary line in monospace (reference codes). */
  mono?: boolean;
}

/** One compact, fully linked dashboard row. */
export function DashboardRow({
  href,
  title,
  meta,
  badge,
  badgeVariant = "neutral",
  mono = false,
}: DashboardRowProps) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium text-ink",
              mono && "font-mono text-xs font-semibold tracking-tight",
            )}
          >
            {title}
          </span>
          {meta ? (
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              {meta}
            </span>
          ) : null}
        </span>
        {badge ? (
          <Badge variant={badgeVariant} size="sm" dot>
            {badge}
          </Badge>
        ) : null}
        <IconArrowRight className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary-hover" />
      </Link>
    </li>
  );
}
