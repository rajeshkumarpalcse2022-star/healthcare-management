import type { NavigationGroup } from "@/types/navigation";
import type { Role } from "@/config/roles";
import {
  IconActivity,
  IconBadgeCheck,
  IconCalendarCheck,
  IconCreditCard,
  IconFlaskConical,
  IconHome,
  IconInbox,
  IconLayoutDashboard,
  IconPackage,
  IconSettings,
  IconShieldCheck,
  IconStethoscope,
  IconUser,
  IconUsers,
} from "@/components/icons";

/**
 * Navigation for the eight platform modules plus the dashboard.
 * This is the single source of truth for the sidebar, mobile drawer,
 * and any future module directory surfaces.
 */
export const navigation: NavigationGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: IconLayoutDashboard,
        description: "Platform overview",
      },
    ],
  },
  {
    label: "Clinical",
    items: [
      {
        label: "Doctor / Clinic",
        href: "/doctors",
        icon: IconStethoscope,
        description: "Doctors and clinics",
      },
      {
        label: "Patients",
        href: "/patients",
        icon: IconUsers,
        description: "Patient management",
      },
      {
        label: "Appointments",
        href: "/appointments",
        icon: IconCalendarCheck,
        description: "Appointment monitoring",
      },
    ],
  },
  {
    label: "Diagnostics",
    items: [
      {
        label: "Lab / LIMS",
        href: "/lab",
        icon: IconFlaskConical,
        description: "Laboratory and LIMS",
      },
      {
        label: "Online Booking",
        href: "/bookings",
        icon: IconCalendarCheck,
        description: "Online lab booking",
      },
      {
        label: "Home Collection",
        href: "/home-collection",
        icon: IconHome,
        description: "Home sample collection",
      },
      {
        label: "Collection Requests",
        href: "/home-collections/manage",
        icon: IconInbox,
        description: "Review and assign collection requests",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Billing & Payment",
        href: "/billing",
        icon: IconCreditCard,
        description: "Billing and payments",
      },
      {
        label: "Inventory",
        href: "/inventory",
        icon: IconPackage,
        description: "Inventory and stock",
      },
      {
        label: "Staff",
        href: "/staff",
        icon: IconBadgeCheck,
        description: "Staff management",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Staff Access",
        href: "/admin/users",
        icon: IconShieldCheck,
        description: "Laboratory scope assignments",
      },
    ],
  },
];

export const flatNavigation = navigation.flatMap((group) => group.items);

/**
 * Role-tailored navigation.
 *
 * Each role gets a focused sidebar: management roles see the full module set,
 * operational roles see only the modules they work with, and self-service
 * roles (patient, collector) see their own surfaces. The Dashboard entry in
 * every list points at that role's dedicated dashboard route.
 */
export const roleNavigation: Record<Role, NavigationGroup[]> = {
  SUPER_ADMIN: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/super-admin/dashboard",
          icon: IconLayoutDashboard,
          description: "Platform overview",
        },
      ],
    },
    ...navigation.slice(1),
  ],
  ADMIN: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/admin/dashboard",
          icon: IconLayoutDashboard,
          description: "Admin overview",
        },
      ],
    },
    ...navigation.slice(1),
  ],
  DOCTOR: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/doctor/dashboard",
          icon: IconLayoutDashboard,
          description: "Your practice overview",
        },
      ],
    },
    {
      label: "Clinical",
      items: [
        {
          label: "Patients",
          href: "/doctor/patients",
          icon: IconUsers,
          description: "Patients you have treated",
        },
        {
          label: "Doctor / Clinic",
          href: "/doctors",
          icon: IconStethoscope,
          description: "Doctors and clinics",
        },
      ],
    },
    {
      label: "Appointments",
      items: [
        {
          label: "Today's Appointments",
          href: "/doctor/appointments",
          icon: IconCalendarCheck,
          description: "See today's patients",
        },
        {
          label: "All Appointments",
          href: "/doctor/appointments/all",
          icon: IconInbox,
          description: "Full appointment history",
        },
        {
          label: "Availability & Schedule",
          href: "/doctor/schedule",
          icon: IconSettings,
          description: "Set working days and hours",
        },
        {
          label: "Consultation Records",
          href: "/doctor/consultations",
          icon: IconActivity,
          description: "Notes and prescriptions",
        },
      ],
    },
  ],
  LAB_MANAGER: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/lab-manager/dashboard",
          icon: IconLayoutDashboard,
          description: "Lab operations overview",
        },
      ],
    },
    {
      label: "Diagnostics",
      items: [
        {
          label: "Lab / LIMS",
          href: "/lab",
          icon: IconFlaskConical,
          description: "Laboratory and LIMS",
        },
        {
          label: "Online Booking",
          href: "/lab-bookings",
          icon: IconCalendarCheck,
          description: "Process online lab bookings",
        },
        {
          label: "Home Collection",
          href: "/home-collection",
          icon: IconHome,
          description: "Home sample collection",
        },
        {
          label: "Collection Requests",
          href: "/home-collections/manage",
          icon: IconInbox,
          description: "Review and assign collection requests",
        },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          label: "Billing & Payment",
          href: "/billing",
          icon: IconCreditCard,
          description: "Billing and payments",
        },
        {
          label: "Inventory",
          href: "/inventory",
          icon: IconPackage,
          description: "Inventory and stock",
        },
      ],
    },
  ],
  STAFF: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/staff/dashboard",
          icon: IconLayoutDashboard,
          description: "Staff overview",
        },
      ],
    },
    {
      label: "Clinical",
      items: [
        {
          label: "Patients",
          href: "/patients",
          icon: IconUsers,
          description: "Patient management",
        },
      ],
    },
    {
      label: "Diagnostics",
      items: [
        {
          label: "Online Booking",
          href: "/lab-bookings",
          icon: IconCalendarCheck,
          description: "Process online lab bookings",
        },
        {
          label: "Home Collection",
          href: "/home-collection",
          icon: IconHome,
          description: "Home sample collection",
        },
        {
          label: "Collection Requests",
          href: "/home-collections/manage",
          icon: IconInbox,
          description: "View collection requests",
        },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          label: "Billing & Payment",
          href: "/billing",
          icon: IconCreditCard,
          description: "Billing and payments",
        },
        {
          label: "Inventory",
          href: "/inventory",
          icon: IconPackage,
          description: "Inventory and stock",
        },
      ],
    },
  ],
  PATIENT: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/patient/dashboard",
          icon: IconLayoutDashboard,
          description: "Your health overview",
        },
      ],
    },
    {
      label: "Diagnostics",
      items: [
        {
          label: "Book a Test",
          href: "/book-a-test",
          activeHrefs: ["/bookings", "/home-collection"],
          icon: IconFlaskConical,
          description: "Lab visit or home pickup",
        },
        {
          label: "My Bookings",
          href: "/my-bookings",
          icon: IconCalendarCheck,
          description: "Your lab bookings",
        },
        {
          label: "My pickup requests",
          href: "/my-collections",
          icon: IconHome,
          description: "Your sample pickups",
        },
      ],
    },
    {
      label: "Appointments",
      items: [
        {
          label: "Find a Doctor",
          href: "/find-a-doctor",
          icon: IconStethoscope,
          description: "Browse doctors and book",
        },
        {
          label: "My Appointments",
          href: "/my-appointments",
          icon: IconCalendarCheck,
          description: "Your doctor appointments",
        },
        {
          label: "Medical Records",
          href: "/medical-records",
          icon: IconActivity,
          description: "Consultations and prescriptions",
        },
        {
          label: "My Profile",
          href: "/profile",
          icon: IconUser,
          description: "Your personal details",
        },
      ],
    },
  ],
  COLLECTOR: [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/collector/dashboard",
          icon: IconLayoutDashboard,
          description: "Your field overview",
        },
      ],
    },
    {
      label: "Field Work",
      items: [
        {
          label: "My Assignments",
          href: "/my-assignments",
          icon: IconBadgeCheck,
          description: "Your assigned pickups",
        },
      ],
    },
  ],
};

/** Returns the role-tailored navigation for the given role. */
export function getNavigationForRole(role: Role): NavigationGroup[] {
  return roleNavigation[role] ?? navigation;
}

/** Looks up a single navigation entry by its route. */
export function getNavigationItem(href: string) {
  const item = flatNavigation.find((entry) => entry.href === href);
  if (!item) {
    throw new Error(`No navigation item registered for route "${href}"`);
  }
  return item;
}
