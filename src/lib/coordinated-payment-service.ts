import { createHash } from "node:crypto";
import { payRound } from "./currency";
import {
  allocateToOutstandingEarnings,
  getOutstandingEarnings,
  type AllocateResult,
  type AllocationTx,
} from "./payment-allocation-service";
import {
  createAdvanceAdjustment,
  getEligibleEarningsForStaff,
  getStaffAdvanceState,
  type AdvanceAdjustmentResult,
  type AdvanceTx,
} from "./advance-adjustment-service";

export type CoordinatedTx = AllocationTx &
  AdvanceTx & {
    coordinatedPaymentRequest?: any;
    auditLog: any;
    $executeRaw?: any;
    $executeRawUnsafe?: any;
  };

export type CoordinatedActor = { name: string; role: string } | null;

export type CoordinatedPayInput = {
  staffId: string;
  grossAmount: number;
  deductAdvance: boolean;
  deductionMode?: "full" | "partial";
  deductionAmount?: number;
  idempotencyKey: string;
  actor: CoordinatedActor;
  payment?: { paidBy: string; paidAt?: Date; periodLabel?: string; note?: string };
};

export type CoordinatedAdjustmentRow = {
  adjustmentId: string;
  advanceLogId: string;
  payrollEarningId: string;
  amount: number;
  skippedDuplicate: boolean;
};

export type CoordinatedPayResult = {
  ok: true;
  staffId: string;
  idempotencyKey: string;
  grossRequested: number;
  deductAdvance: boolean;
  deductionRequested: number;
  deductionApplied: number;
  netCashRequested: number;
  paymentId: string | null;
  allocation: {
    requestedAmount: number;
    actualAllocatedAmount: number;
    unfulfilledAmount: number;
    remainingOutstanding: number;
    allocationStatus: AllocateResult["allocationStatus"];
    allocations: AllocateResult["allocations"];
    reason?: string;
  } | null;
  adjustments: CoordinatedAdjustmentRow[];
  remainingAdvance: number;
  remainingEarned: number;
  skippedDuplicate: boolean;
  status: "FULL" | "PARTIAL" | "ADJUSTMENT_ONLY" | "NONE" | "REPLAY";
  reason?: string | null;
};

const EPS = 0.000001;

function cerr(code: string, message?: string, details?: any): Error & { code: string; details?: any } {
  return Object.assign(new Error(message ?? code), { code, details });
}

function isP2002(e: any): boolean {
  return !!e && (e.code === "P2002" || (e?.name === "PrismaClientKnownRequestError" && e?.code === "P2002"));
}

function normalizeKey(key: unknown): string {
  if (typeof key !== "string") throw cerr("INVALID_IDEMPOTENCY_KEY");
  const v = key.trim();
  if (!v) throw cerr("INVALID_IDEMPOTENCY_KEY");
  return v;
}

async function acquireCoordinationLock(tx: CoordinatedTx, idempotencyKey: string): Promise<void> {
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kpsms:coord:idem'), hashtext(${idempotencyKey}))`;
    return;
  }
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "kpsms:coord:idem",
      idempotencyKey,
    );
    return;
  }
  throw cerr("ALLOCATION_LOCK_UNAVAILABLE", "Transaction lock primitive unavailable");
}

async function acquireStaffAdvanceLockEarly(tx: CoordinatedTx, staffId: string): Promise<void> {
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kpsms:advance:staff'), hashtext(${staffId}))`;
    return;
  }
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "kpsms:advance:staff",
      staffId,
    );
    return;
  }
  throw cerr("ADVANCE_LOCK_UNAVAILABLE", "Transaction lock primitive unavailable");
}

function normalizeNote(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

function normalizeIso(v: Date | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as any);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function requestFingerprint(input: {
  staffId: string;
  grossAmount: number;
  deductAdvance: boolean;
  deductionMode: "none" | "full" | "partial";
  deductionAmount: number;
  periodLabel: string | null;
  note: string | null;
  paidAt: string | null;
}): string {
  const norm = {
    v: 1,
    staffId: input.staffId,
    grossAmount: payRound(input.grossAmount),
    deductAdvance: !!input.deductAdvance,
    deductionMode: input.deductionMode,
    deductionAmount: payRound(input.deductionAmount),
    periodLabel: input.periodLabel ?? null,
    note: input.note ?? null,
    paidAt: input.paidAt ?? null,
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

function requireModel(tx: CoordinatedTx) {
  const m = (tx as any).coordinatedPaymentRequest;
  if (!m || typeof m.findUnique !== "function" || typeof m.create !== "function") {
    throw cerr("COORDINATED_REQUEST_UNAVAILABLE", "Coordinated request persistence unavailable");
  }
  return m as {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
}

export async function coordinatedPayWithOptionalDeduction(
  tx: CoordinatedTx,
  input: CoordinatedPayInput,
): Promise<CoordinatedPayResult> {
  const staffId = String(input.staffId || "").trim();
  if (!staffId) throw cerr("STAFF_REQUIRED");
  if (typeof input.grossAmount !== "number" || !Number.isFinite(input.grossAmount) || input.grossAmount <= 0) {
    throw cerr("INVALID_PAYMENT_AMOUNT");
  }
  const grossRequested = payRound(input.grossAmount);
  if (grossRequested <= 0) throw cerr("INVALID_PAYMENT_AMOUNT");
  const idempotencyKey = normalizeKey(input.idempotencyKey);
  const deductAdvance = !!input.deductAdvance;
  const deductionMode: "none" | "full" | "partial" = deductAdvance ? (input.deductionMode || "full") : "none";
  let deductionRequested = 0;
  if (deductAdvance) {
    if (deductionMode === "partial") {
      if (
        typeof input.deductionAmount !== "number" ||
        !Number.isFinite(input.deductionAmount) ||
        input.deductionAmount <= 0
      ) {
        throw cerr("INVALID_DEDUCTION_AMOUNT");
      }
      deductionRequested = payRound(input.deductionAmount);
      if (deductionRequested <= 0) throw cerr("INVALID_DEDUCTION_AMOUNT");
    } else if (deductionMode !== "full") {
      throw cerr("INVALID_DEDUCTION_MODE");
    }
  } else {
    if (input.deductionAmount != null && Number(input.deductionAmount) !== 0) {
      throw cerr("DEDUCTION_NOT_ALLOWED_WHEN_DISABLED");
    }
  }

  const paidBy = String(input.payment?.paidBy || input.actor?.name || "System").trim() || "System";
  const periodLabel = normalizeNote(input.payment?.periodLabel) ?? "Payroll allocation";
  const note = normalizeNote(input.payment?.note);
  const paidAtIso = normalizeIso(input.payment?.paidAt);

  const fingerprint = requestFingerprint({
    staffId,
    grossAmount: grossRequested,
    deductAdvance,
    deductionMode,
    deductionAmount: deductionRequested,
    periodLabel,
    note,
    paidAt: paidAtIso,
  });

  const coordModel = requireModel(tx);

  await acquireCoordinationLock(tx, idempotencyKey);

  const existing = await coordModel.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.staffId !== staffId || existing.requestFingerprint !== fingerprint) {
      throw cerr("PAYMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with a different request is not allowed");
    }
    if (String(existing.status) !== "COMPLETED" || !existing.responseJson) {
      throw cerr("COORDINATED_REQUEST_INCOMPLETE", "Coordinated request is not in a replayable completed state");
    }
    const stored = existing.responseJson as CoordinatedPayResult;
    return { ...stored, skippedDuplicate: true, status: "REPLAY", reason: stored.reason ?? "REPLAY" };
  }

  await acquireStaffAdvanceLockEarly(tx, staffId);

  const staff = await tx.staff.findUnique({ where: { employeeId: staffId }, select: { employeeId: true, fullName: true } });
  if (!staff) throw cerr("STAFF_NOT_FOUND");

  const [advanceState, outstandingEarnings] = await Promise.all([
    getStaffAdvanceState(tx, staffId),
    getOutstandingEarnings(tx, staffId),
  ]);
  const totalOutstandingAdvance = payRound(Math.max(0, Number(advanceState.outstandingAdvance) || 0));
  const totalEligibleUnpaid = payRound(outstandingEarnings.reduce((s, e) => s + (Number(e.outstandingAmount) || 0), 0));

  if (totalEligibleUnpaid <= EPS) {
    const result: CoordinatedPayResult = {
      ok: true,
      staffId,
      idempotencyKey,
      grossRequested,
      deductAdvance,
      deductionRequested,
      deductionApplied: 0,
      netCashRequested: grossRequested,
      paymentId: null,
      allocation: {
        requestedAmount: grossRequested,
        actualAllocatedAmount: 0,
        unfulfilledAmount: grossRequested,
        remainingOutstanding: 0,
        allocationStatus: "NONE",
        allocations: [],
        reason: "NO_OUTSTANDING_AVAILABLE",
      },
      adjustments: [],
      remainingAdvance: totalOutstandingAdvance,
      remainingEarned: 0,
      skippedDuplicate: false,
      status: "NONE",
      reason: "NO_OUTSTANDING_AVAILABLE",
    };
    await tx.auditLog.create({
      data: {
        action: "COORDINATED_SALARY_PAYMENT",
        entityType: "Staff",
        entityId: staffId,
        actorName: input.actor?.name ?? "System",
        actorRole: input.actor?.role ?? "SYSTEM",
        summary: `Coordinated salary payment for ${staff.fullName ?? staffId}: no eligible unpaid earnings (gross ৳${grossRequested.toFixed(2)})`,
        after: { staffId, idempotencyKey, grossRequested, deductionApplied: 0, netCashRequested: grossRequested, actualCashAllocated: 0, paymentId: null, adjustmentCount: 0, remainingAdvance: totalOutstandingAdvance, remainingEarned: 0, status: "NONE" } as any,
      },
    });
    await coordModel.create({
      data: { idempotencyKey, staffId, requestFingerprint: fingerprint, status: "COMPLETED", responseJson: result as any },
    });
    return result;
  }

  let deductionTarget = 0;
  if (deductAdvance) {
    if (totalOutstandingAdvance <= EPS) throw cerr("NO_OUTSTANDING_ADVANCE");
    if (deductionMode === "partial") {
      if (deductionRequested - totalOutstandingAdvance > EPS) throw cerr("ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE");
      if (deductionRequested - totalEligibleUnpaid > EPS) throw cerr("ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING");
      if (deductionRequested - grossRequested > EPS) throw cerr("DEDUCTION_EXCEEDS_GROSS_AMOUNT");
      deductionTarget = payRound(Math.min(deductionRequested, totalOutstandingAdvance, totalEligibleUnpaid, grossRequested));
    } else {
      deductionTarget = payRound(Math.min(totalOutstandingAdvance, totalEligibleUnpaid, grossRequested));
    }
    if (deductionTarget <= EPS) throw cerr("NO_OUTSTANDING_ADVANCE");
  }

  type AdjPlan = { advanceLogId: string; payrollEarningId: string; amount: number };
  const plan: AdjPlan[] = [];
  if (deductionTarget > EPS) {
    const st = await getStaffAdvanceState(tx, staffId);
    const elig = await getEligibleEarningsForStaff(tx, staffId);
    const advances = (st.givenAdvances || [])
      .map((a: any) => ({ id: String(a.id), remaining: payRound(Number(a.outstanding) || 0) }))
      .filter((a) => a.remaining > EPS)
      .sort((a, b) => a.id.localeCompare(b.id));
    const earnings = (elig || [])
      .map((e: any) => ({ id: String(e.id), remaining: payRound(Number(e.remainingEligible) || 0), workDate: String(e.workDate || "") }))
      .filter((e) => e.remaining > EPS)
      .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id.localeCompare(b.id));
    let need = deductionTarget;
    let ai = 0;
    let ei = 0;
    while (need > EPS && ai < advances.length && ei < earnings.length) {
      const a = advances[ai];
      const e = earnings[ei];
      if (a.remaining <= EPS) { ai++; continue; }
      if (e.remaining <= EPS) { ei++; continue; }
      const take = payRound(Math.min(need, a.remaining, e.remaining));
      if (take <= EPS) break;
      plan.push({ advanceLogId: a.id, payrollEarningId: e.id, amount: take });
      a.remaining = payRound(a.remaining - take);
      e.remaining = payRound(e.remaining - take);
      need = payRound(need - take);
      if (a.remaining <= EPS) ai++;
      if (e.remaining <= EPS) ei++;
    }
    if (need > EPS) throw cerr("ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING", "Unable to fully apply deduction within eligible bounds");
  }

  const adjustments: CoordinatedAdjustmentRow[] = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const adjKey = `${idempotencyKey}:adj:${i}:${p.advanceLogId}:${p.payrollEarningId}`;
    const res: AdvanceAdjustmentResult = await createAdvanceAdjustment(tx, {
      staffId,
      advanceLogId: p.advanceLogId,
      payrollEarningId: p.payrollEarningId,
      amount: p.amount,
      idempotencyKey: adjKey,
      note: note ? `Payment deduction: ${note}` : "Deducted from salary payment",
      actor: input.actor,
    });
    adjustments.push({
      adjustmentId: res.adjustmentId,
      advanceLogId: p.advanceLogId,
      payrollEarningId: p.payrollEarningId,
      amount: payRound(res.amount),
      skippedDuplicate: !!res.skippedDuplicate,
    });
  }

  const deductionApplied = payRound(adjustments.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  if (deductionApplied - deductionTarget > EPS || deductionTarget - deductionApplied > EPS) {
    throw cerr("ALLOCATION_AMOUNT_INCONSISTENCY", "Deduction application mismatch");
  }

  const netCashRequested = payRound(Math.max(0, grossRequested - deductionApplied));

  let allocation: CoordinatedPayResult["allocation"] = null;
  let paymentId: string | null = null;
  let status: CoordinatedPayResult["status"] = deductionApplied > EPS ? "ADJUSTMENT_ONLY" : "NONE";

  if (netCashRequested > EPS) {
    const allocRes: AllocateResult = await allocateToOutstandingEarnings(tx, {
      staffId,
      amount: netCashRequested,
      actor: input.actor,
      idempotencyKey,
      payment: {
        paidBy,
        idempotencyKey,
        periodLabel,
        note: note ?? undefined,
        paidAt: paidAtIso ? new Date(paidAtIso) : undefined,
      },
    });
    paymentId = allocRes.paymentId;
    allocation = {
      requestedAmount: allocRes.requestedAmount,
      actualAllocatedAmount: allocRes.actualAllocatedAmount,
      unfulfilledAmount: allocRes.unfulfilledAmount,
      remainingOutstanding: allocRes.remainingOutstanding,
      allocationStatus: allocRes.allocationStatus,
      allocations: allocRes.allocations,
      reason: allocRes.reason,
    };
    if (allocRes.allocationStatus === "REPLAY") status = "REPLAY";
    else if (allocRes.allocationStatus === "PARTIAL") status = "PARTIAL";
    else if (allocRes.allocationStatus === "FULL") status = "FULL";
    else status = deductionApplied > EPS ? "ADJUSTMENT_ONLY" : "NONE";
  } else {
    const afterEarn = await getOutstandingEarnings(tx, staffId);
    const remainingOutstanding = payRound(afterEarn.reduce((s, e) => s + (Number(e.outstandingAmount) || 0), 0));
    allocation = {
      requestedAmount: 0,
      actualAllocatedAmount: 0,
      unfulfilledAmount: 0,
      remainingOutstanding,
      allocationStatus: "NONE",
      allocations: [],
      reason: deductionApplied > EPS ? "ADJUSTMENT_ONLY_NO_CASH" : "NO_CASH",
    };
    status = deductionApplied > EPS ? "ADJUSTMENT_ONLY" : "NONE";
  }

  const [stateAfter, earnAfter] = await Promise.all([getStaffAdvanceState(tx, staffId), getOutstandingEarnings(tx, staffId)]);
  const remainingAdvance = payRound(Math.max(0, Number(stateAfter.outstandingAdvance) || 0));
  const remainingEarned = payRound(earnAfter.reduce((s, e) => s + (Number(e.outstandingAmount) || 0), 0));

  const result: CoordinatedPayResult = {
    ok: true,
    staffId,
    idempotencyKey,
    grossRequested,
    deductAdvance,
    deductionRequested: deductAdvance ? (deductionMode === "partial" ? deductionRequested : deductionApplied) : 0,
    deductionApplied,
    netCashRequested,
    paymentId,
    allocation,
    adjustments,
    remainingAdvance,
    remainingEarned,
    skippedDuplicate: false,
    status,
    reason: allocation?.reason ?? null,
  };

  await tx.auditLog.create({
    data: {
      action: "COORDINATED_SALARY_PAYMENT",
      entityType: "Staff",
      entityId: staffId,
      actorName: input.actor?.name ?? "System",
      actorRole: input.actor?.role ?? "SYSTEM",
      summary: `Coordinated salary payment for ${staff.fullName ?? staffId}: gross ৳${grossRequested.toFixed(2)}, advance deducted ৳${deductionApplied.toFixed(2)}, net cash ৳${(allocation?.actualAllocatedAmount ?? 0).toFixed(2)}`,
      after: {
        staffId,
        idempotencyKey,
        grossRequested,
        deductionApplied,
        netCashRequested,
        actualCashAllocated: allocation?.actualAllocatedAmount ?? 0,
        paymentId,
        adjustmentCount: adjustments.length,
        remainingAdvance,
        remainingEarned,
        status,
      } as any,
    },
  });

  try {
    await coordModel.create({
      data: {
        idempotencyKey,
        staffId,
        requestFingerprint: fingerprint,
        status: "COMPLETED",
        responseJson: result as any,
      },
    });
  } catch (e: any) {
    if (isP2002(e)) {
      throw cerr(
        "COORDINATED_REQUEST_CONFLICT",
        "A conflicting coordinated request is in progress; retry safely with the same idempotency key",
        { idempotencyKey },
      );
    }
    throw e;
  }

  return result;
}
