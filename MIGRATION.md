# AttendancePayroll — Next.js + Neon + Vercel Migration Guide

This project currently runs as a **Vite SPA** (single-file static build, `localStorage` persistence).
The files in `prisma/` and `src/server/` are **production-ready reference implementations**
for the Next.js backend. Follow these steps to bring everything together.

---

## Why a new project?

Vite and Next.js are incompatible build systems. You cannot add `/api/*` routes to a
Vite app — there is no Node.js server at build or runtime. A Next.js project is required
for server-side API routes and Prisma database access.

**Nothing is wasted:** all your UI components (`src/pages/`, `src/components/`,
`src/lib/timeclock.ts`, `src/lib/dates.ts`, `src/lib/config.ts`) copy over unchanged.
Only the data layer swaps from `localStorage` to API calls.

---

## Step 1 — Create the Next.js project

```bash
npx create-next-app@latest AttendancePayroll \
  --typescript --tailwind --app --eslint --src-dir
cd AttendancePayroll
```

## Step 2 — Set up Neon

1. Go to [neon.com](https://neon.com) → **New Project** → `AttendancePayroll`
2. Pick a region close to your users (e.g. `aws-ap-southeast-1` Singapore)
3. From **Dashboard → Connection Details**, copy **both** strings:

```
# POOLED (serverless-safe) — has "-pooler" in the host
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

# DIRECT (migrations only) — no "-pooler"
DIRECT_URL="postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
```

> ⚠️ **Using the direct string for `DATABASE_URL` will exhaust Neon's connection
> limit on Vercel and crash your serverless functions.** Always use `-pooler`.

## Step 3 — Install dependencies

```bash
npm install prisma --save-dev
npm install @prisma/client @neondatabase/serverless @prisma/adapter-neon zod
npx prisma init
```

## Step 4 — Copy the backend files

From this project into your Next.js project:

| From (this repo) | To (Next.js) |
|---|---|
| `prisma/schema.prisma` | `prisma/schema.prisma` |
| `src/server/db.ts` | `src/lib/db.ts` |
| `src/server/api-routes.ts` | split into `src/app/api/*/route.ts` (see Step 6) |

## Step 5 — Configure `.env`

```bash
# .env  (add to .gitignore!)
DATABASE_URL="postgresql://...-pooler...neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://...neon.tech/neondb?sslmode=require"
```

## Step 6 — Create the API routes

Create these files, each wrapping one handler from `api-routes.ts`:

```ts
// src/app/api/clock/route.ts
import { POST_clock } from "@/lib/api-handlers";
export const POST = POST_clock;
```

```ts
// src/app/api/payments/route.ts
import { POST_payment } from "@/lib/api-handlers";
export const POST = POST_payment;
```

```ts
// src/app/api/advance/route.ts
import { POST_advance } from "@/lib/api-handlers";
export const POST = POST_advance;
```

## Step 7 — Push the schema

```bash
npx prisma db push
npx prisma studio   # visual browser to verify tables
```

## Step 8 — Copy the frontend

Copy these directories from this project into Next.js:

```
src/components/   → src/components/
src/lib/          → src/lib/          (timeclock, dates, config, currency, auth, validation, utils, seed)
src/pages/        → src/app/          (convert to Next.js pages)
```

### Converting pages

Next.js App Router uses `page.tsx` files. For example:

```tsx
// src/app/payments/page.tsx
"use client";
import { Payments } from "@/components/Payments";
export default function PaymentsPage() {
  return <Payments />;
}
```

Add `"use client"` to the top of any component using `useState`/`useEffect`.

## Step 9 — Swap the data layer

Replace `localStorage` calls in `AppContext.tsx` with API fetches:

```ts
// BEFORE (localStorage)
const clockIn = (staffId: string) => {
  setData(d => ({ ...d, sessions: [...d.sessions, newSession] }));
};

// AFTER (API)
const clockIn = async (staffId: string) => {
  const res = await fetch("/api/clock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: staffId, action: "in" }),
  });
  if (!res.ok) throw new Error(await res.text());
  // Optimistic update, then refresh from server
  await refreshData();
};
```

## Step 10 — GitHub

```bash
git init
git add .
git commit -m "feat: Khan Pharmacy full-stack"
git branch -M main
git remote add origin https://github.com/<you>/khan-pharmacy.git
git push -u origin main
```

## Step 11 — Deploy to Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import your repo
2. Framework auto-detects as **Next.js**
3. **Environment Variables**:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | `postgres://...-pooler...` | Production, Preview, Development |
| `DIRECT_URL` | `postgres://...` | Production, Preview, Development |

4. Click **Deploy**

## Step 12 — Run migrations

```bash
npx prisma migrate deploy
```

---

## The 3 things that crash Neon on Vercel

1. **Using the direct connection string** in `DATABASE_URL` → connection exhaustion.
   Always use the `-pooler` URL.
2. **Creating a new `PrismaClient` per request** → leaks connections. The
   `globalThis` cache in `db.ts` prevents this.
3. **Not using the Neon driver adapter** → the standard `pg` driver doesn't handle
   Neon's HTTP proxying in serverless. `@prisma/adapter-neon` is built for it.

All three are already handled in `src/server/db.ts`.

---

## Money-math safety

Both layers use the identical `payRound()` implementation, so the frontend preview
and the backend record always agree to the cent:

```ts
// Single rounding point — applied once at record creation
const grossPay = payRound(hourlyRate * (basicMin / 60));
const advanceAdjusted = payRound(Math.min(staff.advance, netEarned));
const netPay = payRound(netEarned - advanceAdjusted);
```

Never round intermediate values. Round only the final stored figure.

---

## File inventory (what goes where)

```
khan-pharmacy/
├── prisma/
│   └── schema.prisma          ← from this repo
├── src/
│   ├── lib/
│   │   ├── db.ts              ← from src/server/db.ts
│   │   ├── api-handlers.ts    ← from src/server/api-routes.ts
│   │   ├── timeclock.ts       ← from src/lib/
│   │   ├── dates.ts           ← from src/lib/
│   │   ├── config.ts          ← from src/lib/
│   │   ├── currency.ts        ← from src/lib/
│   │   ├── auth.ts            ← from src/lib/
│   │   └── validation.ts      ← from src/lib/
│   ├── components/
│   │   ├── ui.tsx             ← from src/components/
│   │   ├── Modal.tsx          ← from src/components/
│   │   ├── icons.tsx          ← from src/components/
│   │   ├── PhotoAvatar.tsx    ← from src/components/
│   │   └── ...                ← all other components
│   └── app/
│       ├── layout.tsx         ← new (Next.js root layout)
│       ├── page.tsx           ← dashboard
│       ├── payments/page.tsx  ← payments
│       ├── attendance/page.tsx
│       ├── staff/page.tsx
│       └── api/
│           ├── clock/route.ts
│           ├── payments/route.ts
│           └── advance/route.ts
├── .env                       ← Neon credentials
└── package.json
```
