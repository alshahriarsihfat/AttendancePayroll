import { z } from "zod";
import { prisma } from "@/server/db";

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
  const parsed = CreateLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave payload" }, { status: 400 });
  const requestRow = await prisma.leaveRequest.create({
    data: {
      id: parsed.data.recordId,
      staffId: parsed.data.staffId,
      leaveType: parsed.data.leaveType,
      fromDate: new Date(`${parsed.data.fromDate}T00:00:00`),
      toDate: new Date(`${parsed.data.toDate}T00:00:00`),
      days: parsed.data.days,
      reason: parsed.data.reason || null,
    },
  });
  return Response.json(requestRow, { status: 201 });
}

const DecideLeave = z.object({
  recordId: z.string().min(1),
  status: z.enum(["Approved", "Rejected", "Cancelled"]),
  approvedBy: z.string().min(1),
  comment: z.string().optional(),
});

export async function PATCH(request: Request) {
  const parsed = DecideLeave.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid leave decision" }, { status: 400 });
  const updated = await prisma.leaveRequest.update({
    where: { id: parsed.data.recordId },
    data: {
      status: parsed.data.status,
      approvedBy: parsed.data.approvedBy,
      approvedAt: new Date(),
      comment: parsed.data.comment?.trim() || null,
    },
  });
  return Response.json(updated);
}
