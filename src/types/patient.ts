import type { AppointmentType } from "@/config/appointments";

/**
 * Patient-related DTO shapes shared by server and client code.
 *
 * The platform-wide directory uses `PatientDto` (see `@/lib/patient/dto`);
 * this lighter shape is what a doctor sees for patients they have personally
 * treated - identity plus aggregate visit information only.
 */

/** A patient the signed-in doctor has completed at least one consultation with. */
export interface DoctorPatientSummary {
  /** PATIENT-role User id. */
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Number of COMPLETED appointments with this doctor. */
  visits: number;
  /** First completed visit, `YYYY-MM-DD`. */
  firstVisit: string;
  /** Most recent completed visit, `YYYY-MM-DD`. */
  lastVisit: string;
}

/** Consultation summary attached to one completed doctor-patient visit. */
export interface DoctorPatientVisitConsultation {
  diagnosis: string | null;
  treatmentAdvice: string | null;
  followUp: string | null;
  prescriptionCount: number;
}

/** One completed appointment in the doctor's history with a patient. */
export interface DoctorPatientVisit {
  /** Appointment id - opens the full appointment / consultation detail. */
  id: string;
  appointmentCode: string;
  /** Completed visit date, `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm` slot start. */
  timeSlot: string;
  /** `HH:mm` slot end. */
  endTime: string;
  appointmentType: AppointmentType;
  reason: string | null;
  consultation: DoctorPatientVisitConsultation | null;
}

/** Patient identity plus every completed visit with the signed-in doctor. */
export interface DoctorPatientDetail {
  patient: DoctorPatientSummary;
  visits: DoctorPatientVisit[];
}
