import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "attendance_session";
const secret = () => process.env.AUTH_SECRET ?? "AttendancePayroll-development-secret";

async function validSession(value: string | undefined) {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const encoded = new TextEncoder().encode(signature.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(atob(new TextDecoder().decode(encoded)), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(payload));
  if (!valid) return false;
  try {
    const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)))) as { exp?: number };
    return typeof session.exp === "number" && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/login" || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/api/auth")) return NextResponse.next();
  if (await validSession(request.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
