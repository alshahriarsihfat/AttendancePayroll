import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

const CreateLeave = z.object({
  recordId: z.string().min(1),
  staffId: z.string().min(1),
  leaveType: z.string().min(1),
  fromDate: z.string().min(10),
  toDate: z.string().min(10),
  days: z.number().nonnegative(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = CreateLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave payload" }, { status: 400 });
  try {
    const requestRow = await prisma.leaveRequest.create({
      data: {
        id: parsed.data.recordId,
        staffId: parsed.data.staffId,
        leaveType: parsed.data.leaveType,
        // Store as Dhaka midnight (+06:00) — identical calendar day whether the
        // server runs in UTC (Vercel) or in Bangladesh (local dev).
        fromDate: new Date(`${parsed.data.fromDate}T00:00:00+06:00`),
        toDate: new Date(`${parsed.data.toDate}T00:00:00+06:00`),
        days: parsed.data.days,
        reason: parsed.data.reason || null,
      },
    });
    return Response.json(requestRow, { status: 201 });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

const DecideLeave = z.object({
  recordId: z.string().min(1),
  status: z.enum(["Approved", "Rejected", "Cancelled"]),
  approvedBy: z.string().min(1),
  comment: z.string().optional(),
});

export async function PATCH(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = DecideLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave decision" }, { status: 400 });
  try {
    const updated = await prisma.leaveRequest.update({
      where: { id: parsed.data.recordId },
      data: {
        status: parsed.data.status,
        approvedBy: parsed.data.approvedBy,
        approvedAt: new Date(),
        comment: parsed.data.comment?.trim() || null,
      },
    });

    // -----------------------------------------------------------------------
    // M5 FIX: Leave balance decrement (DB-persisted)
    // -----------------------------------------------------------------------
    // When a leave request is Approved, the used days for that staff member's
    // leave balance must be incremented in the DATABASE — not just in the
    // frontend's ephemeral state (which was lost on refresh).
    if (parsed.data.status === "Approved" && updated.days > 0) {
      const year = updated.fromDate.getFullYear();
      const balance = await prisma.leaveBalance.findUnique({
        where: {
          staffId_leaveType_year: {
            staffId: updated.staffId,
            leaveType: updated.leaveType,
            year,
          },
        },
      });

      if (balance) {
        // Increment used days by the approved leave duration
        await prisma.leaveBalance.update({
          where: { id: balance.id },
          data: { usedDays: balance.usedDays + updated.days },
        });
      } else {
        // No balance row exists yet — create one so the decrement is recorded
        await prisma.leaveBalance.create({
          data: {
            staffId: updated.staffId,
            leaveType: updated.leaveType,
            entitledDays: 0,
            usedDays: updated.days,
            year,
          },
        });
      }
    }

    return Response.json(updated);
  } catch (error) {
    return dbErrorResponse(error);
  }
}