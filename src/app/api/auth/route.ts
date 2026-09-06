import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { ADMIN } from "@/lib/config";

type StaffRecord = { employeeId: string; username: string; password: string; fullName: string; role: "STAFF" | "SUPERVISOR"; isActive: boolean };
type AuthSession = { role: "ADMIN" | "SUPERVISOR" | "STAFF"; staffId?: string; name: string; loginAt: string; exp: number };

const COOKIE_NAME = "attendance_session";
const MAX_AGE = 8 * 60 * 60;
const secret = () => process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "AttendancePayroll-development-secret");
const secureCookie = (request: Request) => new URL(request.url).protocol === "https:" ? "; Secure" : "";

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(session: AuthSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(value: string | undefined): AuthSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthSession;
    return session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = decode((await cookies()).get(COOKIE_NAME)?.value);
  return Response.json({ session: session ? { role: session.role, staffId: session.staffId, name: session.name, loginAt: session.loginAt } : null });
}

export async function POST(request: Request) {
  const body = await request.json() as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  let session: AuthSession | null = null;
  if (!secret()) return Response.json({ error: "Authentication is not configured" }, { status: 503 });

  if (username === ADMIN.USERNAME && password === ADMIN.PASSWORD) {
    session = { role: "ADMIN", name: "Admin", loginAt: new Date().toISOString(), exp: Math.floor(Date.now() / 1000) + MAX_AGE };
  } else {
    const staff = await prisma.staff.findUnique({ where: { username } });
    if (staff && staff.password === password && staff.isActive) {
      session = { role: staff.role, staffId: staff.employeeId, name: staff.fullName, loginAt: new Date().toISOString(), exp: Math.floor(Date.now() / 1000) + MAX_AGE };
    }
  }

  if (!session) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  const response = Response.json({ ok: true, session: { role: session.role, staffId: session.staffId, name: session.name, loginAt: session.loginAt } });
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=${encode(session)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secureCookie(request)}`);
  return response;
}

export async function DELETE(request: Request) {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(request)}`);
  return response;
}

export { decode, COOKIE_NAME };
