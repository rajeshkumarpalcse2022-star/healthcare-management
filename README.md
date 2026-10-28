# Healthcare Management Platform

Professional healthcare SaaS platform (clinic, laboratory, diagnostics and operations modules) built with Next.js App Router, TypeScript, Tailwind CSS and MongoDB/Mongoose architecture.

## Stack

- **Next.js 16** (App Router, Turbopack)
- **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first design tokens)
- **ESLint** (eslint-config-next)
- **MongoDB + Mongoose** (models for users, doctors, clinics, laboratories, lab tests, bookings, home collections and more)
- **Zod** (isomorphic request validation shared by client forms and server routes)
- **npm**

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env.local    # Windows: copy / macOS: cp
#    -> set MONGODB_URI to your MongoDB instance
#    -> set AUTH_SECRET to a long random string (session signing)

# 3. Seed a first admin (development only, upsert, never drops data)
node scripts/seed-dev-user.mjs admin@local.test 'choose-a-strong-pass' 'Local Admin' ADMIN

# 4. Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - the root route redirects to `/dashboard`.

Privileged roles (admin, lab manager, staff, collector) can also be provisioned in-app from **Staff** (`/staff`, SUPER_ADMIN / ADMIN only). Patients and doctors self-register at `/signup`.

## Scripts

| Script                     | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `npm run dev`              | Start the development server                     |
| `npm run build`            | Production build                                 |
| `npm run start`            | Serve the production build                       |
| `npm run lint`             | Run ESLint                                       |
| `npm run typecheck`        | Run TypeScript (`tsc --noEmit`)                  |
| `npm test`                 | All offline suites + smoke (`step7/8/9/10`)      |
| `npm run test:step7`       | Booking offline contract tests                   |
| `npm run test:step7:live`  | Booking live tests (boots a dev server)          |
| `npm run test:step8`       | Home collection offline contract tests           |
| `npm run test:step9`       | Auth/scoping/phase offline contract tests        |
| `npm run test:review:live` | End-to-end review-workflow live tests            |
| `npm run test:step10`      | Server-boundary smoke tests                      |

Live suites boot their own throwaway dev server against an isolated database (see each script header) - stop your own dev server first to avoid a Next.js build-directory clash.

## Project structure

```
src/
├── app/
│   ├── api/                   Management APIs (role-gated, Zod-validated)
│   ├── (dashboard)/           Authenticated app shell (per-role dashboards + modules)
│   ├── login/ signup/         Public auth pages
│   └── error.tsx              Root error boundary (retryable)
├── components/
│   ├── ui/                    Design-system primitives
│   ├── layout/ shared/        Shell, page headers, quick links
│   ├── admin/ staff/ labs/    Module feature components
│   └── icons.tsx              Inline SVG icon set
├── config/                    Roles, navigation, module constants
├── lib/
│   ├── auth/                  Session, requireRole, laboratory scoping
│   ├── db/                    MongoDB connection + model registry
│   ├── validation/            Isomorphic Zod schemas
│   └── api/                   Response envelopes + client fetch helpers
├── models/                    Mongoose models
└── types/                     Shared type definitions
scripts/                       Offline + live test suites, dev user seed
```

## Platform modules (routes)

| Module            | Route              | Status                                |
| ----------------- | ------------------ | ------------------------------------- |
| Dashboard         | `/dashboard`       | Live                                  |
| Doctor / Clinic   | `/doctors`         | Live (directory, profiles, approval)  |
| Lab / LIMS        | `/lab`             | Live (labs, departments, tests, params) |
| Online Booking    | `/bookings`        | Live (wizard, management, review)     |
| Home Collection   | `/home-collection` | Live (requests, OTP, collector flows) |
| Staff             | `/staff`           | Live (SA/ADMIN account provisioning)  |
| Staff Access      | `/admin/users`     | Live (laboratory scope assignment)    |
| Patients          | `/patients`        | Planned (placeholder shell)           |
| Billing & Payment | `/billing`         | Planned (placeholder shell)           |
| Inventory         | `/inventory`       | Planned (placeholder shell)           |

## Access model

- Public self-signup: `PATIENT`, `DOCTOR` (`/signup`).
- Admin-provisioned roles (`POST /api/users`, SUPER_ADMIN/ADMIN only): `ADMIN`, `DOCTOR`, `LAB_MANAGER`, `STAFF`, `COLLECTOR`. `SUPER_ADMIN` is seed-only.
- `LAB_MANAGER` / `STAFF` carry a per-laboratory scope (`laboratoryIds`) enforced on every operational LIMS / booking / collection surface; new accounts start scoped to nothing until assigned under **Administration → Staff Access**.
