import { z } from "zod";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// M4 FIX: Approval API
// ---------------------------------------------------------------------------
// Previously the approval system lived ONLY in frontend state:
//   - new discrepancy approvals were added to AppContext state but never
//     persisted to the DB ({model: ApprovalRequest} rows)
//   - resolveApproval only mapped over local state — a refresh lost both the
//     request and its decision
// This route persists both creation and resolution of ApprovalRequest rows.
// ---------------------------------------------------------------------------

const CreateApproval = z.object({
  id: z.string().min(1),
  staffId: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.string().min(1), // late | early_exit | break_overrun
  deltaMin: z.number(),
  date: z.string().min(10), // YYYY-MM-DD (Dhaka)
});

export async function POST(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = CreateApproval.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid approval payload" }, { status: 400 });
  try {
    const approval = await prisma.approvalRequest.create({
      data: {
        id: parsed.data.id,
        staffId: parsed.data.staffId,
        sessionId: parsed.data.sessionId,
        type: parsed.data.type,
        deltaMin: parsed.data.deltaMin,
        date: new Date(`${parsed.data.date}T00:00:00+06:00`),
        status: "pending",
      },
    });
    return Response.json(approval, { status: 201 });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

const ResolveApproval = z.object({
  id: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
  resolvedBy: z.string().min(1),
  managerNote: z.string().optional(),
});

export async function PATCH(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = ResolveApproval.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid approval decision" }, { status: 400 });
  try {
    const updated = await prisma.approvalRequest.update({
      where: { id: parsed.data.id },
      data: {
        status: parsed.data.status,
        resolvedBy: parsed.data.resolvedBy,
        resolvedAt: new Date(),
        managerNote: parsed.data.managerNote?.trim() || null,
      },
    });
    return Response.json(updated);
  } catch (error) {
    return dbErrorResponse(error);
  }
}