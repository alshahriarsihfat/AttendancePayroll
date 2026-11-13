import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { dateKeyInZone } from "@/lib/dates";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dhakaDate = (value: string) => new Date(`${value}T00:00:00+06:00`);

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") {
    return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const parsed = GenerateSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });

  const fromDate = dhakaDate(parsed.data.from);
  const toDate = dhakaDate(parsed.data.to);
  if (fromDate > toDate) return Response.json({ error: "from must be on or before to" }, { status: 400 });
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  if (days > 31) return Response.json({ error: "Date range too large" }, { status: 400 });

  try {
    const sessions = await prisma.timeSession.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      select: { staffId: true, date: true },
    });
    const leaves = await prisma.leaveRequest.findMany({
      where: { status: "Approved", fromDate: { lte: toDate }, toDate: { gte: fromDate } },
      select: { staffId: true, fromDate: true, toDate: true },
    });

    const existing = await prisma.dailyAttendance.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      select: { staffId: true, date: true, finalized: true },
    });
    const existingMap = new Map(existing.map((e) => [`${e.staffId}|${dateKeyInZone(e.date)}`, e]));

    const conflicts: { staffId: string; date: string }[] = [];
    let created = 0;
    let skipped = 0;
    let preserved = 0;

    // Build candidate (staffId,date) set from evidence
    const candidates = new Map<string, "Present" | "ApprovedLeave">();
    for (const s of sessions) {
      const key = `${s.staffId}|${dateKeyInZone(s.date)}`;
      candidates.set(key, "Present");
    }
    for (const l of leaves) {
      const cur = new Date(l.fromDate);
      const end = new Date(l.toDate);
      while (cur <= end) {
        const keyDate = dateKeyInZone(cur);
        const dhakaCur = dhakaDate(keyDate);
        if (dhakaCur >= fromDate && dhakaCur <= toDate) {
          const key = `${l.staffId}|${keyDate}`;
          if (!candidates.has(key)) candidates.set(key, "ApprovedLeave");
          else conflicts.push({ staffId: l.staffId, date: keyDate });
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const [key, status] of candidates) {
        const [staffId, dateStr] = key.split("|");
        const date = dhakaDate(dateStr);
        const ex = existingMap.get(key);
        if (ex) {
          if (ex.finalized) preserved++;
          else skipped++;
          continue;
        }
        try {
          await tx.dailyAttendance.create({
            data: { staffId, date, status, systemGenerated: true },
          });
          created++;
        } catch (e: any) {
          // unique constraint conflict -> skip
          if (e?.code === "P2002") skipped++;
          else throw e;
        }
      }
      await tx.auditLog.create({
        data: {
          action: "ATTENDANCE_GENERATE", entityType: "DailyAttendance", entityId: `${parsed.data.from}..${parsed.data.to}`,
          actorName: actor.name, actorRole: actor.role,
          summary: `Generated attendance ${parsed.data.from}..${parsed.data.to}: created=${created} skipped=${skipped} preserved=${preserved} conflicts=${conflicts.length}`,
          before: undefined, after: { created, skipped, preserved, conflicts }, reason: null,
        },
      });
    });

    return Response.json({ created, skipped, preserved, conflicts });
  } catch (error) {
    return dbErrorResponse(error);
  }
}
