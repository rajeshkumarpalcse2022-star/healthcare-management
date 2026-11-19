import { ROLES, type Role } from "@/config/roles";

/**
 * Demo sign-in accounts surfaced on the public login page.
 *
 * These are seeded by `scripts/seed-demo-users.mjs` and exist purely so the
 * platform can be explored without manual provisioning. The password is
 * shared by every demo role and is intentionally public.
 */
export const DEMO_ACCOUNT_PASSWORD = "Healthcare@123";

export interface DemoAccount {
  role: Role;
  label: string;
  email: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: ROLES.ADMIN,
    label: "Admin",
    email: "admin@healthcare.test",
  },
  {
    role: ROLES.DOCTOR,
    label: "Doctor",
    email: "doctor@healthcare.test",
  },
  {
    role: ROLES.LAB_MANAGER,
    label: "Lab Manager",
    email: "lab@healthcare.test",
  },
  {
    role: ROLES.PATIENT,
    label: "Patient",
    email: "patient@healthcare.test",
  },
  {
    role: ROLES.COLLECTOR,
    label: "Collector",
    email: "collector@healthcare.test",
  },
] as const;
