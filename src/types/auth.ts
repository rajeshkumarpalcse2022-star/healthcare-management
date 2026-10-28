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
