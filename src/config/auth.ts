import type { Role } from "@/config/roles";

/**
 * Authentication constants shared by server code and the request proxy.
 *
 * Intentionally dependency-free (no `server-only`, no environment access) so
 * that `src/proxy.ts` can import it safely on any runtime.
 */

/** Name of the HTTP-only session cookie. */
export const SESSION_COOKIE_NAME = "auth_session";

/** Route the proxy and server helpers redirect unauthenticated users to. */
export const LOGIN_ROUTE = "/login";

/** Route where new users create an account. */
export const SIGNUP_ROUTE = "/signup";

/** Fallback destination after a successful login. */
export const DEFAULT_POST_LOGIN_ROUTE = "/dashboard";

/** Map of every role to its dedicated dashboard route. */
export const ROLE_DASHBOARD_ROUTES: Record<Role, string> = {
  SUPER_ADMIN: "/super-admin/dashboard",
  ADMIN: "/admin/dashboard",
  DOCTOR: "/doctor/dashboard",
  LAB_MANAGER: "/lab-manager/dashboard",
  STAFF: "/staff/dashboard",
  PATIENT: "/patient/dashboard",
  COLLECTOR: "/collector/dashboard",
};

/** Returns the dedicated dashboard route for a role. */
export function getDashboardRouteForRole(role: Role): string {
  return ROLE_DASHBOARD_ROUTES[role] ?? DEFAULT_POST_LOGIN_ROUTE;
}

/**
 * Session lifetimes in seconds.
 *
 * - `standard`: JWT expiry backstop when "Remember me" is off. The cookie
 *   itself is a browser-session cookie, so it is cleared when the browser
 *   closes - the JWT simply cannot outlive the browser session.
 * - `remembered`: "Remember me" on - persistent cookie + matching JWT expiry.
 */
export const SESSION_LIFETIME = {
  standard: 60 * 60 * 24 * 7,
  remembered: 60 * 60 * 24 * 30,
} as const;
