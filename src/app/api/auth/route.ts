import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { COOKIE_NAME, authSecret, decodeSession, encodeSession, type AuthSession } from "@/lib/auth-session";
import { verifyPassword } from "@/lib/password";

type StaffRecord = { employeeId: string; username: string; password: string; fullName: string; role: "STAFF" | "SUPERVISOR"; isActive: boolean };
const MAX_AGE = 8 * 60 * 60;
const secureCookie = (request: Request) => new URL(request.url).protocol === "https:" ? "; Secure" : "";

function adminUsername(): string {
  const u = process.env.ADMIN_USERNAME;
  if (!u && process.env.NODE_ENV === "production") throw new Error("ADMIN_USERNAME is required in production");
  return u ?? "admin";
}

function adminPasswordHash(): string {
  const h = process.env.ADMIN_PASSWORD_HASH;
  if (!h && process.env.NODE_ENV === "production") throw new Error("ADMIN_PASSWORD_HASH is required in production");
  return h ?? "";
}

export async function GET() {
  const session = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  return Response.json({ session: session ? { role: session.role, staffId: session.staffId, name: session.name, loginAt: session.loginAt } : null });
}

export async function POST(request: Request) {
  const body = await request.json() as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  let session: AuthSession | null = null;
  if (!authSecret()) return Response.json({ error: "Authentication is not configured" }, { status: 503 });

  if (username === adminUsername() && verifyPassword(password, adminPasswordHash())) {
    session = { role: "ADMIN", name: "Admin", loginAt: new Date().toISOString(), exp: Math.floor(Date.now() / 1000) + MAX_AGE };
  } else {
    const staff = await prisma.staff.findUnique({ where: { username } });
    if (staff && staff.isActive && verifyPassword(password, staff.password)) {
      session = { role: staff.role, staffId: staff.employeeId, name: staff.fullName, loginAt: new Date().toISOString(), exp: Math.floor(Date.now() / 1000) + MAX_AGE };
    }
  }

  if (!session) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  const response = Response.json({ ok: true, session: { role: session.role, staffId: session.staffId, name: session.name, loginAt: session.loginAt } });
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=${encodeSession(session)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secureCookie(request)}`);
  return response;
}

export async function DELETE(request: Request) {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(request)}`);
  return response;
}

export { decodeSession as decode, COOKIE_NAME };
