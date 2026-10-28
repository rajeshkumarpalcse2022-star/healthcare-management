/** Clinic record as exposed by the management APIs. */
export interface Clinic {
  id: string;
  name: string;
  /** Business code, normalised to uppercase. */
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  registrationNumber: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
