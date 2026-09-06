import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "attendance_session";
const secret = () => process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "AttendancePayroll-development-secret");

async function validSession(value: string | undefined): Promise<{ role?: string } | null> {
  try {
    if (!value || !secret()) return null;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signatureBytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)))) as { exp?: number; role?: string };
    return typeof session.exp === "number" && session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/login" || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/api/auth")) return NextResponse.next();
  const session = await validSession(request.cookies.get(COOKIE_NAME)?.value);
  if (session) {
    if (pathname.startsWith("/api/staff") || pathname.startsWith("/api/payments") || pathname.startsWith("/api/advance") || (pathname.startsWith("/api/state") && request.method !== "GET")) {
      if (session.role !== "ADMIN" && session.role !== "SUPERVISOR") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
