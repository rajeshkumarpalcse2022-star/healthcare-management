/**
 * Authentication library barrel.
 *
 * Server-side only. `src/proxy.ts` deliberately does NOT import from here -
 * it only needs the dependency-free constants in `@/config/auth`.
 */

export { hashPassword, verifyPassword } from "./password";
export {
  clearSessionCookie,
  getSession,
  setSessionCookie,
} from "./session";
export {
  AuthError,
  InfrastructureError,
  INFRASTRUCTURE_ERROR_MESSAGE,
  authErrorResponse,
  getCurrentUser,
  isAuthError,
  requireAuth,
  requireRole,
  resolvePostLoginRedirect,
  toSafeUser,
} from "./auth";
export {
  SCOPED_ROLES,
  isLaboratoryInScope,
  resolveLaboratoryScope,
  scopeFilter,
} from "./laboratory-scope";
