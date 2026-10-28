import type { CollectionRequestType } from "@/config/collection-requests";
import type { CollectorRef } from "@/types/home-collection";
import type { LaboratoryRef } from "@/types/laboratory";

/**
 * Public DTO for one row of the central Collection Requests queue.
 *
 * The queue is a read model merged from the two existing request stores
 * (lab-visit bookings and home-collection requests). It carries only what a
 * review row needs: identity, reference, status, schedule, patient name and
 * review timestamp - never contact details or addresses. The status stays the
 * owning module's raw enum value so the client can label and badge it with
 * the module's own mapping.
 */
export interface CollectionRequestSummary {
  id: string;
  requestType: CollectionRequestType;
  /** `LAB-YYYY-NNNNNN` or `HC-YYYY-NNNNNN`. */
  reference: string;
  status: string;
  laboratory: LaboratoryRef | null;
  /** `YYYY-MM-DD` */
  scheduledDate: string;
  /** `HH:mm` slot start in the request timezone. */
  timeSlot: string;
  timezone: string;
  itemCount: number;
  /** Lab-visit total; home collections have no stored order total (`null`). */
  totalAmount: number | null;
  patientName: string | null;
  /** Assigned collector, when a home collection has reached assignment. */
  collector: CollectorRef | null;
  reviewedAt: string | null;
  createdAt: string;
}
