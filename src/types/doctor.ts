export const DOCTOR_GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

export type DoctorGender = (typeof DOCTOR_GENDERS)[number];

/** Lightweight clinic reference embedded in doctor payloads. */
export interface DoctorClinicRef {
  id: string;
  name: string;
  code: string;
  city: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

/**
 * Doctor profile record.
 *
 * Profile data only - authentication credentials never live here. `userId`
 * optionally links the profile to a login account in the User collection.
 */
export interface Doctor {
  id: string;
  userId: string | null;
  /** Primary clinic (first assignment), retained for compact surfaces. */
  clinic: DoctorClinicRef | null;
  /** Every clinic this doctor is assigned to. */
  clinics: DoctorClinicRef[];
  doctorCode: string;
  name: string;
  email: string;
  phone: string | null;
  specialization: string;
  qualification: string | null;
  registrationNumber: string | null;
  experienceYears: number | null;
  consultationFee: number | null;
  gender: DoctorGender | null;
  dateOfBirth: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
