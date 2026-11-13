import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionFromRequest } from "@/lib/auth-session";
import { prisma } from "@/server/db";
import { coordinatedPayWithOptionalDeduction } from "@/lib/coordinated-payment-service";

const BodySchema = z.object({
  staffId: z.string().trim().min(1),
  grossAmount: z.number().finite().positive(),
  deductAdvance: z.boolean().default(false),
  deductionMode: z.enum(["full", "partial"]).optional(),
  deductionAmount: z.number().finite().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(255),
  periodLabel: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((v, ctx) => {
  if (v.deductAdvance) {
    if (v.deductionMode === "partial" && (v.deductionAmount == null || !(v.deductionAmount > 0))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deductionAmount"], message: "Partial deduction requires a positive deductionAmount" });
    }
  } else {
    if (v.deductionAmount != null && v.deductionAmount !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deductionAmount"], message: "deductionAmount must be omitted or 0 when deductAdvance is false" });
    }
  }
});

export const runtime = "nodejs";

function mapError(error: unknown): Response {
  const err = error as any;
  const code = typeof err?.code === "string" ? err.code : undefined;
  switch (code) {
    case "INVALID_PAYMENT_AMOUNT": return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    case "INVALID_DEDUCTION_AMOUNT": return NextResponse.json({ error: "Invalid advance deduction amount" }, { status: 400 });
    case "INVALID_DEDUCTION_MODE": return NextResponse.json({ error: "Invalid deduction mode" }, { status: 400 });
    case "DEDUCTION_NOT_ALLOWED_WHEN_DISABLED": return NextResponse.json({ error: "Advance deduction is disabled" }, { status: 400 });
    case "DEDUCTION_EXCEEDS_GROSS_AMOUNT": return NextResponse.json({ error: "Advance deduction cannot exceed gross amount" }, { status: 400 });
    case "INVALID_IDEMPOTENCY_KEY":
    case "PAYMENT_IDEMPOTENCY_KEY_REQUIRED": return NextResponse.json({ error: "Invalid idempotency key" }, { status: 400 });
    case "STAFF_NOT_FOUND":
    case "STAFF_REQUIRED": return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    case "NO_OUTSTANDING_ADVANCE": return NextResponse.json({ error: "No outstanding advance available for deduction" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE": return NextResponse.json({ error: "Deduction exceeds outstanding advance" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING": return NextResponse.json({ error: "Deduction exceeds eligible unpaid earnings" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_ADVANCE_LOG_OUTSTANDING": return NextResponse.json({ error: "Deduction exceeds selected advance outstanding" }, { status: 409 });
    case "EARNING_NOT_ELIGIBLE":
    case "EARNING_FULLY_PAID_OR_ADJUSTED":
    case "EARNING_ALREADY_SETTLED":
    case "INCOMPLETE_EARNING_INELIGIBLE":
    case "NO_OUTSTANDING_AVAILABLE": return NextResponse.json({ error: "No eligible calculated earnings are available" }, { status: 409 });
    case "PAYMENT_IDEMPOTENCY_MISMATCH":
    case "ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH": return NextResponse.json({ error: "Idempotency key reuse with a different request is not allowed" }, { status: 409 });
    case "PAYMENT_IDEMPOTENCY_CONFLICT":
    case "ADVANCE_ADJUSTMENT_CONFLICT":
    case "ALLOCATION_CONFLICT":
    case "COORDINATED_REQUEST_CONFLICT": return NextResponse.json({ error: "A conflicting request is in progress; retry safely with the same idempotency key" }, { status: 409 });
    case "COORDINATED_REQUEST_INCOMPLETE":
    case "COORDINATED_REQUEST_UNAVAILABLE": return NextResponse.json({ error: "Unable to process payment request" }, { status: 500 });
    case "CROSS_STAFF_EARNING":
    case "CROSS_STAFF_ADVANCE":
    case "PAYMENT_STAFF_MISMATCH": return NextResponse.json({ error: "Target does not belong to the requested staff member" }, { status: 403 });
    case "ADVANCE_LOCK_UNAVAILABLE":
    case "ALLOCATION_LOCK_UNAVAILABLE": return NextResponse.json({ error: "Payment service is temporarily unavailable" }, { status: 503 });
    case "EARNING_ALLOCATION_CAP_EXCEEDED":
    case "INSUFFICIENT_OUTSTANDING_AFTER_RECHECK":
    case "ALLOCATION_AMOUNT_INCONSISTENCY":
    case "DEDUCTION_PLAN_EXHAUSTED": return NextResponse.json({ error: "Payment could not be completed safely; please retry" }, { status: 409 });
    default: return NextResponse.json({ error: "Unable to process payment request" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  }
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 }); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment payload", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  const b = parsed.data;
  const paidAt = b.paidAt ? new Date(b.paidAt) : undefined;
  if (paidAt && !Number.isFinite(paidAt.getTime())) return NextResponse.json({ error: "Invalid payment payload", issues: { paidAt: ["Invalid date"] } }, { status: 400 });
  const authActor = { name: actor.name, role: actor.role };
  try {
    const result = await prisma.$transaction((tx) => coordinatedPayWithOptionalDeduction(tx as any, {
      staffId: b.staffId,
      grossAmount: b.grossAmount,
      deductAdvance: !!b.deductAdvance,
      deductionMode: b.deductionMode,
      deductionAmount: b.deductionAmount,
      idempotencyKey: b.idempotencyKey,
      actor: authActor,
      payment: { paidBy: authActor.name, periodLabel: b.periodLabel, note: b.note, paidAt },
    }));
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

