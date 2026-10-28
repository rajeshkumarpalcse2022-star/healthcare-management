import { NextResponse } from "next/server";

import { BOOKING_STATUSES } from "@/config/lab-bookings";
import { COLLECTION_STATUSES, canViewCollectionManagement } from "@/config/home-collection";
import { ROLES } from "@/config/roles";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireAuth,
  scopeFilter,
} from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import {
  toCollectionRequestFromBooking,
  toCollectionRequestFromCollection,
} from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import { collectionRequestListQuerySchema } from "@/lib/validation/collection-requests";
import { LabBooking } from "@/models/LabBooking";
import { HomeCollection } from "@/models/HomeCollection";
import { User } from "@/models/User";
import type { CollectionRequestSummary } from "@/types/collection-requests";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * Ceiling on how many documents are pulled from each source store per merged
 * page window. Correct merged paging only needs the newest `offset + limit`
 * rows from every source (anything older cannot reach the requested page), so
 * the cap only truncates extremely deep pages of a queue that is meant to be
 * worked from the top.
 */
const MERGED_FETCH_CAP = 1000;

/** How many patient matches a name search may contribute. */
const PATIENT_SEARCH_CAP = 100;

/**
 * GET /api/collection-requests
 *
 * Central review queue: every request a patient can raise, in one list.
 * - LAB_VISIT rows are read from the existing `LabBooking` collection;
 * - HOME_COLLECTION rows are read from the existing `HomeCollection`
 *   collection;
 * - nothing is written, copied or denormalised here - this endpoint is a
 *   read model, so an approval recorded through either module's own endpoint
 *   is immediately visible (and never duplicated) in both views;
 * - gated to operational review roles (same gate as home-collection
 *   management); patients never reach this endpoint;
 * - LAB_MANAGER and STAFF accounts with assignments only see rows from
 *   their own laboratories (both source stores are scoped identically);
 * - list rows carry patient name and reference only - no contact details,
 *   no addresses, no OTP material.
 *
 * Filters: type, status (the union of both status enums), laboratory,
 * scheduled-date range, and a search over reference codes or patient names.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!canViewCollectionManagement(user.role)) {
    return errorResponse(
      403,
      "You do not have permission to view the collection requests queue.",
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = collectionRequestListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    type: searchParams.get("type") ?? "all",
    status: searchParams.get("status") ?? "all",
    laboratory: searchParams.get("laboratory") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, type, status, laboratory, dateFrom, dateTo, page, limit } =
    parsed.data;

  /* ---------------- which sources participate in this query ------------- */
  const includeBookings = type === "all" || type === "LAB_VISIT";
  const includeCollections = type === "all" || type === "HOME_COLLECTION";
  const bookingsMatchStatus =
    status === "all" || (BOOKING_STATUSES as readonly string[]).includes(status);
  const collectionsMatchStatus =
    status === "all" || (COLLECTION_STATUSES as readonly string[]).includes(status);

  const wantBookings = includeBookings && bookingsMatchStatus;
  const wantCollections = includeCollections && collectionsMatchStatus;

  if (!wantBookings && !wantCollections) {
    // e.g. status=ASSIGNED with type=LAB_VISIT: no source can ever match.
    return listResponse<CollectionRequestSummary>(
      [],
      buildListMeta(page, limit, 0),
    );
  }

  try {
    await connectToDatabase();

    /* ---------------- shared filter fragments ---------------- */
    const referenceFilter = search ? containsRegex(search.toUpperCase()) : null;
    let patientIds: unknown[] | null = null;
    if (search) {
      // Patient-name search resolves to ids first so the merge never has to
      // denormalise names into either request store.
      const patients = await User.find({
        role: ROLES.PATIENT,
        name: containsRegex(search),
      })
        .select("_id")
        .limit(PATIENT_SEARCH_CAP)
        .lean();
      patientIds = patients.map((patient) => patient._id);
    }

    function buildFilter(
      codeField: "bookingCode" | "collectionCode",
      dateField: "bookingDate" | "scheduledDate",
    ): Record<string, unknown> {
      const filter: Record<string, unknown> = { ...scopeFilter(user) };
      if (laboratory) {
        // Intersect the laboratory filter with the caller's scope: outside
        // the scope this source can never match (empty, no probing).
        filter.laboratoryId = isLaboratoryInScope(user, laboratory)
          ? laboratory
          : { $in: [] };
      }
      if (status !== "all") filter.status = status;
      if (referenceFilter || patientIds) {
        const or: Record<string, unknown>[] = [];
        if (referenceFilter) or.push({ [codeField]: referenceFilter });
        if (patientIds && patientIds.length > 0) {
          or.push({ patientId: { $in: patientIds } });
        }
        if (or.length > 0) filter.$or = or;
      }
      if (dateFrom || dateTo) {
        const range: Record<string, Date> = {};
        if (dateFrom) range.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
        if (dateTo) range.$lte = new Date(`${dateTo}T00:00:00.000Z`);
        filter[dateField] = range;
      }
      return filter;
    }

    const bookingFilter = buildFilter("bookingCode", "bookingDate");
    const collectionFilter = buildFilter("collectionCode", "scheduledDate");

    const offset = (page - 1) * limit;
    // A merged page only needs the newest `offset + limit` rows per source.
    const fetchWindow = Math.min(offset + limit, MERGED_FETCH_CAP);

    const [bookingCount, collectionCount, bookingDocs, collectionDocs] =
      (await Promise.all([
        wantBookings
          ? LabBooking.countDocuments(bookingFilter)
          : Promise.resolve(0),
        wantCollections
          ? HomeCollection.countDocuments(collectionFilter)
          : Promise.resolve(0),
        wantBookings
          ? LabBooking.find(bookingFilter)
              .sort({ createdAt: -1 })
              .limit(fetchWindow)
              .populate("laboratoryId", "name code isActive")
              .populate("patientId", "name")
              .lean()
          : Promise.resolve([] as unknown[]),
        wantCollections
          ? HomeCollection.find(collectionFilter)
              .sort({ createdAt: -1 })
              .limit(fetchWindow)
              .populate("laboratoryId", "name code isActive")
              .populate("patientId", "name")
              .populate("assignedCollectorId", "name phone")
              .lean()
          : Promise.resolve([] as unknown[]),
      ])) as [number, number, unknown[], unknown[]];

    /* ---------------- merge by recency, then slice ---------------- */
    const merged: CollectionRequestSummary[] = [
      ...bookingDocs.map((doc) =>
        toCollectionRequestFromBooking(doc as Parameters<
          typeof toCollectionRequestFromBooking
        >[0]),
      ),
      ...collectionDocs.map((doc) =>
        toCollectionRequestFromCollection(doc as Parameters<
          typeof toCollectionRequestFromCollection
        >[0]),
      ),
    ];
    merged.sort((left, right) => {
      const byDate = right.createdAt.localeCompare(left.createdAt);
      if (byDate !== 0) return byDate;
      // Deterministic tie-break so equal timestamps never flap between pages.
      return right.id.localeCompare(left.id);
    });

    const total = bookingCount + collectionCount;
    const rows = merged.slice(offset, offset + limit);

    return listResponse(rows, buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("collection-requests", error);
    return errorResponse(
      503,
      "Unable to load the collection requests queue right now. Please try again.",
    );
  }
}
