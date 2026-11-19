import type { Role } from "@/config/roles";

/**
 * Safe user representation.
 *
 * This is the ONLY user shape that leaves the server: `passwordHash` and any
 * other credential material are never included. Shared by API responses,
 * server components and the client (as props only - never as a source of
 * truth).
 */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Display-safe unique account ID (`PAT-XXXXX` / `DOC-XXXXX` / `LAB-XXXXX`). */
  uniqueId?: string;
  role: Role;
  isActive: boolean;
  /**
   * Laboratory assignments for scoped operational roles (LAB_MANAGER/STAFF).
   * Omitted entirely for legacy platform-wide accounts (field absent in the
   * DB); `[]` means explicitly scoped to no laboratory. Interpretation lives
   * in `resolveLaboratoryScope` - never branch on this field ad hoc.
   */
  laboratoryIds?: string[];
  createdAt: string;
}

/** Claims stored inside the signed session token. */
export interface SessionPayload {
  /** User id (JWT `sub` claim). */
  sub: string;
  role: Role;
}

/** Validation issue mapped to a form field. */
export interface AuthFieldIssue {
  field: string;
  message: string;
}

/** Error body returned by every authentication endpoint. */
export interface AuthErrorBody {
  success: false;
  error: string;
  issues?: AuthFieldIssue[];
}

/** `POST /api/auth/register` success body. */
export interface RegisterSuccessBody {
  success: true;
  user: SafeUser;
}

/** `POST /api/auth/login` success body. */
export interface LoginSuccessBody {
  success: true;
  user: SafeUser;
  redirectTo: string;
}

/** `GET /api/auth/me` success body. */
export interface MeSuccessBody {
  success: true;
  user: SafeUser;
}

/** `POST /api/auth/logout` success body. */
export interface LogoutSuccessBody {
  success: true;
}

/** `POST /api/auth/otp/send` success body. */
export interface OtpSendSuccessBody {
  success: true;
  /** Seconds until the OTP expires (for the resend countdown). */
  expiresInSeconds: number;
}

/** `POST /api/auth/otp/verify` success body - account created + logged in. */
export interface OtpVerifySuccessBody {
  success: true;
  user: SafeUser;
  redirectTo: string;
}

/** Provisioning credentials returned once when an admin creates doctor/lab. */
export interface ProvisionedCredentials {
  uniqueId: string;
  /** Plain-text generated password - shown once, never stored. */
  password: string;
}

/** `POST /api/auth/change-credentials` success body. */
export interface ChangeCredentialsSuccessBody {
  success: true;
  user: SafeUser;
}
