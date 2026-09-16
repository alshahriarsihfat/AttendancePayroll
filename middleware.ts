import { NextResponse, type NextRequest } from "next/server";

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const COOKIE_NAME = "attendance_session";
const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production");
    }
    return "KPSMS-development-secret"; // dev-only fallback, never reaches prod
  }
  return s;
};

// ADMINS ONLY — staff records, counters, config (mirrors manage.staff/manage.config).
const ADMIN_ONLY_PREFIXES = [
  "/api/staff",
  "/api/config",
];

// ADMIN or SUPERVISOR — payments, advances & leave (mirrors pay.staff/manage.leave).
const ELEVATED_PREFIXES = [
  "/api/payments",
  "/api/advance",
  "/api/leave",
];

const ELEVATED_MUTATIONS = [
  "/api/state",
];

function requiredRole(pathname: string, method: string): "ADMIN" | "ELEVATED" | null {
  if (ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "ADMIN";
  if (ELEVATED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "ELEVATED";
  if (ELEVATED_MUTATIONS.some((prefix) => pathname.startsWith(prefix)) && method !== "GET") return "ELEVATED";
  return null;
}

async function validSession(value: string | undefined): Promise<{ role?: string } | null> {
  try {
    if (!value) return null; // ✅ !secret() বাদ দিয়ে পরিষ্কার করা হয়েছে
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signatureBytes = base64UrlDecode(signature);
    const payloadBytes = base64UrlDecode(payload);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes as BufferSource,
      new TextEncoder().encode(payload)
    );
    if (!isValid) return null;

    const session = JSON.parse(new TextDecoder().decode(payloadBytes));
    return typeof session.exp === "number" && session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = await validSession(request.cookies.get(COOKIE_NAME)?.value);

  if (pathname === "/login" || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const needed = requiredRole(pathname, request.method);
  if (needed) {
    if (needed === "ADMIN" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    if (needed === "ELEVATED" && session.role !== "ADMIN" && session.role !== "SUPERVISOR") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};