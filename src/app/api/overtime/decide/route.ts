import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

/**
 * Legacy overtime decision endpoint.
 * Supervisor-activated Extra Time no longer uses an Approved/Unapproved/Pending/Rejected workflow or gate.
 * Kept for backward compatibility: no-op (does not alter authoritative OT state) and returns 410 Gone with guidance.
 */
export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });

  try { await request.json(); } catch { /* ignore body */ }
  return Response.json(
    { error: "Overtime approval workflow is disabled. Supervisor activation authorizes Extra Time (OT runs activation→manual clock-out) and is payable without approval." },
    { status: 410 }
  );
}

