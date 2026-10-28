import Link from "next/link";

import { IconArrowRight } from "@/components/icons";
import type { IconComponent } from "@/types/navigation";

export interface QuickLink {
  label: string;
  href: string;
  description: string;
  icon: IconComponent;
}

/**
 * Grid of module shortcut cards used on the role dashboards.
 * Links point at real routes; no placeholder badges or fake metrics.
 */
export function QuickLinks({ links }: { links: QuickLink[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="card card-interactive group flex items-start gap-4 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-hover transition-colors duration-200 group-hover:bg-primary-muted group-hover:text-primary-active dark:bg-primary/10 dark:text-brand-400 dark:group-hover:bg-primary/20 dark:group-hover:text-brand-300"
              aria-hidden="true"
            >
              <Icon className="size-5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold tracking-tight text-ink">
                  {link.label}
                </p>
                <IconArrowRight className="mt-0.5 size-4 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary-hover" />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {link.description}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
