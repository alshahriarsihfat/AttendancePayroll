# KPSMS — Khan Pharmacy Staff Management System

Attendance and payroll management for Khan Pharmacy. Next.js (App Router) on
Vercel with a Neon PostgreSQL database accessed through the Prisma Neon adapter.

## Production Cron configuration (`CRON_SECRET`)

The scheduled auto clock-out job is invoked by Vercel Cron, which calls
`/api/attendance/auto-clockout` every 5 minutes (see `vercel.json`).

- `CRON_SECRET` **must be configured in the Vercel Production Environment
  Variables** (and in any other environment where the cron must run).
- Its value **must match the Bearer token** that Vercel Cron sends in the
  `Authorization` header for that request (Vercel sends
  `Authorization: Bearer <CRON_SECRET>`).
- Vercel Cron calls `/api/attendance/auto-clockout`; the endpoint authorizes
  the request only when the Bearer token equals `CRON_SECRET` (or when an
  authenticated Admin/Supervisor session is present).
- **Without `CRON_SECRET` set, the scheduled request will fail authentication
  (HTTP 401) and no auto clock-out will occur.**
- **Never publish or commit the actual secret value.** Store it only in the
  Vercel environment; do not place it in the repository, logs, or docs.

## Local development

```bash
pnpm install
pnpm dev
```

Environment variables are read from `.env` (never commit real secrets):

- `DATABASE_URL` — pooled Neon connection string (`-pooler` host)
- `AUTH_SECRET` — session signing secret
- `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` — bootstrap admin credentials
- `CRON_SECRET` — shared secret for the Vercel Cron auto clock-out endpoint

## Scripts

- `pnpm dev` — run the dev server
- `pnpm build` — Prisma generate + production build
- `pnpm test` — run the Vitest suite
- `pnpm db:deploy` — apply pending Prisma migrations (`prisma migrate deploy`)
- `pnpm db:push` — sync schema in development only (never for Production)