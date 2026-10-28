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
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/labs/pagination";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";
import type { InventoryItemDto } from "@/lib/inventory/dto";

const PAGE_SIZE = 25;

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

const ALL_OPTION = { value: "all", label: "All" };

const CATEGORY_FILTER_OPTIONS = [
  ALL_OPTION,
  ...CATEGORY_OPTIONS,
];

const BOOL_FILTER_OPTIONS = [
  ALL_OPTION,
  { value: "true", label: "Yes" },
];

const EXPIRY_BADGES: Record<string, BadgeVariant> = {
  EXPIRED: "danger",
  EXPIRING: "warning",
  OK: "neutral",
};

const EMPTY_META: ListMeta = {
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

interface LabOption {
  id: string;
  name: string;
}

/**
 * Inventory table for `/inventory`: name/category search, category and
 * low-stock / expiring filters, paginated rows with server-computed
 * indicators, plus the item-create modal (quantity always starts at zero -
 * opening stock is recorded as an IN transaction on the item page).
 */
export function InventoryList() {
  const router = useRouter();
  const [items, setItems] = React.useState<InventoryItemDto[]>([]);
  const [meta, setMeta] = React.useState<ListMeta>(EMPTY_META);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [lowStock, setLowStock] = React.useState("all");
  const [expiring, setExpiring] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [reloadTick, setReloadTick] = React.useState(0);

  const [labs, setLabs] = React.useState<LabOption[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState("");
  const [formName, setFormName] = React.useState("");
  const [formCategory, setFormCategory] = React.useState("CONSUMABLE");
  const [formUnit, setFormUnit] = React.useState("PIECE");
  const [formReorder, setFormReorder] = React.useState("10");
  const [formExpiry, setFormExpiry] = React.useState("");
  const [formLab, setFormLab] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<LabOption>>("/api/laboratories?limit=50")
      .then((result) => {
        if (cancelled) return;
        setLabs(result.data);
        setFormLab((current) => current || (result.data[0]?.id ?? ""));
      })
      .catch(() => {
        // Laboratory names are cosmetic for the table; creation re-validates
        // scope server-side, so a failed prefetch only hides labels.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    });
    if (appliedSearch) params.set("search", appliedSearch);
    if (category !== "all") params.set("category", category);
    if (lowStock === "true") params.set("lowStock", "true");
    if (expiring === "true") params.set("expiring", "true");

    apiGet<ListResponse<InventoryItemDto>>(`/api/inventory?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.data);
        setMeta(result.meta);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Inventory could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, category, lowStock, expiring, page, reloadTick]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadTick((tick) => tick + 1);
  };

  const openCreate = () => {
    setCreateError("");
    setFormName("");
    setFormCategory("CONSUMABLE");
    setFormUnit("PIECE");
    setFormReorder("10");
    setFormExpiry("");
    setFormLab(labs[0]?.id ?? "");
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    setBusy(true);
    setCreateError("");
    try {
      await apiSend("/api/inventory", "POST", {
        name: formName.trim(),
        category: formCategory,
        unit: formUnit,
        reorderLevel: Number(formReorder || 0),
        expiryDate: formExpiry
          ? new Date(formExpiry).toISOString()
          : null,
        laboratoryId: formLab,
      });
      setCreateOpen(false);
      setPage(1);
      setReloadTick((tick) => tick + 1);
    } catch (error) {
      setCreateError(
        error instanceof ApiRequestError
          ? error.message
          : "The item could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };

  const labName = (id: string) =>
    labs.find((lab) => lab.id === id)?.name ?? "—";

  const hasFilters =
    appliedSearch !== "" ||
    category !== "all" ||
    lowStock !== "true" ||
    expiring !== "true";

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Stock items</CardTitle>
              <CardDescription>
                Every quantity change is an appended movement - receipts,
                consumptions and cycle counts. Items start at zero.
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={openCreate}>
              New item
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Search items"
              placeholder="Gloves, buffer, culture…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            <Select
              label="Category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
                setLoading(true);
                setLoadError("");
              }}
              options={CATEGORY_FILTER_OPTIONS}
            />
            <Select
              label="Low stock"
              value={lowStock}
              onChange={(event) => {
                setLowStock(event.target.value);
                setPage(1);
                setLoading(true);
                setLoadError("");
              }}
              options={BOOL_FILTER_OPTIONS}
            />
            <Select
              label="Expiring soon"
              value={expiring}
              onChange={(event) => {
                setExpiring(event.target.value);
                setPage(1);
                setLoading(true);
                setLoadError("");
              }}
              options={BOOL_FILTER_OPTIONS}
            />
          </div>

          {loadError ? (
            <ErrorState
              title="Inventory could not be loaded"
              description={loadError}
              onRetry={retryLoad}
            />
          ) : loading && items.length === 0 ? (
            <SkeletonCard />
          ) : items.length === 0 ? (
            <EmptyState
              title="No stock items found"
              description={
                hasFilters
                  ? "Try different search or filters."
                  : "Create the first item, then record its opening stock."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Item
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Laboratory
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      In stock
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Expiry
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Reorder at
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Updated
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-ink">{item.name}</p>
                        <p className="text-xs text-ink-muted">
                          {item.category}
                        </p>
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {labName(item.laboratoryId)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-ink">
                          {item.quantity} {item.unit.toLowerCase()}
                        </span>
                        {item.lowStock ? (
                          <Badge variant="warning" size="sm">
                            Low
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-ink-muted">
                          {formatDate(item.expiryDate)}
                        </span>
                        {item.expiryState !== "OK" ? (
                          <Badge
                            variant={EXPIRY_BADGES[item.expiryState]}
                            size="sm"
                          >
                            {item.expiryState}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {item.reorderLevel}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {formatDate(item.updatedAt)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/inventory/${item.id}`)}
                        >
                          Manage
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New stock item"
        description="The item starts at zero - record opening stock as an IN movement on the item page."
        dismissible={!busy}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                formName.trim().length < 2 ||
                !formLab ||
                !Number.isInteger(Number(formReorder)) ||
                Number(formReorder) < 0
              }
              onClick={submitCreate}
            >
              {busy ? "Creating…" : "Create item"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
          <Input
            label="Item name"
            required
            value={formName}
            onChange={(event) => setFormName(event.target.value)}
            placeholder="e.g. Nitrile gloves (M)"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Category"
              value={formCategory}
              onChange={(event) => setFormCategory(event.target.value)}
              options={CATEGORY_OPTIONS}
            />
            <Select
              label="Unit"
              value={formUnit}
              onChange={(event) => setFormUnit(event.target.value)}
              options={UNIT_OPTIONS}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Reorder level"
              type="number"
              min="0"
              step="1"
              value={formReorder}
              onChange={(event) => setFormReorder(event.target.value)}
              hint="At or below this quantity the row flags as low stock."
            />
            <Input
              label="Expiry date (optional)"
              type="date"
              value={formExpiry}
              onChange={(event) => setFormExpiry(event.target.value)}
            />
          </div>
          <Select
            label="Laboratory"
            required
            value={formLab}
            onChange={(event) => setFormLab(event.target.value)}
            options={labs.map((lab) => ({ value: lab.id, label: lab.name }))}
          />
        </div>
      </Modal>
    </>
  );
}
