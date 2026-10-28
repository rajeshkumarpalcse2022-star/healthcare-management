"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/labs/pagination";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { formatPrice } from "@/components/bookings/shared";
import { ApiRequestError, apiGet } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";
import type { InvoiceDto } from "@/lib/billing/dto";

const PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "ISSUED", label: "Issued" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];

const STATUS_BADGES: Record<string, BadgeVariant> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  VOID: "danger",
};

const SOURCE_LABELS: Record<string, string> = {
  BOOKING: "Lab booking",
  HOME_COLLECTION: "Home collection",
  MANUAL: "Manual",
};

const EMPTY_META: ListMeta = {
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

/**
 * Invoice ledger for `/billing`: invoice-code search, status filter and a
 * paginated table (patient, laboratory, source, total, outstanding balance).
 * Creation happens contextually from booking detail; rows open the invoice.
 */
export function InvoiceAccounts() {
  const router = useRouter();
  const [invoices, setInvoices] = React.useState<InvoiceDto[]>([]);
  const [meta, setMeta] = React.useState<ListMeta>(EMPTY_META);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [reloadTick, setReloadTick] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === appliedSearch) return;
      setAppliedSearch(next);
      setPage(1);
      setLoading(true);
      setLoadError("");
    }, 300);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      status: statusFilter,
    });
    if (appliedSearch) params.set("search", appliedSearch);

    apiGet<ListResponse<InvoiceDto>>(`/api/invoices?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setInvoices(result.data);
        setMeta(result.meta);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Invoices could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, statusFilter, page, reloadTick]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadTick((tick) => tick + 1);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            One ledger per invoice: draft, issue, collect payments and
            refunds. Balances recompute from the payment ledger on every load.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Search invoices"
            placeholder="INV-2026-000001"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
          <Select
            label="Filter by status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
              setLoading(true);
              setLoadError("");
            }}
            options={STATUS_FILTER_OPTIONS}
          />
        </div>

        {loadError ? (
          <ErrorState
            title="Invoices could not be loaded"
            description={loadError}
            onRetry={retryLoad}
          />
        ) : loading && invoices.length === 0 ? (
          <SkeletonCard />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            description={
              appliedSearch || statusFilter !== "all"
                ? "Try a different search or status filter."
                : "Open a booking and issue its first invoice."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Invoice
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Patient
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Source
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Total
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Balance
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Status
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="py-3 pr-4">
                      <p className="font-medium text-ink">
                        {invoice.invoiceCode}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(invoice.createdAt)}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {invoice.patientName ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {SOURCE_LABELS[invoice.sourceType] ?? invoice.sourceType}
                      {invoice.sourceCode ? (
                        <p className="text-xs text-ink-subtle">
                          {invoice.sourceCode}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {formatPrice(invoice.totalAmount)}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {invoice.status === "VOID"
                        ? "—"
                        : formatPrice(invoice.balance)}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge
                        variant={STATUS_BADGES[invoice.status] ?? "neutral"}
                        size="sm"
                      >
                        {invoice.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/billing/${invoice.id}`)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination
              meta={meta}
              onPageChange={(next) => {
                setPage(next);
                setLoading(true);
                setLoadError("");
              }}
              compact
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
