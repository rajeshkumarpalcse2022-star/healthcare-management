"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPrice } from "@/components/bookings/shared";
import { ROLES } from "@/config/roles";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { ListResponse, ItemResponse } from "@/types/api";
import type { InvoiceDto } from "@/lib/billing/dto";
import type { SafeUser } from "@/types/auth";

const STATUS_BADGES: Record<string, BadgeVariant> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  VOID: "danger",
};

const INVOICEABLE_BOOKING_STATUSES = new Set([
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
]);

const STAFF_ROLES = new Set<string>([
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
]);

/**
 * Booking invoice panel (P1-2). Shows the invoice generated from THIS
 * booking's snapshots when one exists (owner + staff), or - for staff on an
 * invoiceable booking - the contextual "Create invoice" action that opens a
 * DRAFT built server-side from the booking's item snapshots. Patients with
 * no invoice render nothing.
 */
export function BookingInvoicePanel({
  bookingId,
  bookingStatus,
  user,
}: {
  bookingId: string;
  bookingStatus: string;
  user: SafeUser;
}) {
  const router = useRouter();
  const [invoice, setInvoice] = React.useState<InvoiceDto | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");

  const isStaff = STAFF_ROLES.has(user.role);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      sourceType: "BOOKING",
      sourceId: bookingId,
      limit: "1",
    });
    apiGet<ListResponse<InvoiceDto>>(`/api/invoices?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setInvoice(result.data[0] ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!loaded) return null;

  if (invoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Invoice
            <Badge variant={STATUS_BADGES[invoice.status] ?? "neutral"} size="sm">
              {invoice.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">
              {invoice.invoiceCode} · {formatPrice(invoice.totalAmount)}
            </p>
            {invoice.status !== "VOID" ? (
              <p className="text-xs text-ink-muted">
                Balance due: {formatPrice(invoice.balance)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(`/billing/${invoice.id}`)}
          >
            Open invoice
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isStaff || !INVOICEABLE_BOOKING_STATUSES.has(bookingStatus)) {
    return null;
  }

  const createInvoice = async () => {
    setCreating(true);
    setError("");
    try {
      const result = await apiSend<ItemResponse<InvoiceDto>>(
        "/api/invoices",
        "POST",
        { sourceType: "BOOKING", sourceId: bookingId },
      );
      router.push(`/billing/${result.data.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "The invoice could not be created.",
      );
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice</CardTitle>
        <p className="text-sm text-ink-muted">
          Build an invoice from this booking&apos;s recorded items and prices.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          disabled={creating}
          onClick={createInvoice}
        >
          {creating ? "Creating…" : "Create invoice from booking"}
        </Button>
      </CardContent>
    </Card>
  );
}
