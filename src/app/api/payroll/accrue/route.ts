import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";
import { accrueCompletedSession } from "@/lib/payroll-accrual-service";

export const runtime = "nodejs";

const Body = z.object({ sessionId: z.string().min(1) });

/** Authorized server-side retry/reconciliation for completed sessions. Idempotent; never trusts client amounts. */
export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });

  try {
    const config = Object.fromEntries((await prisma.config.findMany()).map((r) => [r.key, r.value]));
    const result = await prisma.$transaction((tx) =>
      accrueCompletedSession(tx, {
        sessionId: parsed.data.sessionId,
        actor: { name: actor.name, role: actor.role },
        source: "RETRY",
        config,
      })
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && (error.message === "SESSION_NOT_FOUND" || error.message === "STAFF_NOT_FOUND")) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return dbErrorResponse(error);
  }
}
