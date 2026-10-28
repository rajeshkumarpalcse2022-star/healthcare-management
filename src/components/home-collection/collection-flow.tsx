"use client";

import * as React from "react";
import Link from "next/link";

import {
  IconCalendarCheck,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconHome,
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
  COLLECTION_CANCELLATION_CUTOFF_HOURS,
  MAX_TESTS_PER_COLLECTION,
} from "@/config/home-collection";
import { useDebouncedSearch } from "@/hooks/use-api-list";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import {
  collectionAddressSchema,
  homeCollectionCreateSchema,
} from "@/lib/validation/home-collection";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse, ListResponse } from "@/types/api";
import type { BookableLabTest } from "@/types/lab-booking";
import type {
  CollectableLaboratory,
  EligibleBookingRef,
  HomeCollectionAvailability,
  HomeCollectionDetail,
} from "@/types/home-collection";
import type { SafeUser } from "@/types/auth";
import {
  formatDateLabel,
  formatPrice,
  formatTurnaroundLabel,
  issuesToErrors,
  type FieldErrors,
} from "../bookings/shared";

const STEPS = [
  { key: 1, label: "Laboratory" },
  { key: 2, label: "Tests" },
  { key: 3, label: "Date & slot" },
  { key: 4, label: "Pickup address" },
  { key: 5, label: "Review" },
] as const;

export interface CollectionFlowProps {
  user: SafeUser;
}

/**
 * Patient-facing home collection request wizard.
 *
 * Six stages: laboratory → tests → verified pickup slot → pickup address →
 * review → confirmation with collection reference. Selections are held in
 * component state so moving backwards never loses progress; the submit button
 * locks while a request is in flight and an idempotency key stops a retried
 * submission from creating a second request. All authoritative validation
 * (eligibility, prices, capacity) happens on the server; the client only
 * shapes the flow. A patient may optionally link an eligible STEP 7 booking
 * - the linked booking's items then preselect the tests and must match on
 * submission.
 */
export function CollectionFlow({ user }: CollectionFlowProps) {
  const [step, setStep] = React.useState(1);
  const [maxVisited, setMaxVisited] = React.useState(1);

  const [laboratory, setLaboratory] =
    React.useState<CollectableLaboratory | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = React.useState("");
  const { search: testSearch, setSearch: setTestSearch, applied: appliedTestSearch } =
    useDebouncedSearch();

  const [date, setDate] = React.useState("");
  const [slot, setSlot] = React.useState("");
  const [linkedBookingId, setLinkedBookingId] = React.useState("");

  const [address, setAddress] = React.useState({
    recipientName: user.name,
    phone: user.phone ?? "",
    addressLine1: "",
    addressLine2: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
    instructions: "",
    /** Captured through the browser Geolocation API - never invented. */
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [geoState, setGeoState] = React.useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  const [instructions, setInstructions] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [result, setResult] = React.useState<{
    detail: HomeCollectionDetail;
    otp: string | null;
  } | null>(null);

  const [catalog, setCatalog] = React.useState<{
    loading: boolean;
    data: CollectableLaboratory[] | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  // One idempotency key per set of selections: reused across retries of the
  // same submission so a network retry cannot create a second request.
  const idempotencyKey = React.useRef<string | null>(null);
  function freshIdempotencyKey() {
    idempotencyKey.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `hc${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
  React.useEffect(() => {
    freshIdempotencyKey();
  }, [laboratory?.id, selectedIds, date, slot]);

  /* ---------------- catalogue ---------------- */
  const preselectApplied = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<CollectableLaboratory>>(
      "/api/home-collections/catalog",
    )
      .then((result) => {
        if (!cancelled) {
          setCatalog({ loading: false, data: result.data, error: null });

          // Handoff from the online booking wizard (`?lab=<id>&tests=a,b`):
          // preselect the laboratory and its tests so the patient does not
          // have to pick them twice. Applied once, after the catalogue loads.
          if (!preselectApplied.current) {
            preselectApplied.current = true;
            const params = new URLSearchParams(window.location.search);
            const labId = params.get("lab");
            if (!labId) return;
            const entry = result.data.find(
              (candidate) => candidate.id === labId && candidate.collectable,
            );
            if (!entry) return;
            const testParam = params.get("tests");
            const requestedTests = (testParam ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter((value) => value.length > 0);
            setLaboratory(entry);
            setSelectedIds(requestedTests);
            setDate("");
            setSlot("");
            setLinkedBookingId("");
            setDepartmentFilter("");
            setTestSearch("");
            setStep(2);
            setMaxVisited(2);
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- tests for the selected laboratory ---------------- */

  const testsRequestKey = laboratory?.id ?? "";
  const [testsPayload, setTestsPayload] = React.useState<{
    key: string;
    data: BookableLabTest[] | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!testsRequestKey) return;
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

  /**
   * A booking handoff may preselect tests before the catalogue has loaded.
   * Drop anything this laboratory does not offer for home collection so the
   * wizard never starts with an invalid selection.
   */
  const selectionReconciled = React.useRef(false);
  React.useEffect(() => {
    if (!tests || selectionReconciled.current) return;
    selectionReconciled.current = true;
    const allowed = new Set(
      tests
        .filter((test) => test.homeCollectionEnabled)
        .map((test) => test.id),
    );
    setSelectedIds((current) =>
      current.filter((id) => allowed.has(id)),
    );
  }, [tests]);

  /* ---------------- availability for (laboratory, date) ---------------- */

  const availabilityRequestKey =
    laboratory && date ? `${laboratory.id}|${date}` : "";
  const [availabilityRefresh, setAvailabilityRefresh] = React.useState(0);
  const [availabilityPayload, setAvailabilityPayload] = React.useState<{
    key: string;
    data: HomeCollectionAvailability | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!availabilityRequestKey) return;
    let cancelled = false;
    const key = `${availabilityRequestKey}|${availabilityRefresh}`;
    const [laboratoryId, collectionDate] = availabilityRequestKey.split("|");

    apiGet<ItemResponse<HomeCollectionAvailability>>(
      `/api/home-collections/availability?laboratoryId=${laboratoryId}&date=${collectionDate}`,
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

  /* ---------------- eligible STEP 7 bookings for this laboratory -------- */

  const eligibleRequestKey = laboratory?.id ?? "";
  const [eligiblePayload, setEligiblePayload] = React.useState<{
    key: string;
    data: EligibleBookingRef[] | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!eligibleRequestKey) return;
    let cancelled = false;
    const key = eligibleRequestKey;
    apiGet<ListResponse<EligibleBookingRef>>(
      `/api/home-collections/eligible-bookings?laboratoryId=${key}`,
    )
      .then((result) => {
        if (cancelled) return;
        setEligiblePayload({ key, data: result.data, error: null });
      })
      .catch(() => {
        // Linking a booking is optional - a failure here must not block the flow.
        if (cancelled) return;
        setEligiblePayload({ key, data: [], error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [eligibleRequestKey]);

  const eligibleFresh =
    eligiblePayload !== null && eligiblePayload.key === eligibleRequestKey;
  const eligibleBookings = eligibleFresh ? (eligiblePayload.data ?? []) : [];
  const linkedBooking =
    eligibleBookings.find((booking) => booking.id === linkedBookingId) ?? null;

  /* ---------------- derived data ---------------- */
  const selectedTests = React.useMemo(
    () => (tests ?? []).filter((test) => selectedIds.includes(test.id)),
    [tests, selectedIds],
  );
  const total = selectedTests.reduce((sum, test) => sum + test.price, 0);

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
    // Home collection can only offer tests that allow it - the server
    // revalidates on submission, but the list stays honest up front.
    let list = (tests ?? []).filter((test) => test.homeCollectionEnabled);
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
    return new Date().toISOString().slice(0, 10);
  }, [laboratory]);

  const maxDate = React.useMemo(() => {
    const schedule = laboratory?.schedule;
    if (!schedule) return undefined;
    const limit = new Date();
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

  function selectLaboratory(entry: CollectableLaboratory) {
    setLaboratory(entry);
    setSelectedIds([]);
    setDate("");
    setSlot("");
    setLinkedBookingId("");
    setDepartmentFilter("");
    setTestSearch("");
    goTo(2);
  }

  function toggleTest(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_TESTS_PER_COLLECTION) return current;
      return [...current, id];
    });
  }

  function applyLinkedBooking(booking: EligibleBookingRef) {
    setLinkedBookingId(booking.id);
    setSelectedIds(booking.items.map((item) => item.labTestId));
  }

  function updateAddress(patch: Partial<typeof address>) {
    setAddress((current) => ({ ...current, ...patch }));
  }

  /**
   * Captures the patient's real coordinates through the browser Geolocation
   * API - only after an explicit click. Every failure mode surfaces a clear
   * message with the concrete next step (site permission, retry button,
   * supported browser); coordinates are never fabricated or defaulted, so
   * a failed capture leaves the fields empty and the wizard stays blocked
   * until a real capture succeeds.
   */
  function captureMyLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoState({
        loading: false,
        error:
          "Your browser does not support location capture. Open this page in a modern browser (Chrome, Edge, Firefox or Safari) to share your pickup location.",
      });
      return;
    }
    setGeoState({ loading: true, error: null });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Correct address details after capture - only coordinates update.
        updateAddress({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        setGeoState({ loading: false, error: null });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access for this site in your browser settings, then tap \u201cUse my current location\u201d to try again."
            : error.code === error.TIMEOUT
              ? "Finding your location took too long. Check your connection and tap \u201cUse my current location\u201d to try again."
              : "Your location is unavailable right now. Tap \u201cUse my current location\u201d to try again.";
        setGeoState({ loading: false, error: message });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  /**
   * Blocks the wizard from reaching the review step with an address the
   * server would reject - without this the Confirm button fails silently on
   * step 5 because no field there can surface the validation message.
   */
  function validateAddress() {
    const parsed = collectionAddressSchema.safeParse(address);
    if (parsed.success) {
      setFieldErrors({});
      setSubmitError(null);
      return true;
    }
    setFieldErrors(issuesToErrors(toFieldIssues(parsed.error)));
    window.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  }

  async function submitCollection() {
    if (submitting || !laboratory) return;
    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    const payload = {
      laboratoryId: laboratory.id,
      labBookingId: linkedBookingId.length > 0 ? linkedBookingId : undefined,
      testIds: selectedIds,
      scheduledDate: date,
      timeSlot: slot,
      collectionInstructions:
        instructions.trim().length > 0 ? instructions.trim() : null,
      address: {
        recipientName: address.recipientName.trim(),
        phone: address.phone.trim(),
        addressLine1: address.addressLine1.trim(),
        addressLine2:
          address.addressLine2.trim().length > 0
            ? address.addressLine2.trim()
            : null,
        landmark:
          address.landmark.trim().length > 0 ? address.landmark.trim() : null,
        city: address.city.trim(),
        state: address.state.trim(),
        pincode: address.pincode.trim(),
        instructions:
          address.instructions.trim().length > 0
            ? address.instructions.trim()
            : null,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      idempotencyKey: idempotencyKey.current ?? undefined,
    };

    const parsed = homeCollectionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(issuesToErrors(toFieldIssues(parsed.error)));
      setSubmitError("Please fix the highlighted fields before confirming.");
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    try {
      const response = await apiSend<
        ItemResponse<HomeCollectionDetail & { collectionOtp?: string }>
      >("/api/home-collections", "POST", parsed.data);
      setResult({
        detail: response.data,
        otp: response.data.collectionOtp ?? null,
      });
      setStep(6);
      setMaxVisited(6);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(issuesToErrors(error.issues));
        setSubmitError(error.message);
        // A slot conflict invalidates availability - refresh so the patient
        // can immediately pick another time.
        if (error.status === 409 && fieldCoversSlot(error.issues)) {
          setSlot("");
          setAvailabilityRefresh((value) => value + 1);
          setStep(3);
          setMaxVisited((value) => Math.max(value, 3));
        }
        // Address problems can only be edited on step 4 - send the patient
        // back so the failing inputs are actually visible.
        if (
          (error.issues ?? []).some((issue) =>
            issue.field.startsWith("address."),
          )
        ) {
          setStep(4);
          setMaxVisited((value) => Math.max(value, 4));
        }
      } else {
        setSubmitError(
          "Something went wrong while creating the collection request. Please try again.",
        );
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
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
    setLinkedBookingId("");
    setInstructions("");
    setSubmitError(null);
    setFieldErrors({});
    setResult(null);
    setAddress({
      recipientName: user.name,
      phone: user.phone ?? "",
      addressLine1: "",
      addressLine2: "",
      landmark: "",
      city: "",
      state: "",
      pincode: "",
      instructions: "",
      latitude: null,
      longitude: null,
    });
    setGeoState({ loading: false, error: null });
    freshIdempotencyKey();
  }

  /* ---------------- confirmation screen ---------------- */
  if (step === 6 && result) {
    const { detail, otp } = result;
    return (
      <>
        <PageHeader
          eyebrow="Home sample collection"
          title="Collection requested"
          description="Your home sample collection request has been registered."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Home collection" },
          ]}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
              <IconCheckCircle className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-ink-muted">Collection reference</p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-ink">
                {detail.collectionCode}
              </p>
            </div>
            <div className="text-sm text-ink-muted">
              <p>
                {detail.laboratory?.name ?? "Laboratory"} ·{" "}
                {formatDateLabel(detail.scheduledDate)} at {detail.timeSlot}
              </p>
              <p className="mt-1">
                {detail.itemCount} test{detail.itemCount === 1 ? "" : "s"} ·{" "}
                {formatPrice(detail.items.reduce((sum, item) => sum + item.price, 0))}
              </p>
            </div>
            {otp ? (
              <div className="rounded-control border border-info-line bg-info-soft px-5 py-3.5 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-info">
                  Pickup OTP — share with the collector
                </p>
                <p className="mt-1.5 font-mono text-3xl font-bold tracking-[0.3em] text-ink">
                  {otp}
                </p>
                <p className="mt-1.5 max-w-xs text-xs text-ink-subtle">
                  The collector will ask for this 6-digit code to complete the
                  pickup. Keep it handy — you can always generate a new one
                  from the collection detail page if you lose it.
                </p>
              </div>
            ) : null}
            <p className="max-w-md text-sm text-ink-subtle">
              The laboratory will confirm your pickup and assign a collector.
              Track the status from your collection history.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link href={`/home-collections/${detail.id}`} className="inline-flex">
                <Button>
                  View collection
                  <IconChevronRight className="size-4" />
                </Button>
              </Link>
              <Link href="/my-collections" className="inline-flex">
                <Button variant="outline">My pickup requests</Button>
              </Link>
              <Button variant="ghost" onClick={resetFlow}>
                Request another pickup
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
        eyebrow="Home sample collection"
        title="Request a home pickup"
        description="Choose a laboratory, pick your tests, select a verified pickup slot and confirm your address."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Home collection" },
        ]}
        actions={
          <Link href="/my-collections" className="inline-flex">
            <Button variant="outline">My pickup requests</Button>
          </Link>
        }
      />

      {/* Progress indicator */}
      <ol
        aria-label="Collection request progress"
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
              Only active laboratories with home collection enabled can be
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
                  apiGet<ListResponse<CollectableLaboratory>>(
                    "/api/home-collections/catalog",
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
                      onClick={() => entry.collectable && selectLaboratory(entry)}
                      disabled={!entry.collectable}
                      className={
                        "flex h-full w-full flex-col rounded-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                        (entry.collectable
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
                        {entry.collectable ? (
                          <Badge variant="success" size="sm">
                            Available
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
                          ? `Pickups ${entry.schedule.openingTime} – ${entry.schedule.closingTime} · ${entry.schedule.timezone}`
                          : "Home collection not configured for this laboratory."}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={IconHome}
                title="No laboratories available"
                description="There are no active laboratories offering home collection right now. Please check back later."
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
              <Button variant="ghost" size="sm" onClick={() => goTo(1)}>
                <IconChevronLeft className="size-4" />
                Change laboratory
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {eligibleBookings.length > 0 ? (
              <div className="mb-5 rounded-control border border-info-line bg-info-soft p-3.5">
                <p className="text-sm font-medium text-info">
                  Link an existing booking
                </p>
                <p className="mt-0.5 text-xs text-info/90">
                  Selecting a pending or confirmed booking locks the test list
                  to its booked tests. Linking is optional.
                </p>
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Select
                    aria-label="Linked booking"
                    label="Booking"
                    value={linkedBookingId}
                    onChange={(event) => {
                      const next = event.target.value;
                      const booking = eligibleBookings.find(
                        (candidate) => candidate.id === next,
                      );
                      if (booking) applyLinkedBooking(booking);
                      else setLinkedBookingId("");
                    }}
                    options={[
                      { value: "", label: "No linked booking" },
                      ...eligibleBookings.map((booking) => ({
                        value: booking.id,
                        label: `${booking.bookingCode} · ${formatDateLabel(booking.bookingDate)} · ${booking.items.length} test${booking.items.length === 1 ? "" : "s"}`,
                      })),
                    ]}
                    containerClassName="sm:flex-1"
                  />
                </div>
              </div>
            ) : null}

            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="Search tests"
                name="collection-test-search"
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
                      const lockedByBooking =
                        linkedBooking !== null && checked;
                      const disabled =
                        lockedByBooking ||
                        (!checked &&
                          selectedIds.length >= MAX_TESTS_PER_COLLECTION);
                      return (
                        <li key={test.id}>
                          <label
                            className={
                              "flex items-start gap-3 rounded-card border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary/60 " +
                              (checked
                                ? "border-primary bg-primary-light/50 dark:bg-primary-muted/40"
                                : disabled
                                  ? "cursor-not-allowed border-border bg-surface-muted opacity-60"
                                  : "cursor-pointer border-border bg-surface hover:border-primary/50")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleTest(test.id)}
                              className="mt-1 size-4 shrink-0 accent-[#10B981]"
                              aria-describedby={`hc-test-${test.id}-meta`}
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
                                id={`hc-test-${test.id}-meta`}
                                className="mt-0.5 block text-xs text-ink-muted"
                              >
                                {test.code} · {test.category} ·{" "}
                                {formatTurnaroundLabel(
                                  test.turnaroundTimeMinutes,
                                )}
                                {test.department
                                  ? ` · ${test.department.name}`
                                  : ""}
                                {lockedByBooking ? " · from linked booking" : ""}
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
                icon={IconHome}
                title="No active tests"
                description="This laboratory has no active tests right now. Pick another laboratory or check back later."
                action={
                  <Button size="sm" variant="outline" onClick={() => goTo(1)}>
                    Choose another laboratory
                  </Button>
                }
              />
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {selectedIds.length} test{selectedIds.length === 1 ? "" : "s"}{" "}
                selected · Estimated total {formatPrice(total)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(1)}>
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  onClick={() => goTo(3)}
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
                <CardTitle>Choose a pickup date and time</CardTitle>
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
              label="Pickup date"
              name="collection-date"
              type="date"
              required
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(event) => {
                setDate(event.target.value);
                setSlot("");
              }}
              error={fieldErrors.scheduledDate}
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
                  description="Available pickup slots will appear here once you choose a date."
                />
              ) : availabilityLoading ? (
                <div
                  className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4"
                  aria-hidden="true"
                >
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
                !availability.available ? (
                  <EmptyState
                    icon={IconCalendarCheck}
                    title="Date unavailable"
                    description={
                      availability.message ??
                      "The selected date cannot be scheduled for pickup."
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
                      Available pickup slots
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

      {/* ---------------- Step 4: pickup address ---------------- */}
      {step === 4 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Pickup address</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Where should the collector arrive? Indian PIN codes and your
                  current location are required for pickup.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(3)}>
                <IconChevronLeft className="size-4" />
                Change slot
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Recipient name"
                name="hc-recipient-name"
                autoComplete="name"
                required
                value={address.recipientName}
                onChange={(event) =>
                  updateAddress({ recipientName: event.target.value })
                }
                error={fieldErrors["address.recipientName"]}
              />
              <Input
                label="Contact phone"
                name="hc-phone"
                type="tel"
                autoComplete="tel"
                required
                value={address.phone}
                onChange={(event) => updateAddress({ phone: event.target.value })}
                error={fieldErrors["address.phone"]}
                hint="Used by the collector on the day of pickup."
              />
              <Input
                label="Address line 1"
                name="hc-address-1"
                autoComplete="address-line1"
                required
                value={address.addressLine1}
                onChange={(event) =>
                  updateAddress({ addressLine1: event.target.value })
                }
                error={fieldErrors["address.addressLine1"]}
                containerClassName="sm:col-span-2"
              />
              <Input
                label="Address line 2 (optional)"
                name="hc-address-2"
                autoComplete="address-line2"
                value={address.addressLine2}
                onChange={(event) =>
                  updateAddress({ addressLine2: event.target.value })
                }
                error={fieldErrors["address.addressLine2"]}
                containerClassName="sm:col-span-2"
              />
              <Input
                label="Landmark (optional)"
                name="hc-landmark"
                value={address.landmark}
                onChange={(event) =>
                  updateAddress({ landmark: event.target.value })
                }
                error={fieldErrors["address.landmark"]}
              />
              <Input
                label="City"
                name="hc-city"
                autoComplete="address-level2"
                required
                value={address.city}
                onChange={(event) => updateAddress({ city: event.target.value })}
                error={fieldErrors["address.city"]}
              />
              <Input
                label="State"
                name="hc-state"
                autoComplete="address-level1"
                required
                value={address.state}
                onChange={(event) => updateAddress({ state: event.target.value })}
                error={fieldErrors["address.state"]}
              />
              <Input
                label="PIN code"
                name="hc-pincode"
                autoComplete="postal-code"
                required
                inputMode="numeric"
                value={address.pincode}
                onChange={(event) =>
                  updateAddress({ pincode: event.target.value })
                }
                error={fieldErrors["address.pincode"]}
                hint="6-digit Indian PIN code."
              />
            </div>

            <div className="mt-4 rounded-control border border-border bg-surface-muted p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Pickup location
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Captured from your browser with your permission. You can
                    still edit the address above afterwards.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={captureMyLocation}
                  loading={geoState.loading}
                >
                  {geoState.loading ? "Locating..." : "Use my current location"}
                </Button>
              </div>
              {address.latitude !== null && address.longitude !== null ? (
                <p className="mt-2 text-xs text-ink-subtle">
                  Coordinates captured: {address.latitude.toFixed(6)},{" "}
                  {address.longitude.toFixed(6)}
                </p>
              ) : (
                <p className="mt-2 text-xs text-ink-subtle">
                  Coordinates are required for pickup. Tap &quot;Use my current
                  location&quot; to capture them.
                </p>
              )}
              {geoState.error ? (
                <p
                  role="alert"
                  className="mt-2 text-xs text-danger"
                >
                  {geoState.error}
                </p>
              ) : null}
              {fieldErrors["address.latitude"] ? (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {fieldErrors["address.latitude"]}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <Textarea
                label="Pickup instructions (optional)"
                name="hc-address-instructions"
                value={address.instructions}
                onChange={(event) =>
                  updateAddress({ instructions: event.target.value })
                }
                error={fieldErrors["address.instructions"]}
                maxLength={500}
                placeholder="e.g. Ring the second-floor bell, call before arriving"
                hint="Shared with the assigned collector only."
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
                <Button
                  onClick={() => {
                    if (validateAddress()) goTo(5);
                  }}
                >
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
                <CardTitle>Review your collection request</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Check the details below, then confirm to reserve your pickup
                  slot.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goTo(4)}>
                <IconChevronLeft className="size-4" />
                Change address
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
                <dt className="text-ink-subtle">Pickup date & time</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {formatDateLabel(date)} · {slot}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Recipient</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {address.recipientName} · {address.phone}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Address</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {address.addressLine1}
                  {address.addressLine2 ? `, ${address.addressLine2}` : ""},{" "}
                  {address.city}, {address.state} {address.pincode}
                </dd>
              </div>
              {linkedBooking ? (
                <div className="sm:col-span-2">
                  <dt className="text-ink-subtle">Linked booking</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {linkedBooking.bookingCode} ·{" "}
                    {formatDateLabel(linkedBooking.bookingDate)}
                  </dd>
                </div>
              ) : null}
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
                  <p className="text-sm font-semibold text-ink">Estimated total</p>
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatPrice(total)}
                  </p>
                </li>
              </ul>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              Prices are confirmed by the laboratory when the request is
              processed. No payment is taken online.
            </p>

            <div className="mt-4">
              <Textarea
                label="Collection instructions (optional)"
                name="collection-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                error={fieldErrors.collectionInstructions}
                maxLength={500}
                hint="Anything the collector should know (e.g. preferred contact, fasting)."
                placeholder="Optional"
              />
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-control border border-info-line bg-info-soft p-3.5 text-sm text-info">
              <IconShieldCheck
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>
                Free cancellation up to {COLLECTION_CANCELLATION_CUTOFF_HOURS}{" "}
                hour(s) before the scheduled pickup from your collection
                history.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {selectedIds.length} test{selectedIds.length === 1 ? "" : "s"}{" "}
                · Estimated total {formatPrice(total)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => goTo(4)}
                  disabled={submitting}
                >
                  <IconChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  onClick={() => void submitCollection()}
                  loading={submitting}
                >
                  {submitting ? "Requesting..." : "Confirm request"}
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
    (issue) => issue.field === "timeSlot" || issue.field === "scheduledDate",
  );
}
