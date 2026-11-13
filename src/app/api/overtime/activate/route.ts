import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const sessionId = (raw as any)?.sessionId;
  if (!sessionId || typeof sessionId !== "string") return Response.json({ error: "sessionId required" }, { status: 400 });

  try {
    const session = await prisma.timeSession.findUnique({ where: { id: sessionId } });
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
    if (session.completed || session.timeOut) return Response.json({ error: "Session already closed" }, { status: 409 });
    if (session.shiftEndMin == null || !session.shiftEndTime) {
      return Response.json({ error: "Missing shift snapshot" }, { status: 422 });
    }

    const shiftEndMs = session.date.getTime() + session.shiftEndMin * 60000;
    const now = Date.now();
    // Supervisor-controlled Extra Time available only after scheduled Duty End. Activation suspends normal auto-close.
    if (now < shiftEndMs) return Response.json({ error: "Overtime activation not yet available" }, { status: 422 });

    // Conditional, concurrency-safe activation:
    // - requires open session (not auto-closed/clocked-out concurrently)
    // - prevents duplicate activation
    // - never reopens already-closed sessions
    // overtimeStatus kept as "Pending" enum value for schema compatibility; approval workflow is not required and OT is authorized by supervisor activation.
    const activatedAt = new Date(now);
    const updated = await prisma.timeSession.updateMany({
      where: { id: sessionId, overtimeActivatedAt: null, timeOut: null, completed: false },
      data: { overtimeActivatedAt: activatedAt, overtimeStatus: "Pending" },
    });
    if (updated.count !== 1) {
      const fresh = await prisma.timeSession.findUnique({ where: { id: sessionId } });
      if (!fresh) return Response.json({ error: "Session not found" }, { status: 404 });
      if (fresh.completed || fresh.timeOut) return Response.json({ error: "Session already closed" }, { status: 409 });
      if (fresh.overtimeActivatedAt) return Response.json({ error: "Overtime already activated" }, { status: 409 });
      return Response.json({ error: "Overtime activation could not be applied" }, { status: 409 });
    }
    const row = await prisma.timeSession.findUnique({ where: { id: sessionId } });
    await prisma.auditLog.create({
      data: {
        action: "OVERTIME_ACTIVATED", entityType: "TimeSession", entityId: sessionId,
        actorName: actor.name, actorRole: actor.role,
        summary: `${actor.name} activated overtime for session ${sessionId} (OT starts at activation timestamp)`,
        after: { overtimeActivatedAt: activatedAt.toISOString(), overtimeStatus: "Pending", authorizedBySupervisor: true },
      },
    });
    return Response.json(row);
  } catch (error) { return dbErrorResponse(error); }
}
