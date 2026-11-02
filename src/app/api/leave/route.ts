import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

const CreateLeave = z.object({
  recordId: z.string().min(1),
  staffId: z.string().min(1),
  leaveType: z.string().trim().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().positive(),
  reason: z.string().optional(),
});
const dhakaDate = (value: string) => new Date(`${value}T00:00:00+06:00`);
const dhakaYear = (date: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", year: "numeric" }).format(date));

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = CreateLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave payload" }, { status: 400 });
  if (actor.role === "STAFF" && actor.staffId !== parsed.data.staffId) {
    return Response.json({ error: "You can only submit leave for yourself" }, { status: 403 });
  }
  if (dhakaDate(parsed.data.fromDate) > dhakaDate(parsed.data.toDate)) {
    return Response.json({ error: "fromDate must be on or before toDate" }, { status: 400 });
  }
  try {
    const staff = await prisma.staff.findUnique({ where: { employeeId: parsed.data.staffId }, select: { employeeId: true, fullName: true } });
    if (!staff) return Response.json({ error: "Staff not found" }, { status: 404 });
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          id: parsed.data.recordId, staffId: parsed.data.staffId, leaveType: parsed.data.leaveType,
          fromDate: dhakaDate(parsed.data.fromDate), toDate: dhakaDate(parsed.data.toDate),
          days: parsed.data.days, reason: parsed.data.reason?.trim() || null, status: "Pending",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "LEAVE_SUBMITTED", entityType: "LeaveRequest", entityId: created.id,
          actorName: actor.name, actorRole: actor.role,
          summary: `${actor.name} submitted leave for ${staff.fullName}`,
          managedBy: actor.staffId && actor.staffId !== parsed.data.staffId ? actor.name : null,
        },
      });
      return created;
    });
    return Response.json(row, { status: 201 });
  } catch (error) { return dbErrorResponse(error); }
}

const DecideLeave = z.object({
  recordId: z.string().min(1),
  status: z.enum(["Approved", "Rejected", "Cancelled"]),
  comment: z.string().optional(),
});

export async function PATCH(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = DecideLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave decision" }, { status: 400 });
  try {
    const existing = await prisma.leaveRequest.findUnique({ where: { id: parsed.data.recordId } });
    if (!existing) return Response.json({ error: "Leave request not found" }, { status: 404 });
    const selfCancel = actor.role === "STAFF" && actor.staffId === existing.staffId && parsed.data.status === "Cancelled";
    if (actor.role === "STAFF" && !selfCancel) return Response.json({ error: "Staff can only cancel their own pending leave" }, { status: 403 });
    if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR" && !selfCancel) return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    if (!selfCancel && parsed.data.status === "Cancelled") return Response.json({ error: "Only the requesting staff member can cancel a leave request" }, { status: 403 });
    if (existing.status !== "Pending") return Response.json({ error: "Only pending leave requests can be changed" }, { status: 409 });

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.leaveRequest.updateMany({
        where: { id: existing.id, status: "Pending" },
        data: { status: parsed.data.status, approvedBy: selfCancel ? null : actor.name, approvedAt: new Date(), comment: parsed.data.comment?.trim() || null },
      });
      if (changed.count !== 1) throw new Error("LEAVE_ALREADY_DECIDED");

      if (parsed.data.status === "Approved" && existing.days > 0) {
        const year = dhakaYear(existing.fromDate);
        await tx.leaveBalance.upsert({
          where: { staffId_leaveType_year: { staffId: existing.staffId, leaveType: existing.leaveType, year } },
          create: { staffId: existing.staffId, leaveType: existing.leaveType, entitledDays: 0, usedDays: existing.days, year },
          update: { usedDays: { increment: existing.days } },
        });
      }
      await tx.auditLog.create({
        data: {
          action: selfCancel ? "LEAVE_CANCELLED" : "LEAVE_DECIDED",
          entityType: "LeaveRequest", entityId: existing.id,
          actorName: actor.name, actorRole: actor.role,
          summary: `${actor.name} set leave request to ${parsed.data.status}`,
        },
      });
      return tx.leaveRequest.findUniqueOrThrow({ where: { id: existing.id } });
    });
    return Response.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "LEAVE_ALREADY_DECIDED") return Response.json({ error: "Leave request was already updated" }, { status: 409 });
    return dbErrorResponse(error);
  }
}
