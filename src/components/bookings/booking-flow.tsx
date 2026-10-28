"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  IconCalendarCheck,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconFlaskConical,
  IconSearch,
  IconShieldCheck,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import {
  CANCELLATION_CUTOFF_HOURS,
  MAX_TESTS_PER_BOOKING,
} from "@/config/lab-bookings";
import { useDebouncedSearch } from "@/hooks/use-api-list";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import { labBookingCreateSchema } from "@/lib/validation/lab-booking";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse, ListResponse } from "@/types/api";
import type {
  BookableLabTest,
  BookableLaboratory,
  LabBookingAvailability,
  LabBookingDetail,
} from "@/types/lab-booking";
import type { SafeUser } from "@/types/auth";
import {
  formatDateLabel,
  formatPrice,
  formatTurnaroundLabel,
  issuesToErrors,
  type FieldErrors,
} from "./shared";

const STEPS = [
  { key: 1, label: "Laboratory" },
  { key: 2, label: "Tests" },
  { key: 3, label: "Date & time" },
  { key: 4, label: "Your details" },
  { key: 5, label: "Review" },
] as const;

export interface BookingFlowProps {
  user: SafeUser;
}

/**
 * Patient-facing online lab booking wizard.
 *
 * Seven stages: laboratory → tests → verified slot → contact confirmation →
 * review → confirmation with booking reference. Selections are held in
 * component state so moving backwards never loses progress, every step has a
 * guarded next action, the submit button locks while a request is in flight
 * and an idempotency key stops a retried submission from creating a second
 * booking. All authoritative validation (eligibility, prices, capacity)
 * happens on the server; the client only shapes the flow.
 */
export function BookingFlow({ user }: BookingFlowProps) {
  const router = useRouter();
  const [step, setStep] = React.useState(1);
  // Furthest step reached - state (not a ref) because the step picker reads
  // it during render.
  const [maxVisited, setMaxVisited] = React.useState(1);

  const [laboratory, setLaboratory] = React.useState<BookableLaboratory | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = React.useState("");
  /**
   * Sample collection method chosen when the selection offers both options.
   * Only ever "LAB_VISIT" here - a home-collection choice hands the patient
   * over to the dedicated home collection wizard.
   */
  const [collectionMethod, setCollectionMethod] = React.useState<
    "LAB_VISIT" | "HOME_COLLECTION" | ""
  >("");
  const [showMethodChoice, setShowMethodChoice] = React.useState(false);
  const { search: testSearch, setSearch: setTestSearch, applied: appliedTestSearch } =
    useDebouncedSearch();

  const [date, setDate] = React.useState("");
  const [slot, setSlot] = React.useState("");

  const [contact, setContact] = React.useState({
    phone: user.phone ?? "",
    email: user.email ?? "",
  });
  const [notes, setNotes] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [result, setResult] = React.useState<LabBookingDetail | null>(null);

  const [catalog, setCatalog] = React.useState<{
    loading: boolean;
    data: BookableLaboratory[] | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  // One idempotency key per set of selections: reused across retries of the
  // same submission (so a network retry cannot double-book), reset whenever
  // the booking itself changes.
  const idempotencyKey = React.useRef<string | null>(null);
  function freshIdempotencyKey() {
    idempotencyKey.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `bk${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
  React.useEffect(() => {
    freshIdempotencyKey();
  }, [laboratory?.id, selectedIds, date, slot]);

  /* ---------------- catalogue ---------------- */
  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<BookableLaboratory>>("/api/lab-bookings/catalog")
      .then((result) => {
        if (!cancelled) {
          setCatalog({ loading: false, data: result.data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog({
            loading: false,
            data: [],
            error:
              error instanceof ApiRequestError
                ? error.message
                : "Unable to load laboratories.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- tests for the selected laboratory ---------------- *
   * Keyed-payload pattern (same as `useApiList`): loading and stale data are
   * derived from whether the cached payload matches the current request key,
   * so no setState runs synchronously inside the effect body. */

  const testsRequestKey = laboratory?.id ?? "";
  const [testsPayload, setTestsPayload] = React.useState<{
    key: string;
    data: BookableLabTest[] | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!testsRequestKey) return; // nothing selected - nothing to fetch
    let cancelled = false;
    const key = testsRequestKey;

    apiGet<ListResponse<BookableLabTest>>(
      `/api/lab-bookings/catalog/tests?laboratoryId=${key}`,
    )
      .then((result) => {
        if (cancelled) return;
        setTestsPayload({ key, data: result.data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTestsPayload({
          key,
          data: [],
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load lab tests.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [testsRequestKey]);

  const testsFresh =
    testsPayload !== null && testsPayload.key === testsRequestKey;
  const testsLoading = testsRequestKey !== "" && !testsFresh;
  const testsError = testsFresh ? testsPayload.error : null;
  const tests = testsFresh ? testsPayload.data : null;

  /* ---------------- availability for (laboratory, date) ---------------- */

  const availabilityRequestKey =
    laboratory && date ? `${laboratory.id}|${date}` : "";
  const [availabilityRefresh, setAvailabilityRefresh] = React.useState(0);
  const [availabilityPayload, setAvailabilityPayload] = React.useState<{
    key: string;
    data: LabBookingAvailability | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!availabilityRequestKey) return; // no laboratory or date yet
    let cancelled = false;
    const key = `${availabilityRequestKey}|${availabilityRefresh}`;
    const [laboratoryId, bookingDate] = availabilityRequestKey.split("|");

    apiGet<ItemResponse<LabBookingAvailability>>(
      `/api/lab-bookings/availability?laboratoryId=${laboratoryId}&date=${bookingDate}`,
    )
      .then((result) => {
        if (cancelled) return;
        setAvailabilityPayload({ key, data: result.data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAvailabilityPayload({
          key,
          data: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load availability.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [availabilityRequestKey, availabilityRefresh]);

  const availabilityKey = `${availabilityRequestKey}|${availabilityRefresh}`;
  const availabilityFresh =
    availabilityPayload !== null && availabilityPayload.key === availabilityKey;
  const availability =
    availabilityRequestKey !== "" && availabilityFresh
      ? availabilityPayload.data
      : null;
  const availabilityLoading =
    availabilityRequestKey !== "" && !availabilityFresh;
  const availabilityError =
    availabilityRequestKey !== "" && availabilityFresh
      ? availabilityPayload.error
      : null;

  /* ---------------- derived data ---------------- */
  const selectedTests = React.useMemo(
    () =>
      (tests ?? []).filter((test) => selectedIds.includes(test.id)),
    [tests, selectedIds],
  );
  const total = selectedTests.reduce((sum, test) => sum + test.price, 0);

  /**
   * Sample collection options allowed by the current selection. A single
   * method must be allowed by EVERY selected test; otherwise the patient is
   * told which tests conflict so they can adjust the selection.
   */
  const selectionMethods = React.useMemo(() => {
    const labVisitAllowed =
      selectedTests.length > 0 &&
      selectedTests.every((test) => test.labVisitEnabled);
    const homeAllowed =
      selectedTests.length > 0 &&
      selectedTests.every((test) => test.homeCollectionEnabled);
    const labVisitIncompatible = selectedTests
      .filter((test) => !test.labVisitEnabled)
      .map((test) => test.name);
    const homeIncompatible = selectedTests
      .filter((test) => !test.homeCollectionEnabled)
      .map((test) => test.name);
    return {
      labVisitAllowed,
      homeAllowed,
      labVisitIncompatible,
      homeIncompatible,
      offersBoth: labVisitAllowed && homeAllowed,
    };
  }, [selectedTests]);

  /** Hand the current laboratory + test selection to the home collection wizard. */
  function goToHomeCollection() {
    if (!laboratory) return;
    const params = new URLSearchParams({ lab: laboratory.id });
    if (selectedIds.length > 0) params.set("tests", selectedIds.join(","));
    router.push(`/home-collection?${params.toString()}`);
  }

  const departmentOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const test of tests ?? []) {
      if (test.department) seen.set(test.department.id, test.department.name);
    }
    return [
      { value: "", label: "All departments" },
      ...[...seen.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [tests]);

  const visibleTests = React.useMemo(() => {
    let list = tests ?? [];
    if (departmentFilter) {
      list = list.filter((test) => test.department?.id === departmentFilter);
    }
    if (appliedTestSearch) {
      const needle = appliedTestSearch.toLowerCase();
      list = list.filter(
        (test) =>
          test.name.toLowerCase().includes(needle) ||
          test.code.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [tests, departmentFilter, appliedTestSearch]);

  const minDate = React.useMemo(() => {
    if (!laboratory?.schedule) return undefined;
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }, [laboratory]);

  const maxDate = React.useMemo(() => {
    const schedule = laboratory?.schedule;
    if (!schedule) return undefined;
    const now = new Date();
    const limit = new Date(now);
    limit.setUTCDate(limit.getUTCDate() + schedule.maxAdvanceDays);
    return limit.toISOString().slice(0, 10);
  }, [laboratory]);

  function goTo(next: number) {
    if (next <= maxVisited + 1) {
      setStep(next);
      setMaxVisited((value) => Math.max(value, next));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function selectLaboratory(entry: BookableLaboratory) {
    setLaboratory(entry);
    setSelectedIds([]);
    setDate("");
    setSlot("");
    setDepartmentFilter("");
    setTestSearch("");
    goTo(2);
  }

  function toggleTest(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_TESTS_PER_BOOKING) return current;
      return [...current, id];
    });
  }

  async function submitBooking() {
    if (submitting || !laboratory) return;
    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    const payload = {
      laboratoryId: laboratory.id,
      testIds: selectedIds,
      bookingDate: date,
      timeSlot: slot,
      notes: notes.length > 0 ? notes : null,
      contact: {
        phone: contact.phone.trim().length > 0 ? contact.phone.trim() : null,
        email: contact.email.trim().length > 0 ? contact.email.trim() : null,
      },
      idempotencyKey: idempotencyKey.current ?? undefined,
    };

    const parsed = labBookingCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(issuesToErrors(toFieldIssues(parsed.error)));
      setSubmitting(false);
      return;
    }

    try {
      const response = await apiSend<ItemResponse<LabBookingDetail>>(
        "/api/lab-bookings",
        "POST",
        parsed.data,
      );
      setResult(response.data);
      setStep(6);
      setMaxVisited(6);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(issuesToErrors(error.issues));
        setSubmitError(error.message);
        // An expired slot invalidates availability - refresh it so the
        // patient can immediately pick another time.
        if (error.status === 409 && fieldCoversSlot(error.issues)) {
          setSlot("");
          setAvailabilityRefresh((value) => value + 1);
          setStep(3);
          setMaxVisited((value) => Math.max(value, 3));
        }
      } else {
        setSubmitError(
          "Something went wrong while creating the booking. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetFlow() {
    setStep(1);
    setMaxVisited(1);
    setLaboratory(null);
    setSelectedIds([]);
    setDate("");
    setSlot("");
    setNotes("");
    setSubmitError(null);
    setFieldErrors({});
    setResult(null);
    freshIdempotencyKey();
  }

  /* ---------------- confirmation screen ---------------- */
  if (step === 6 && result) {
    return (
      <>
        <PageHeader
          eyebrow="Online booking"
          title="Booking confirmed"
          description="Your lab test booking has been registered."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Online booking" },
          ]}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
              <IconCheckCircle className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-ink-muted">Booking reference</p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-ink">
                {result.bookingCode}
              </p>
            </div>
            <div className="text-sm text-ink-muted">
              <p>
                {result.laboratory?.name ?? "Laboratory"} ·{" "}
                {formatDateLabel(result.bookingDate)} at {result.timeSlot}
              </p>
              <p className="mt-1">
                {result.itemCount} test{result.itemCount === 1 ? "" : "s"} ·{" "}
                {formatPrice(result.totalAmount)}
              </p>
            </div>
            <p className="max-w-md text-sm text-ink-subtle">
              The laboratory will confirm your appointment. You can track the
              status from your booking history.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link href={`/lab-bookings/${result.id}`} className="inline-flex">
                <Button>
                  View booking
                  <IconChevronRight className="size-4" />
                </Button>
              </Link>
              <Link href="/my-bookings" className="inline-flex">
                <Button variant="outline">My bookings</Button>
              </Link>
              <Button variant="ghost" onClick={resetFlow}>
                Book another test
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Online booking"
        title="Book a lab test"
        description="Choose a laboratory, pick your tests and select a verified time slot."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Online booking" },
        ]}
        actions={
          <Link href="/my-bookings" className="inline-flex">
            <Button variant="outline">My bookings</Button>
          </Link>
        }
      />

      {/* Progress indicator */}
      <ol
        aria-label="Booking progress"
        className="mb-6 flex flex-wrap items-center gap-1.5 sm:gap-2"
      >
        {STEPS.map((entry) => {
          const isActive = step === entry.key;
          const isDone = step > entry.key;
          const reachable = entry.key <= maxVisited + 1;
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => {
                  if (reachable && entry.key < step) goTo(entry.key);
                }}
                disabled={!reachable || entry.key >= step}
                aria-current={isActive ? "step" : undefined}
                className={
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-3 sm:text-sm " +
                  (isActive
                    ? "border-primary bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                    : isDone
                      ? "border-success-line bg-success-soft text-success-strong"
                      : "border-border bg-surface text-ink-subtle")
                }
              >
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-full bg-current/10 text-[10px] font-semibold"
                >
                  {isDone ? "✓" : entry.key}
                </span>
                {entry.label}
              </button>
            </li>
          );
        })}
      </ol>

      {submitError && step !== 6 ? (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {submitError}
        </p>
      ) : null}

      {/* ---------------- Step 1: laboratory ---------------- */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Select a laboratory</CardTitle>
            <p className="text-sm text-ink-muted">
              Only active laboratories with online booking enabled can be
              selected.
            </p>
          </CardHeader>
          <CardContent>
            {catalog.loading ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="skeleton h-20 w-full rounded-card" />
                ))}
              </div>
            ) : catalog.error ? (
              <ErrorState
                title="Unable to load laboratories"
                description={catalog.error}
                onRetry={() => {
                  setCatalog({ loading: true, data: null, error: null });
                  apiGet<ListResponse<BookableLaboratory>>(
                    "/api/lab-bookings/catalog",
                  )
                    .then((res) =>
                      setCatalog({ loading: false, data: res.data, error: null }),
                    )
                    .catch((err: unknown) =>
                      setCatalog({
                        loading: false,
                        data: [],
                        error:
                          err instanceof ApiRequestError
                            ? err.message
                            : "Unable to load laboratories.",
                      }),
                    );
                }}
              />
            ) : catalog.data && catalog.data.length > 0 ? (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {catalog.data.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => entry.bookable && selectLaboratory(entry)}
                      disabled={!entry.bookable}
                      className={
                        "flex h-full w-full flex-col rounded-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                        (entry.bookable
                          ? "border-border bg-surface hover:border-primary hover:bg-primary-light/40 dark:hover:bg-primary-muted/40"
                          : "cursor-not-allowed border-border bg-surface-muted opacity-70")
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">
                            {entry.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {entry.code}
                            {entry.city ? ` · ${entry.city}` : ""}
                          </p>
                        </div>
                        {entry.bookable ? (
                          <Badge variant="success" size="sm">
                            Bookable
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            Unavailable
                          </Badge>
                        )}
                      </div>
                      {entry.address ? (
                        <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
                          {entry.address}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-ink-subtle">
                        {entry.schedule
                          ? `Open ${entry.schedule.openingTime} – ${entry.schedule.closingTime} · ${entry.schedule.timezone}`
                          : "Online booking not configured for this laboratory."}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={IconFlaskConical}
                title="No laboratories available"
                description="There are no active laboratories to book with right now. Please check back later."
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Step 2: tests ---------------- */}
      {step === 2 && laboratory ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Select tests</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  {laboratory.name} · choose one or more active tests
                  {selectedIds.length > 0
                    ? ` (${selectedIds.length} selected)`
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goTo(1)}
              >
                <IconChevronLeft className="size-4" />
                Change laboratory
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="Search tests"
                name="booking-test-search"
                icon={<IconSearch className="size-4" />}
                value={testSearch}
                onChange={(event) => {
                  setTestSearch(event.target.value);
                }}
                placeholder="Name or code"
                containerClassName="sm:col-span-2"
              />
              <Select
                aria-label="Filter by department"
                label="Department"
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
                options={departmentOptions}
              />
            </div>

            {testsLoading ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="skeleton h-16 w-full rounded-card" />
                ))}
              </div>
            ) : testsError ? (
              <ErrorState
                title="Unable to load tests"
                description={testsError}
              />
            ) : tests && tests.length > 0 ? (
              visibleTests.length > 0 ? (
                <fieldset>
                  <legend className="sr-only">
                    Available lab tests at {laboratory.name}
                  </legend>
                  <ul className="grid grid-cols-1 gap-2.5">
                    {visibleTests.map((test) => {
                      const checked = selectedIds.includes(test.id);
                      const disabled =
                        !checked && selectedIds.length >= MAX_TESTS_PER_BOOKING;
                      return (
                        <li key={test.id}>
                          <label
                            className={
                              "flex cursor-pointer items-start gap-3 rounded-card border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary/60 " +
                              (checked
                                ? "border-primary bg-primary-light/50 dark:bg-primary-muted/40"
                                : disabled
                                  ? "cursor-not-allowed border-border bg-surface-muted opacity-60"
                                  : "border-border bg-surface hover:border-primary/50")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleTest(test.id)}
                              className="mt-1 size-4 shrink-0 accent-[#10B981]"
                              aria-describedby={`test-${test.id}-meta`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <span className="font-medium text-ink">
                                  {test.name}
                                </span>
                                <span className="tabular-nums font-semibold text-ink">
                                  {formatPrice(test.price)}
                                </span>
                              </span>
                              <span
                                id={`test-${test.id}-meta`}
                                className="mt-0.5 block text-xs text-ink-muted"
                              >
                                {test.code} · {test.category} ·{" "}
                                {test.specimenType} ·{" "}
                                {formatTurnaroundLabel(
                                  test.turnaroundTimeMinutes,
                                )}
                                {test.department
                                  ? ` · ${test.department.name}`
                                  : ""}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ) : (
                <EmptyState
                  icon={IconSearch}
                  title="No tests match your filters"
                  description="Try adjusting the search or department filter."
                />
              )
            ) : (
              <EmptyState
                icon={IconFlaskConical}
                title="No active tests"
                description="This laboratory has no bookable tests right now. Pick another laboratory or check back later."
                action={
                  <Button size="sm" variant="outline" onClick={() => goTo(1)}>
                    Choose another laboratory
                  </Button>
                }
              />
            )}

            {showMethodChoice ? (
              <div className="mt-5 rounded-card border border-border bg-surface-muted p-4">
                <fieldset>
                  <legend className="text-sm font-semibold text-ink">
                    How would you like to provide your sample?
                  </legend>
                  <p className="mt-1 text-sm text-ink-muted">
                    All selected tests support both options. Choose one to
                    continue.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label
                      className={
                        "flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary/60 " +
                        (collectionMethod === "LAB_VISIT"
                          ? "border-primary bg-primary-light/50 dark:bg-primary-muted/40"
                          : "border-border bg-surface hover:border-primary/50")
                      }
                    >
                      <input
                        type="radio"
                        name="sample-collection-method"
                        value="LAB_VISIT"
                        checked={collectionMethod === "LAB_VISIT"}
                        onChange={() => setCollectionMethod("LAB_VISIT")}
                        className="mt-1 size-4 shrink-0 accent-[#10B981]"
                      />
                      <span>
                        <span className="block font-medium text-ink">
                          Visit the laboratory
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          Attend your appointment at {laboratory?.name} to
                          provide the sample.
                        </span>
                      </span>
                    </label>
                    <label
                      className={
                        "flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary/60 " +
                        (collectionMethod === "HOME_COLLECTION"
                          ? "border-primary bg-primary-light/50 dark:bg-primary-muted/40"
                          : "border-border bg-surface hover:border-primary/50")
                      }
                    >
                      <input
                        type="radio"
                        name="sample-collection-method"
                        value="HOME_COLLECTION"
                        checked={collectionMethod === "HOME_COLLECTION"}
                        onChange={() => setCollectionMethod("HOME_COLLECTION")}
                        className="mt-1 size-4 shrink-0 accent-[#10B981]"
                      />
                      <span>
                        <span className="block font-medium text-ink">
                          Collect the sample from my home
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          A trained collector visits your address at the
                          scheduled time.
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
                {selectionMethods.homeIncompatible.length > 0 ? (
                  <p className="mt-3 text-xs text-danger">
                    Not available for home collection:{" "}
                    {selectionMethods.homeIncompatible.join(", ")}.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowMethodChoice(false)}
                  >
                    Back to tests
                  </Button>
                  {collectionMethod === "LAB_VISIT" ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setShowMethodChoice(false);
                        goTo(3);
                      }}
                    >
                      Continue with lab visit
                      <IconChevronRight className="size-4" />
                    </Button>
                  ) : null}
                  {collectionMethod === "HOME_COLLECTION" ? (
                    <Button size="sm" onClick={goToHomeCollection}>
                      Continue with home collection
                      <IconChevronRight className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {selectedIds.length} test{selectedIds.length === 1 ? "" : "s"}{" "}
                selected · Total {formatPrice(total)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(1)}>
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  onClick={() => {
                    if (selectionMethods.offersBoth) {
                      setCollectionMethod("");
                      setShowMethodChoice(true);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                      return;
                    }
                    if (selectionMethods.homeAllowed) {
                      // Home-collection-only selection: the lab booking
                      // wizard cannot continue - hand over to the home
                      // collection flow with the current selection.
                      goToHomeCollection();
                      return;
                    }
                    goTo(3);
                  }}
                  disabled={selectedIds.length === 0}
                >
                  Continue
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Step 3: date + slot ---------------- */}
      {step === 3 && laboratory ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Choose a date and time</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  {laboratory.name} · slots shown are verified against live
                  availability
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(2)}>
                <IconChevronLeft className="size-4" />
                Change tests
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Input
              label="Booking date"
              name="booking-date"
              type="date"
              required
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(event) => {
                setDate(event.target.value);
                setSlot("");
              }}
              error={fieldErrors.bookingDate}
              hint={
                laboratory.schedule
                  ? `Up to ${laboratory.schedule.maxAdvanceDays} days ahead · ${laboratory.schedule.timezone}`
                  : undefined
              }
            />

            <div className="mt-5" aria-live="polite">
              {!date ? (
                <EmptyState
                  icon={IconCalendarCheck}
                  title="Pick a date to see available slots"
                  description="Available time slots will appear here once you choose a booking date."
                />
              ) : availabilityLoading ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <div key={index} className="skeleton h-14 rounded-card" />
                  ))}
                </div>
              ) : availabilityError ? (
                <ErrorState
                  title="Unable to load availability"
                  description={availabilityError}
                />
              ) : availability ? (
                !availability.bookable ? (
                  <EmptyState
                    icon={IconCalendarCheck}
                    title="Date unavailable"
                    description={
                      availability.message ??
                      "The selected date cannot be booked."
                    }
                  />
                ) : availability.slots.length === 0 ? (
                  <EmptyState
                    icon={IconCalendarCheck}
                    title="No slots left on this day"
                    description="Choose a different date or try another laboratory."
                  />
                ) : (
                  <fieldset>
                    <legend className="text-sm font-medium text-ink">
                      Available time slots
                    </legend>
                    <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                      {availability.slots.map((entry) => {
                        const selected = slot === entry.start;
                        return (
                          <button
                            key={entry.start}
                            type="button"
                            disabled={!entry.available}
                            onClick={() => setSlot(entry.start)}
                            aria-pressed={selected}
                            className={
                              "flex flex-col items-center rounded-card border px-2 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                              (selected
                                ? "border-primary bg-primary text-white"
                                : entry.available
                                  ? "border-border bg-surface text-ink hover:border-primary hover:bg-primary-light/40 dark:hover:bg-primary-muted/40"
                                  : "cursor-not-allowed border-border bg-surface-muted text-ink-subtle")
                            }
                          >
                            <span className="font-medium tabular-nums">
                              {entry.label}
                            </span>
                            <span
                              className={
                                "mt-0.5 text-xs " +
                                (selected
                                  ? "text-white/80"
                                  : entry.available
                                    ? "text-success"
                                    : "text-ink-subtle")
                              }
                            >
                              {entry.available
                                ? `${entry.remaining} spot${entry.remaining === 1 ? "" : "s"} left`
                                : "Full"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted">
                {date && slot ? (
                  <>
                    {formatDateLabel(date)} · {slot}
                  </>
                ) : (
                  "Select a date and an available slot to continue."
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(2)}>
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button onClick={() => goTo(4)} disabled={!slot}>
                  Continue
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Step 4: patient/contact details ---------------- */}
      {step === 4 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Confirm your details</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  We use these details to contact you about this booking.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(3)}>
                <IconChevronLeft className="size-4" />
                Change slot
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-control border border-border bg-surface-muted p-3.5 text-sm">
              <p className="font-medium text-ink">{user.name}</p>
              <p className="mt-0.5 text-ink-muted">
                Booking for your own patient profile. Contact details below are
                saved with this booking only.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                name="contact-phone"
                type="tel"
                autoComplete="tel"
                value={contact.phone}
                onChange={(event) =>
                  setContact((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                error={fieldErrors["contact.phone"]}
                placeholder="Used if we need to reach you"
              />
              <Input
                label="Email"
                name="contact-email"
                type="email"
                autoComplete="email"
                value={contact.email}
                onChange={(event) =>
                  setContact((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                error={fieldErrors["contact.email"]}
                hint="Confirmation notices are sent here."
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted">
                {date && slot ? `${formatDateLabel(date)} · ${slot}` : ""}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(3)}>
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button onClick={() => goTo(5)}>
                  Continue
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Step 5: review + confirm ---------------- */}
      {step === 5 && laboratory ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Review your booking</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Check the details below, then confirm to reserve your slot.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(4)}>
                <IconChevronLeft className="size-4" />
                Change details
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-subtle">Laboratory</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {laboratory.name}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Date & time</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {formatDateLabel(date)} · {slot}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Patient</dt>
                <dd className="mt-0.5 font-medium text-ink">{user.name}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Contact</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {contact.phone || "No phone"} · {contact.email}
                </dd>
              </div>
            </dl>

            <div className="mt-5 rounded-control border border-border">
              <div className="border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Tests
              </div>
              <ul className="divide-y divide-border">
                {selectedTests.map((test) => (
                  <li
                    key={test.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {test.name}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {test.code} · {test.category}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm tabular-nums text-ink">
                      {formatPrice(test.price)}
                    </p>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Total</p>
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatPrice(total)}
                  </p>
                </li>
              </ul>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              Prices are confirmed by the laboratory at booking time. No
              payment is taken online.
            </p>

            <div className="mt-4">
              <Textarea
                label="Notes (optional)"
                name="booking-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                error={fieldErrors.notes}
                hint="Anything the laboratory should know (e.g. doctor's referral)."
                placeholder="Optional"
              />
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-control border border-info-line bg-info-soft p-3.5 text-sm text-info">
              <IconShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Free cancellation up to {CANCELLATION_CUTOFF_HOURS} hour(s)
                before the scheduled slot from your booking history.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {selectedIds.length} test{selectedIds.length === 1 ? "" : "s"} ·{" "}
                Total {formatPrice(total)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(4)} disabled={submitting}>
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button onClick={() => void submitBooking()} loading={submitting}>
                  {submitting ? "Confirming..." : "Confirm booking"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

/** True when the server reported a slot-level problem (expired capacity). */
function fieldCoversSlot(
  issues: { field: string }[] | undefined,
): boolean {
  return (issues ?? []).some(
    (issue) => issue.field === "timeSlot" || issue.field === "bookingDate",
  );
}
