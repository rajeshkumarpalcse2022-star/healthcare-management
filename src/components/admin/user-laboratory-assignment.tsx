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
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABELS, ROLES } from "@/config/roles";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { ItemResponse, ListResponse } from "@/types/api";
import type { SafeUser } from "@/types/auth";
import type { Laboratory } from "@/types/laboratory";

/** Roles allowed to carry a scope - mirrors the PATCH route guard. */
const SCOPED_ROLES: readonly string[] = [ROLES.LAB_MANAGER, ROLES.STAFF];

type ScopeLab = Pick<Laboratory, "id" | "name" | "code" | "isActive">;

/** Order-insensitive comparison: a reordered selection is not a change. */
function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Laboratory assignment editor for `/admin/users` (SUPER_ADMIN / ADMIN only).
 *
 * The picker lists LAB_MANAGER and STAFF accounts only - the two roles the
 * `laboratory-scope` API accepts. The form edits the COMPLETE scope as a
 * checkbox set: edits live in a separate `editedIds` delta that is `null`
 * whenever nothing has been touched, so an untouched form never posts (the
 * server also skips the audit entry for an unchanged set), and a legacy
 * account with no stored scope is labelled platform-wide until an
 * assignment is explicitly saved - "save with nothing ticked" cannot
 * happen by accident.
 */
export function UserLaboratoryAssignment() {
  const { success } = useToast();

  const [users, setUsers] = React.useState<SafeUser[]>([]);
  const [laboratories, setLaboratories] = React.useState<ScopeLab[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");

  const [selectedUserId, setSelectedUserId] = React.useState("");
  /** `null` = not editing; otherwise the complete replacement set. */
  const [editedIds, setEditedIds] = React.useState<string[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  /** Bumped by the retry button to re-run the load effect. */
  const [reloadTick, setReloadTick] = React.useState(0);

  const fetchScopeData = React.useCallback(async (query: string) => {
    const searchPart = query ? `&search=${encodeURIComponent(query)}` : "";
    const [managers, staff, labResult] = await Promise.all([
      apiGet<ListResponse<SafeUser>>(
        `/api/users?role=${ROLES.LAB_MANAGER}&limit=50${searchPart}`,
      ),
      apiGet<ListResponse<SafeUser>>(
        `/api/users?role=${ROLES.STAFF}&limit=50${searchPart}`,
      ),
      apiGet<ListResponse<Laboratory>>(
        "/api/laboratories?status=all&limit=50",
      ),
    ]);
    return {
      nextUsers: [...managers.data, ...staff.data]
        .filter((entry) =>
          (SCOPED_ROLES as readonly string[]).includes(entry.role),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
      nextLabs: labResult.data.map((entry) => ({
        id: entry.id,
        name: entry.name,
        code: entry.code,
        isActive: entry.isActive,
      })),
    };
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setLoadError("");
      setAppliedSearch(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    let cancelled = false;
    fetchScopeData(appliedSearch)
      .then(({ nextUsers, nextLabs }) => {
        if (cancelled) return;
        setUsers(nextUsers);
        setLaboratories(nextLabs);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Accounts and laboratories could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, reloadTick, fetchScopeData]);

  const selected = users.find((entry) => entry.id === selectedUserId) ?? null;
  const legacyPlatformWide = selected
    ? !Array.isArray(selected.laboratoryIds)
    : false;
  const baseline = selected && Array.isArray(selected.laboratoryIds)
    ? selected.laboratoryIds
    : [];
  const draft = editedIds ?? baseline;
  const dirty = editedIds !== null && !sameIdSet(editedIds, baseline);
  const legacyUnchanged = legacyPlatformWide && !dirty;
  const scopeCount = draft.length;
  const scopeVariant = legacyUnchanged
    ? "neutral"
    : scopeCount > 0
      ? "info"
      : "warning";
  const scopeLabel = legacyUnchanged
    ? "Platform-wide (legacy)"
    : scopeCount === 0
      ? "No laboratories assigned"
      : `${scopeCount} ${scopeCount === 1 ? "laboratory" : "laboratories"} assigned`;

  const selectAccount = (userId: string) => {
    setSelectedUserId(userId);
    setEditedIds(null);
    setSaveError("");
  };

  const toggleLab = (labId: string) => {
    setEditedIds((current) => {
      const active = current ?? baseline;
      return active.includes(labId)
        ? active.filter((value) => value !== labId)
        : [...active, labId];
    });
  };

  const handleSave = async () => {
    if (!selected || editedIds === null) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await apiSend<ItemResponse<SafeUser>>(
        `/api/users/${selected.id}/laboratory-scope`,
        "PATCH",
        { laboratoryIds: editedIds },
      );
      const updated = result.data;
      setUsers((list) =>
        list.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setEditedIds(null);
      success(
        "Laboratory scope updated",
        `${selected.name} ${
          editedIds.length === 0
            ? "can no longer access any laboratory."
            : `now has access to ${editedIds.length} ${editedIds.length === 1 ? "laboratory" : "laboratories"}.`
        }`,
      );
    } catch (error) {
      setSaveError(
        error instanceof ApiRequestError
          ? error.message
          : "The laboratory scope could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadTick((tick) => tick + 1);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Laboratory scope assignments</CardTitle>
        <CardDescription>
          Search for a lab manager or staff account, tick the laboratories
          they should work with, and save. Only these two roles can carry a
          scope; other roles keep platform-wide access.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <Input
          label="Search accounts"
          placeholder="Name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
        />

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
            title="No staff accounts found"
            description={
              appliedSearch
                ? "Try a different name or email."
                : "Create a lab manager or staff account first, then assign laboratories here."
            }
          />
        ) : (
          <>
            <Select
              label="Staff account"
              placeholder="Select a lab manager or staff account"
              value={selectedUserId}
              onChange={(event) => selectAccount(event.target.value)}
              options={users.map((entry) => ({
                value: entry.id,
                label: `${entry.name} · ${ROLE_LABELS[entry.role]}`,
              }))}
              hint="Only lab manager and staff accounts appear in this list."
            />

            {selected ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={scopeVariant}>{scopeLabel}</Badge>
                  {selected.isActive ? null : (
                    <Badge variant="warning">Account disabled</Badge>
                  )}
                </div>

                {legacyUnchanged ? (
                  <p className="text-xs text-ink-subtle">
                    This account has no stored scope, so it currently has
                    platform-wide access. Saving an assignment replaces that
                    with an explicit laboratory list.
                  </p>
                ) : null}

                {laboratories.length === 0 ? (
                  <EmptyState
                    compact
                    title="No laboratories available"
                    description="Create a laboratory first, then assign it here."
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        Assigned laboratories
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() =>
                            setEditedIds(laboratories.map((entry) => entry.id))
                          }
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() => setEditedIds([])}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {laboratories.map((lab) => (
                        <label
                          key={lab.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-control border border-border bg-canvas px-3 py-2.5"
                        >
                          <input
                            type="checkbox"
                            checked={draft.includes(lab.id)}
                            onChange={() => toggleLab(lab.id)}
                            disabled={saving}
                            className="size-4 rounded-xs border-border text-primary accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {lab.name}
                            </span>
                            <span className="block text-xs text-ink-muted">
                              {lab.code}
                            </span>
                          </span>
                          {lab.isActive ? null : (
                            <Badge variant="warning" size="sm">
                              Inactive
                            </Badge>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {saveError ? (
                  <p role="alert" className="text-sm text-danger">
                    {saveError}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!dirty || saving}
                  >
                    {saving ? "Saving..." : "Save scope"}
                  </Button>
                  {dirty ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditedIds(null);
                        setSaveError("");
                      }}
                      disabled={saving}
                    >
                      Discard changes
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                title="Select an account"
                description="Choose a staff account above to view and edit its laboratory scope."
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
