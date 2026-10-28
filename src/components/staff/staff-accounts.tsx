"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
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
import { PROVISIONABLE_ROLES, ROLE_LABELS } from "@/config/roles";
import { ApiRequestError, apiGet } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";
import type { SafeUser } from "@/types/auth";

import { StaffFormModal } from "./staff-form-modal";

const PAGE_SIZE = 25;

const ROLE_FILTER_OPTIONS = [
  { value: "", label: "All roles" },
  ...PROVISIONABLE_ROLES.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  })),
];

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
 * Staff account directory for `/staff` (SUPER_ADMIN / ADMIN only): search,
 * role filter, paginated listing, plus create and edit dialogs backed by the
 * SA/ADMIN provisioning APIs. Laboratory scope for lab manager / staff
 * accounts stays on the dedicated Staff Access surface (`/admin/users`).
 */
export function StaffAccounts() {
  const [users, setUsers] = React.useState<SafeUser[]>([]);
  const [meta, setMeta] = React.useState<ListMeta>(EMPTY_META);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [modalOpen, setModalOpen] = React.useState(false);
  /** `null` = create mode; otherwise the account being edited. */
  const [editing, setEditing] = React.useState<SafeUser | null>(null);
  /** Bumped by the retry button to re-run the load effect. */
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
    });
    if (appliedSearch) params.set("search", appliedSearch);
    if (roleFilter) params.set("role", roleFilter);

    apiGet<ListResponse<SafeUser>>(`/api/users?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setUsers(result.data);
        setMeta(result.meta);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Accounts could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, roleFilter, page, reloadTick]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (user: SafeUser) => {
    setEditing(user);
    setModalOpen(true);
  };

  const handleSaved = (saved: SafeUser) => {
    const exists = users.some((entry) => entry.id === saved.id);
    if (exists) {
      setUsers((list) =>
        list.map((entry) =>
          entry.id === saved.id ? { ...entry, ...saved } : entry,
        ),
      );
    } else {
      // A newly created account may not belong on the current page; reload
      // so the directory and its totals stay truthful.
      setLoading(true);
      setReloadTick((tick) => tick + 1);
    }
  };

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadTick((tick) => tick + 1);
  };

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Staff accounts</CardTitle>
              <CardDescription>
                Provision privileged accounts and manage their access. Lab
                manager and staff accounts get laboratory scope from
                Administration → Staff Access.
              </CardDescription>
            </div>
            <Button type="button" onClick={openCreate} disabled={loading}>
              Create account
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Search accounts"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            <Select
              label="Filter by role"
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
                setLoading(true);
                setLoadError("");
              }}
              options={ROLE_FILTER_OPTIONS}
            />
          </div>

          {loadError ? (
            <ErrorState
              title="Accounts could not be loaded"
              description={loadError}
              onRetry={retryLoad}
            />
          ) : loading && users.length === 0 ? (
            <SkeletonCard />
          ) : users.length === 0 ? (
            <EmptyState
              title="No accounts found"
              description={
                appliedSearch || roleFilter
                  ? "Try a different search or role filter."
                  : "Create the first privileged account to get started."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Name
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Role
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Status
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Created
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-ink">{user.name}</p>
                        <p className="text-xs text-ink-muted">{user.email}</p>
                        {user.phone ? (
                          <p className="text-xs text-ink-subtle">{user.phone}</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="info" size="sm">
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={user.isActive ? "success" : "warning"}
                          size="sm"
                        >
                          {user.isActive ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(user)}
                        >
                          Edit
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

      <StaffFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        user={editing}
        onSaved={handleSaved}
      />
    </>
  );
}
