import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { COOKIE_NAME, decodeSession, authSecret } from "@/lib/auth-session";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_BODY = 1_000_000;
const ALLOWED_COLLECTIONS = new Set(["departments", "shifts", "holidays"]);
const TOKEN_TTL_MS = 5 * 60 * 1000;

const DepartmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  costCenter: z.string(),
}).strict();

const ShiftSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  mealBreakMin: z.number().int().nonnegative(),
  restMin: z.number().int().nonnegative(),
  color: z.string().min(1),
}).strict();

const HolidaySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
}).strict();

const ImportDataSchema = z.object({
  departments: z.array(DepartmentSchema).optional(),
  shifts: z.array(ShiftSchema).optional(),
  holidays: z.array(HolidaySchema).optional(),
}).strict();

function checkDuplicates(arr: { id: string }[] | undefined, label: string): string | null {
  if (!arr) return null;
  const seen = new Set<string>();
  for (const item of arr) {
    if (seen.has(item.id)) return `Duplicate id in ${label}: ${item.id}`;
    seen.add(item.id);
  }
  return null;
}

function signedPayload(payload: any): { version: unknown; data: unknown } {
  return { version: payload?.version, data: payload?.data };
}

function payloadHash(payload: unknown): string {
  return createHmac("sha256", authSecret()).update(JSON.stringify(signedPayload(payload))).digest("hex");
}

function makeToken(hash: string, identity: string): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = createHmac("sha256", authSecret()).update(`${hash}:${exp}:${identity}`).digest("hex");
  return `${exp}.${sig}`;
}

function verifyToken(token: string, hash: string, identity: string): boolean {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = createHmac("sha256", authSecret()).update(`${hash}:${exp}:${identity}`).digest("hex");
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}

function validatePayload(payload: any): string | null {
  if (!payload || typeof payload !== "object" || !payload.data || typeof payload.data !== "object") {
    return "Invalid import payload";
  }
  if (payload.version !== 1) return "Unsupported backup version";
  const data = payload.data as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!ALLOWED_COLLECTIONS.has(key)) return `Protected or unknown collection: ${key}`;
  }
  const parsed = ImportDataSchema.safeParse(data);
  if (!parsed.success) return parsed.error.issues.map((i) => i.message).join("; ");
  if (checkDuplicates(parsed.data.departments, "departments")) return checkDuplicates(parsed.data.departments, "departments");
  if (checkDuplicates(parsed.data.shifts, "shifts")) return checkDuplicates(parsed.data.shifts, "shifts");
  if (checkDuplicates(parsed.data.holidays, "holidays")) return checkDuplicates(parsed.data.holidays, "holidays");
  return null;
}

export async function POST(request: Request) {
  const session = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (session.role !== "ADMIN") return Response.json({ error: "Admin access required" }, { status: 403 });

  const identity = `${session.role}:${session.name ?? "Admin"}`;

  const url = new URL(request.url);
  const isPreview = url.searchParams.get("preview") === "1";

  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Payload too large" }, { status: 413 });

  let payload: any;
  try { payload = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const err = validatePayload(payload);
  if (err) return Response.json({ error: err }, { status: 400 });

  const hash = payloadHash(payload);

  if (isPreview) {
    return Response.json({ ok: true, preview: true, token: makeToken(hash, identity) });
  }

  const token = payload?.token;
  if (typeof token !== "string" || !verifyToken(token, hash, identity)) {
    return Response.json({ error: "Invalid or expired confirmation token" }, { status: 400 });
  }

  const data = payload.data as Record<string, unknown>;
  const state = await prisma.appState.findUnique({ where: { key: "default" } });
  const current = (state?.data ?? {}) as Record<string, unknown>;
  const merged = { ...current };
  for (const key of ALLOWED_COLLECTIONS) {
    if (Array.isArray(data[key])) merged[key] = data[key];
  }

  const counts = {
    departments: Array.isArray(data.departments) ? data.departments.length : 0,
    shifts: Array.isArray(data.shifts) ? data.shifts.length : 0,
    holidays: Array.isArray(data.holidays) ? data.holidays.length : 0,
  };

  await prisma.$transaction([
    prisma.appState.upsert({
      where: { key: "default" },
      create: { key: "default", data: merged as any, session: null as any },
      update: { data: merged as any },
    }),
    prisma.auditLog.create({
      data: {
        action: "IMPORT",
        entityType: "AppState",
        entityId: "default",
        actorName: session.name ?? "Admin",
        actorRole: session.role,
        summary: `Imported collections: ${Object.entries(counts).filter(([, v]) => v > 0).map(([k]) => k).join(", ")} counts=${JSON.stringify(counts)}`,
      },
    }),
  ]);

  return Response.json({ ok: true, counts });
}
