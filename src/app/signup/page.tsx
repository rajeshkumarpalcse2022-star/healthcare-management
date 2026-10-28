import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  IconCreditCard,
  IconFlaskConical,
  IconLock,
  IconStethoscope,
} from "@/components/icons";
import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { APP_NAME, APP_TAGLINE } from "@/config/constants";
import { getCurrentUser } from "@/lib/auth";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create an account",
};

const platformHighlights = [
  {
    icon: IconStethoscope,
    text: "Doctors, clinics and lab / LIMS operations",
  },
  {
    icon: IconFlaskConical,
    text: "Online booking and home sample collection",
  },
  {
    icon: IconCreditCard,
    text: "Staff accounts with role-based access control",
  },
] as const;

/**
 * Public registration page (outside the dashboard route group).
 * Already-authenticated visitors are sent straight to their dashboard.
 */
export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:flex-row">
      {/* Brand panel */}
      <aside className="relative overflow-hidden bg-brand-950 px-6 py-7 sm:px-8 lg:flex lg:w-[44%] lg:max-w-[34rem] lg:flex-col lg:justify-between lg:px-12 lg:py-12 xl:px-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_srgb,var(--color-primary)_35%,transparent)_0%,transparent_55%)]"
        />

        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-white">
              {APP_NAME}
            </p>
            <p className="truncate text-xs text-brand-200/80">{APP_TAGLINE}</p>
          </div>
        </div>

        <div className="relative mt-10 hidden lg:mt-0 lg:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">
            Join the platform
          </p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight text-white xl:text-[2.125rem]">
            Create your account to book, manage and deliver care.
          </h2>

          <ul className="mt-8 flex flex-col gap-4">
            {platformHighlights.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-center gap-3 text-sm text-brand-100/90"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-200">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-8 hidden items-center gap-2 text-xs text-brand-200/70 lg:flex">
          <IconLock className="size-3.5" />
          Passwords are bcrypt-hashed on the server; sessions are HTTP-only.
        </p>
      </aside>

      {/* Sign-up panel */}
      <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14 lg:px-12">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[26rem] animate-fade-in">
          <div className="mb-7">
            <p className="eyebrow">Secure registration</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
              Create your account
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Patients and doctors can self-register. Management roles are
              provisioned by administrators.
            </p>
          </div>

          <SignupForm />

          <p className="mt-6 text-center text-xs text-ink-subtle">
            Already have an account?{" "}
            <Link
              href={LOGIN_ROUTE}
              className="font-medium text-brand-700 underline-offset-2 transition-colors hover:text-brand-800 hover:underline dark:text-brand-300 dark:hover:text-brand-200"
            >
              Sign in
            </Link>
          </p>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-ink-subtle">
            <IconLock className="size-3.5 shrink-0" />
            Credentials are hashed and verified on the server.
          </p>
        </div>
      </main>
    </div>
  );
}
