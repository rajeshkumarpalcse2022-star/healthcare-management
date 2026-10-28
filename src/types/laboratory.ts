/** Online-booking configuration stored on a laboratory. */
export interface LaboratoryBookingConfig {
  timezone: string;
  /** Weekday indexes (0 = Sunday … 6 = Saturday). */
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  maxAdvanceDays: number;
}

/** Laboratory directory record - the public DTO shape. */
export interface Laboratory {
  id: string;
  name: string;
  /** Business code, stored normalised (uppercase, hyphenated). */
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  registrationNumber: string | null;
  accreditation: string | null;
  /** `null` when the laboratory has not configured online booking. */
  bookingConfig: LaboratoryBookingConfig | null;
  /** `null` when the laboratory has not enabled home collection. */
  homeCollectionConfig: LaboratoryBookingConfig | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Minimal laboratory reference used on nested records. */
export interface LaboratoryRef {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}
