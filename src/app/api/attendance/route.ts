import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";
import { dateKeyInZone } from "@/lib/dates";

export const runtime = "nodejs";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  staffId: z.string().optional(),
  status: z.enum(["Present", "ApprovedLeave", "UnauthorizedAbsence", "PendingReview"]).optional(),
});

const PutSchema = z.object({
  staffId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["Present", "ApprovedLeave", "UnauthorizedAbsence", "PendingReview"]),
  finalized: z.boolean(),
  reason: z.string().optional(),
  expectedUpdatedAt: z.string().min(1),
});

const dhakaDate = (value: string) => new Date(`${value}T00:00:00+06:00`);

export async function GET(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });

  try {
    const where: any = {};
    if (parsed.data.from || parsed.data.to) {
      where.date = {};
      if (parsed.data.from) where.date.gte = dhakaDate(parsed.data.from);
      if (parsed.data.to) where.date.lte = dhakaDate(parsed.data.to);
    }
    if (parsed.data.staffId) where.staffId = parsed.data.staffId;
    if (parsed.data.status) where.status = parsed.data.status;
    const rows = await prisma.dailyAttendance.findMany({ where, orderBy: [{ date: "asc" }, { staffId: "asc" }] });
    return Response.json({ records: rows });
  } catch (error) { return dbErrorResponse(error); }
}

export async function PUT(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });

  const { staffId, date, status, finalized } = parsed.data;
  const reason = parsed.data.reason?.trim();
  const dhaka = new Date(`${date}T00:00:00Z`);

  // Finalization/correction validation
  if (status === "PendingReview" && finalized) {
    return Response.json({ error: "PendingReview cannot be finalized" }, { status: 400 });
  }
  if (finalized && (!reason || reason.length < 3)) {
    // finalization of a non-pending record requires reason only for correction? We require reason for any finalized change.
  }
  // Require reason for corrections (changing existing finalized record). Determine existing first.
  try {
    const existing = await prisma.dailyAttendance.findUnique({ where: { staffId_date: { staffId, date: dhaka } } });
    if (!existing) return Response.json({ error: "Attendance record not found" }, { status: 404 });

    if (existing.finalized) {
      return Response.json({ error: "Finalized attendance records cannot be modified." }, { status: 409 });
    }

    const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt);

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.dailyAttendance.updateMany({
        where: { id: existing.id, updatedAt: expectedUpdatedAt },
        data: {
          status,
          finalized,
          finalizedBy: finalized ? actor.name : null,
          finalizedAt: finalized ? new Date() : null,
        },
      });
      if (changed.count !== 1) throw new Error("STALE_UPDATE");
      const row = await tx.dailyAttendance.findUniqueOrThrow({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          action: finalized ? "ATTENDANCE_FINALIZED" : "ATTENDANCE_UPDATED",
          entityType: "DailyAttendance", entityId: existing.id,
          actorName: actor.name, actorRole: actor.role,
          summary: `${actor.name} ${finalized ? "finalized" : "updated"} attendance for ${staffId} on ${date} to ${status}`,
          before: { status: existing.status, finalized: existing.finalized },
          after: { status, finalized },
          reason: reason || null,
        },
      });
      return row;
    });
    return Response.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_UPDATE") {
      return Response.json({ error: "Record changed by another user. Reload and try again." }, { status: 409 });
    }
    return dbErrorResponse(error);
  }
}
