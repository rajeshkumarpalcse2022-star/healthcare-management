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
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice } from "@/components/bookings/shared";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { InvoiceDto } from "@/lib/billing/dto";

const STATUS_BADGES: Record<string, BadgeVariant> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  VOID: "danger",
};

const METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

type ModalKind = "payment" | "refund" | "void" | null;

/**
 * Invoice detail for `/billing/[id]`: items, totals, ledger and timeline
 * plus the staff actions - issue (DRAFT), void (DRAFT / unpaid ISSUED with a
 * required reason), record payment (ISSUED) and record refund (PAID). Every
 * action re-reads the server state so balances and statuses stay honest.
 */
export function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = React.useState<InvoiceDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [modal, setModal] = React.useState<ModalKind>(null);

  const [payAmount, setPayAmount] = React.useState("");
  const [payMethod, setPayMethod] = React.useState("CASH");
  const [payReference, setPayReference] = React.useState("");
  const [payNote, setPayNote] = React.useState("");
  const [voidReason, setVoidReason] = React.useState("");

  const reload = React.useCallback(() => {
    apiGet<{ data: InvoiceDto }>(`/api/invoices/${id}`)
      .then((result) => {
        setInvoice(result.data);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "The invoice could not be loaded.",
        );
        setLoading(false);
      });
  }, [id]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const openModal = (kind: Exclude<ModalKind, null>) => {
    setActionError("");
    if (kind === "payment") {
      setPayAmount(invoice ? invoice.balance.toFixed(2) : "");
      setPayMethod("CASH");
      setPayReference("");
      setPayNote("");
    } else if (kind === "refund") {
      setPayAmount(invoice ? invoice.netPaid.toFixed(2) : "");
      setPayMethod("CASH");
      setPayReference("");
      setPayNote("");
    } else {
      setVoidReason("");
    }
    setModal(kind);
  };

  const submitPayment = async () => {
    if (!invoice || modal === null) return;
    const kind = modal === "payment" ? "PAYMENT" : "REFUND";
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`/api/invoices/${invoice.id}/payments`, "POST", {
        kind,
        amount: Number(payAmount),
        method: payMethod,
        reference: payReference.trim() || null,
        note: payNote.trim() || null,
      });
      setModal(null);
      reload();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "The transaction could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitVoid = async () => {
    if (!invoice) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`/api/invoices/${invoice.id}`, "PATCH", {
        status: "VOID",
        voidReason: voidReason.trim(),
      });
      setModal(null);
      reload();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "The invoice could not be voided.",
      );
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!invoice) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`/api/invoices/${invoice.id}`, "PATCH", {
        status: "ISSUED",
      });
      reload();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "The invoice could not be issued.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Card className="mt-6">
        <CardContent>
          <ErrorState
            title="Invoice could not be loaded"
            description={loadError}
            onRetry={() => {
              setLoading(true);
              setLoadError("");
              reload();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  if (loading || !invoice) {
    return (
      <Card className="mt-6">
        <CardContent>
          <SkeletonCard />
        </CardContent>
      </Card>
    );
  }

  const canVoid =
    invoice.status === "DRAFT" ||
    (invoice.status === "ISSUED" && invoice.netPaid === 0);

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {invoice.invoiceCode}
                <Badge
                  variant={STATUS_BADGES[invoice.status] ?? "neutral"}
                  size="sm"
                >
                  {invoice.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                {invoice.patientName ?? "Patient"} ·{" "}
                {invoice.laboratory?.name ?? "Laboratory"} · created{" "}
                {formatDateTime(invoice.createdAt)}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/billing")}>
                Back to invoices
              </Button>
              {invoice.status === "DRAFT" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={issue}
                  >
                    Issue invoice
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => openModal("void")}
                  >
                    Void
                  </Button>
                </>
              ) : null}
              {invoice.status === "ISSUED" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || invoice.balance <= 0}
                    onClick={() => openModal("payment")}
                  >
                    Record payment
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || !canVoid}
                    title={
                      canVoid
                        ? undefined
                        : "Record refunds before voiding a paid invoice."
                    }
                    onClick={() => openModal("void")}
                  >
                    Void
                  </Button>
                </>
              ) : null}
              {invoice.status === "PAID" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || invoice.netPaid <= 0}
                  onClick={() => openModal("refund")}
                >
                  Record refund
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Total</p>
              <p className="text-lg font-semibold text-ink">
                {formatPrice(invoice.totalAmount)}
              </p>
            </div>
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Net paid</p>
              <p className="text-lg font-semibold text-ink">
                {formatPrice(invoice.netPaid)}
              </p>
            </div>
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Balance due</p>
              <p className="text-lg font-semibold text-ink">
                {invoice.status === "VOID"
                  ? "—"
                  : formatPrice(invoice.balance)}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-ink">Line items</h3>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-ink-muted">Item</th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">Qty</th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">Unit</th>
                  <th className="py-2 pr-4 text-right font-medium text-ink-muted">
                    Line total
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr
                    key={`${invoice.id}-item-${index}`}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="py-2 pr-4 text-ink">{item.description}</td>
                    <td className="py-2 pr-4 text-ink-muted">
                      {item.quantity}
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">
                      {formatPrice(item.unitPrice)}
                    </td>
                    <td className="py-2 pr-4 text-right text-ink-muted">
                      {formatPrice(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invoice.notes || invoice.voidReason ? (
            <div className="space-y-2 rounded-panel border border-border bg-surface-muted p-4 text-sm">
              {invoice.notes ? (
                <p className="text-ink-muted">
                  <span className="font-medium text-ink">Notes: </span>
                  {invoice.notes}
                </p>
              ) : null}
              {invoice.voidReason ? (
                <p className="text-ink-muted">
                  <span className="font-medium text-danger">Void reason: </span>
                  {invoice.voidReason}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-medium text-ink">Payments</h3>
            {invoice.payments.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No payments recorded yet.
              </p>
            ) : (
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Reference
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Kind
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Method
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Amount
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Recorded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <td className="py-2 pr-4">
                        <p className="text-ink">{payment.paymentCode}</p>
                        {payment.reference ? (
                          <p className="text-xs text-ink-subtle">
                            {payment.reference}
                          </p>
                        ) : null}
                        {payment.note ? (
                          <p className="text-xs text-ink-subtle">
                            {payment.note}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={
                            payment.kind === "PAYMENT" ? "success" : "warning"
                          }
                          size="sm"
                        >
                          {payment.kind}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-ink-muted">
                        {payment.method}
                      </td>
                      <td className="py-2 pr-4 text-ink-muted">
                        {payment.kind === "REFUND" ? "−" : ""}
                        {formatPrice(payment.amount)}
                      </td>
                      <td className="py-2 pr-4 text-ink-muted">
                        {formatDateTime(payment.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {invoice.events && invoice.events.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-ink">Audit timeline</h3>
              <ol className="mt-2 space-y-2">
                {invoice.events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline gap-2 text-sm text-ink-muted"
                  >
                    <span className="font-medium text-ink">
                      {event.action}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      {formatDateTime(event.createdAt)}
                      {event.actorName ? ` · ${event.actorName}` : ""}
                      {event.fromStatus || event.toStatus
                        ? ` · ${event.fromStatus ?? "—"} → ${event.toStatus ?? "—"}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={modal === "payment" || modal === "refund"}
        onClose={() => setModal(null)}
        title={modal === "refund" ? "Record refund" : "Record payment"}
        description={
          modal === "refund"
            ? "Appended to the ledger; a full refund returns the invoice to ISSUED."
            : "Appended to the ledger; clearing the balance settles the invoice as PAID."
        }
        dismissible={!busy}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !(Number(payAmount) > 0)}
              onClick={submitPayment}
            >
              {busy ? "Saving…" : "Record"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
          <Input
            label="Amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={payAmount}
            onChange={(event) => setPayAmount(event.target.value)}
          />
          <Select
            label="Method"
            value={payMethod}
            onChange={(event) => setPayMethod(event.target.value)}
            options={METHOD_OPTIONS}
          />
          <Input
            label="Reference (optional)"
            placeholder="Receipt / transaction id"
            value={payReference}
            onChange={(event) => setPayReference(event.target.value)}
          />
          <Textarea
            label="Note (optional, internal)"
            rows={2}
            value={payNote}
            onChange={(event) => setPayNote(event.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={modal === "void"}
        onClose={() => setModal(null)}
        title="Void invoice"
        description="Voiding is terminal. Paid invoices must be refunded first."
        dismissible={!busy}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || voidReason.trim().length < 3}
              onClick={submitVoid}
            >
              {busy ? "Voiding…" : "Void invoice"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
          <Textarea
            label="Reason"
            required
            rows={3}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            hint="Required - stored on the invoice and in the audit timeline."
          />
        </div>
      </Modal>
    </>
  );
}
