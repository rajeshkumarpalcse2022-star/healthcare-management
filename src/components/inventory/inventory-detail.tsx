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
import { Pagination } from "@/components/labs/pagination";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";
import type { InventoryItemDto, StockTransactionDto } from "@/lib/inventory/dto";

const HISTORY_PAGE_SIZE = 10;

const CATEGORY_OPTIONS = [
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "REAGENT", label: "Reagent" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "OTHER", label: "Other" },
];

const UNIT_OPTIONS = [
  { value: "PIECE", label: "Piece" },
  { value: "BOX", label: "Box" },
  { value: "VIAL", label: "Vial" },
  { value: "ML", label: "ml" },
  { value: "L", label: "L" },
  { value: "G", label: "g" },
  { value: "KG", label: "kg" },
];

const TYPE_OPTIONS = [
  { value: "IN", label: "Receive (IN)" },
  { value: "OUT", label: "Consume (OUT)" },
  { value: "ADJUST", label: "Cycle count (ADJUST)" },
];

const DIRECTION_OPTIONS = [
  { value: "up", label: "Increase stock" },
  { value: "down", label: "Decrease stock" },
];

const EXPIRY_BADGES: Record<string, BadgeVariant> = {
  EXPIRED: "danger",
  EXPIRING: "warning",
  OK: "neutral",
};

const STATUS_BADGES: Record<string, BadgeVariant> = {
  APPLIED: "success",
  REJECTED: "danger",
  PENDING: "warning",
};

const TYPE_BADGES: Record<string, BadgeVariant> = {
  IN: "success",
  OUT: "info",
  ADJUST: "neutral",
};

const EMPTY_HISTORY_META: ListMeta = {
  page: 1,
  limit: HISTORY_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

type ModalKind = "move" | "edit" | null;

/**
 * Item detail for `/inventory/[id]`: stock indicators, the movement form
 * (the only UI that changes quantity - signed deltas with the equipment
 * OUT guard disabled client-side as well), metadata editing without a
 * quantity field, and the append-only movement history.
 */
export function InventoryDetail({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = React.useState<InventoryItemDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [modal, setModal] = React.useState<ModalKind>(null);

  const [history, setHistory] = React.useState<StockTransactionDto[]>([]);
  const [historyMeta, setHistoryMeta] = React.useState<ListMeta>(
    EMPTY_HISTORY_META,
  );
  const [historyError, setHistoryError] = React.useState("");

  const [moveType, setMoveType] = React.useState("IN");
  const [moveQty, setMoveQty] = React.useState("");
  const [moveDirection, setMoveDirection] = React.useState("up");

  const [editName, setEditName] = React.useState("");
  const [editCategory, setEditCategory] = React.useState("CONSUMABLE");
  const [editUnit, setEditUnit] = React.useState("PIECE");
  const [editReorder, setEditReorder] = React.useState("0");
  const [editExpiry, setEditExpiry] = React.useState("");

  const reload = React.useCallback(() => {
    apiGet<{ data: InventoryItemDto }>(`/api/inventory/${id}`)
      .then((result) => {
        setItem(result.data);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "The item could not be loaded.",
        );
        setLoading(false);
      });
  }, [id]);

  const reloadHistory = React.useCallback(
    (page: number) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(HISTORY_PAGE_SIZE),
      });
      apiGet<ListResponse<StockTransactionDto>>(
        `/api/inventory/${id}/transactions?${params.toString()}`,
      )
        .then((result) => {
          setHistory(result.data);
          setHistoryMeta(result.meta);
          setHistoryError("");
        })
        .catch((error: unknown) => {
          setHistoryError(
            error instanceof ApiRequestError
              ? error.message
              : "Stock history could not be loaded.",
          );
        });
    },
    [id],
  );

  React.useEffect(() => {
    reload();
    reloadHistory(1);
  }, [reload, reloadHistory]);

  const openMove = () => {
    setActionError("");
    setMoveType("IN");
    setMoveQty("");
    setMoveDirection("up");
    setModal("move");
  };

  const openEdit = () => {
    if (!item) return;
    setActionError("");
    setEditName(item.name);
    setEditCategory(item.category);
    setEditUnit(item.unit);
    setEditReorder(String(item.reorderLevel));
    setEditExpiry(item.expiryDate ? item.expiryDate.slice(0, 10) : "");
    setModal("edit");
  };

  const submitMove = async () => {
    if (!item) return;
    const quantity = Number(moveQty);
    if (!Number.isInteger(quantity) || quantity <= 0) return;

    let delta = quantity;
    if (moveType === "OUT") delta = -quantity;
    if (moveType === "ADJUST") {
      delta = moveDirection === "down" ? -quantity : quantity;
    }

    setBusy(true);
    setActionError("");
    try {
      await apiSend(`/api/inventory/${item.id}/transactions`, "POST", {
        type: moveType,
        delta,
      });
      setModal(null);
      reload();
      reloadHistory(1);
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "The movement could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!item) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend(`/api/inventory/${item.id}`, "PATCH", {
        name: editName.trim(),
        category: editCategory,
        unit: editUnit,
        reorderLevel: Number(editReorder),
        expiryDate: editExpiry
          ? new Date(editExpiry).toISOString()
          : null,
      });
      setModal(null);
      reload();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "The item could not be updated.",
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
            title="Item could not be loaded"
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

  if (loading || !item) {
    return (
      <Card className="mt-6">
        <CardContent>
          <SkeletonCard />
        </CardContent>
      </Card>
    );
  }

  const isEquipment = item.category === "EQUIPMENT";
  const outDisabled = isEquipment;

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {item.name}
                <Badge variant="neutral" size="sm">
                  {item.category}
                </Badge>
                {item.lowStock ? (
                  <Badge variant="warning" size="sm">
                    Low stock
                  </Badge>
                ) : null}
                {item.expiryState !== "OK" ? (
                  <Badge variant={EXPIRY_BADGES[item.expiryState]} size="sm">
                    {item.expiryState}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {item.unit} unit · updated {formatDateTime(item.updatedAt)}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push("/inventory")}
              >
                Back to inventory
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={openEdit}
              >
                Edit item
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={openMove}
              >
                Record movement
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">In stock</p>
              <p className="text-lg font-semibold text-ink">
                {item.quantity} {item.unit.toLowerCase()}
              </p>
            </div>
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Reorder level</p>
              <p className="text-lg font-semibold text-ink">
                {item.reorderLevel}
              </p>
            </div>
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Unit</p>
              <p className="text-lg font-semibold text-ink">{item.unit}</p>
            </div>
            <div className="rounded-panel border border-border p-4">
              <p className="text-xs text-ink-muted">Expiry</p>
              <p className="text-lg font-semibold text-ink">
                {formatDate(item.expiryDate)}
              </p>
            </div>
          </div>

          {isEquipment ? (
            <p className="rounded-panel border border-border bg-surface-muted p-3 text-sm text-ink-muted">
              Equipment is counted, not consumed: OUT movements are blocked -
              use a cycle count (ADJUST) for corrections.
            </p>
          ) : null}

          <div>
            <h3 className="text-sm font-medium text-ink">
              Movement history (append-only)
            </h3>
            {historyError ? (
              <p className="form-error mt-2" role="alert">
                {historyError}
              </p>
            ) : history.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No movements yet - record the opening receipt as an IN
                movement.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[44rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        When
                      </th>
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        Movement
                      </th>
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        Change
                      </th>
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        Balance after
                      </th>
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        Status
                      </th>
                      <th className="py-2 pr-4 font-medium text-ink-muted">
                        By
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-border/60 last:border-b-0"
                      >
                        <td className="py-2 pr-4 text-ink-muted">
                          {formatDateTime(tx.createdAt)}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={TYPE_BADGES[tx.type] ?? "neutral"} size="sm">
                            {tx.type}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-ink-muted">
                          {tx.delta > 0 ? "+" : ""}
                          {tx.delta}
                        </td>
                        <td className="py-2 pr-4 text-ink-muted">
                          {tx.quantityAfter ?? "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={STATUS_BADGES[tx.status] ?? "neutral"}
                            size="sm"
                          >
                            {tx.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-ink-muted">
                          {tx.performedByName ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Pagination
                  meta={historyMeta}
                  onPageChange={(next) => {
                    reloadHistory(next);
                  }}
                  compact
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Modal
        open={modal === "move"}
        onClose={() => setModal(null)}
        title="Record stock movement"
        description="Signed and guarded server-side: OUT can never exceed current stock; equipment never moves OUT."
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
              disabled={
                busy ||
                !Number.isInteger(Number(moveQty)) ||
                Number(moveQty) <= 0 ||
                (outDisabled && moveType === "OUT")
              }
              onClick={submitMove}
            >
              {busy ? "Saving…" : "Record movement"}
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
          <Select
            label="Movement type"
            value={moveType}
            onChange={(event) => setMoveType(event.target.value)}
            options={TYPE_OPTIONS}
          />
          {moveType === "ADJUST" ? (
            <Select
              label="Direction"
              value={moveDirection}
              onChange={(event) => setMoveDirection(event.target.value)}
              options={DIRECTION_OPTIONS}
            />
          ) : null}
          <Input
            label="Quantity"
            type="number"
            min="1"
            step="1"
            required
            value={moveQty}
            onChange={(event) => setMoveQty(event.target.value)}
            hint={`Current stock: ${item.quantity} ${item.unit.toLowerCase()}.`}
          />
          {outDisabled && moveType === "OUT" ? (
            <p className="form-error" role="alert">
              Equipment stock cannot be moved OUT - use a cycle count.
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={modal === "edit"}
        onClose={() => setModal(null)}
        title="Edit item details"
        description="Metadata only - quantity is never edited here, movements keep the history complete."
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
              disabled={
                busy ||
                editName.trim().length < 2 ||
                !Number.isInteger(Number(editReorder)) ||
                Number(editReorder) < 0
              }
              onClick={submitEdit}
            >
              {busy ? "Saving…" : "Save changes"}
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
            label="Item name"
            required
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Category"
              value={editCategory}
              onChange={(event) => setEditCategory(event.target.value)}
              options={CATEGORY_OPTIONS}
            />
            <Select
              label="Unit"
              value={editUnit}
              onChange={(event) => setEditUnit(event.target.value)}
              options={UNIT_OPTIONS}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Reorder level"
              type="number"
              min="0"
              step="1"
              value={editReorder}
              onChange={(event) => setEditReorder(event.target.value)}
            />
            <Input
              label="Expiry date (optional)"
              type="date"
              value={editExpiry}
              onChange={(event) => setEditExpiry(event.target.value)}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
