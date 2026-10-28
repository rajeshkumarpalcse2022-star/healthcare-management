import type { ComponentType, SVGProps } from "react";

/** Minimal contract every inline icon in the platform satisfies. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavigationItem {
  /** Visible label in the sidebar / drawer. */
  label: string;
  /** Absolute route path. */
  href: string;
  icon: IconComponent;
  /** Short supporting text (used in mobile drawer and tooltips). */
  description: string;
  /**
   * Extra routes that should light up this entry when visited - used by
   * landing pages that link into one of several flows (e.g. "Book a Test"
   * highlights for /bookings as well as /home-collection).
   */
  activeHrefs?: string[];
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}
