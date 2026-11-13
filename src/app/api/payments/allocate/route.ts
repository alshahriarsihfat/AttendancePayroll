import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionFromRequest } from "@/lib/auth-session";
import { prisma } from "@/server/db";
import { allocateToOutstandingEarnings } from "@/lib/payment-allocation-service";

const AllocateSchema = z.object({
  staffId: z.string().trim().min(1),
  amount: z.number().finite().positive(),
  idempotencyKey: z.string().trim().min(1).max(255),
  periodLabel: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
});

export const runtime = "nodejs";

type AllocationError = Error & { code?: string; details?: unknown };

function safeErrorResponse(error: unknown): Response {
  const err = error as AllocationError;
  const code = typeof err?.code === "string" ? err.code : undefined;

  switch (code) {
    case "INVALID_PAYMENT_AMOUNT":
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    case "INVALID_IDEMPOTENCY_KEY":
    case "PAYMENT_IDEMPOTENCY_KEY_REQUIRED":
      return NextResponse.json({ error: "Invalid idempotency key" }, { status: 400 });
    case "AMBIGUOUS_PAYMENT_TARGET":
      return NextResponse.json({ error: "Invalid allocation request" }, { status: 400 });
    case "ADVANCE_ADJUSTMENT_DEFERRED":
      return NextResponse.json({ error: "Advance adjustment is not supported for salary allocation" }, { status: 400 });
    case "STAFF_NOT_FOUND":
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    case "PAYMENT_NOT_FOUND":
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    case "PAYMENT_STAFF_MISMATCH":
    case "CROSS_STAFF_EARNING":
      return NextResponse.json({ error: "Allocation target does not belong to the requested staff member" }, { status: 403 });
    case "PAYMENT_IDEMPOTENCY_MISMATCH":
      return NextResponse.json({ error: "Idempotency key reuse with a different request is not allowed" }, { status: 409 });
    case "PAYMENT_IDEMPOTENCY_CONFLICT":
    case "ALLOCATION_CONFLICT":
      return NextResponse.json({ error: "A conflicting allocation request is in progress; retry safely with the same idempotency key" }, { status: 409 });
    case "INCOMPLETE_EARNING_INELIGIBLE":
      return NextResponse.json({ error: "No eligible calculated earnings are available for allocation" }, { status: 409 });
    case "EARNING_NOT_FOUND":
      return NextResponse.json({ error: "Allocation target is no longer available" }, { status: 409 });
    case "EARNING_ALLOCATION_CAP_EXCEEDED":
    case "INSUFFICIENT_OUTSTANDING_AFTER_RECHECK":
    case "ALLOCATION_AMOUNT_INCONSISTENCY":
      return NextResponse.json({ error: "Allocation could not be completed safely; please retry" }, { status: 409 });
    case "ALLOCATION_LOCK_UNAVAILABLE":
      return NextResponse.json({ error: "Allocation service is temporarily unavailable" }, { status: 503 });
    default:
      return NextResponse.json({ error: "Unable to process allocation request" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = AllocateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid allocation payload", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const body = parsed.data;
  const paidAt = body.paidAt ? new Date(body.paidAt) : undefined;
  if (paidAt && !Number.isFinite(paidAt.getTime())) {
    return NextResponse.json({ error: "Invalid allocation payload", issues: { paidAt: ["Invalid date"] } }, { status: 400 });
  }

  const authActor = { name: actor.name, role: actor.role };

  try {
    const result = await prisma.$transaction((tx) =>
      allocateToOutstandingEarnings(tx as any, {
        staffId: body.staffId,
        amount: body.amount,
        idempotencyKey: body.idempotencyKey,
        actor: authActor,
        payment: {
          paidBy: authActor.name,
          idempotencyKey: body.idempotencyKey,
          periodLabel: body.periodLabel,
          note: body.note,
          paidAt,
        },
        // Advance adjustment intentionally unsupported for this endpoint (Phase 2A.6/2B.1); service rejects non-zero.
        advanceAdjustment: 0,
      })
    );

    return NextResponse.json(
      {
        ok: true,
        paymentId: result.paymentId,
        staffId: result.staffId,
        requestedAmount: result.requestedAmount,
        actualAllocatedAmount: result.actualAllocatedAmount,
        unfulfilledAmount: result.unfulfilledAmount,
        remainingOutstanding: result.remainingOutstanding,
        allocationStatus: result.allocationStatus,
        allocations: result.allocations,
        skippedDuplicate: result.skippedDuplicate ?? false,
        reason: result.reason ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
