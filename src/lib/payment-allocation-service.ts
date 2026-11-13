import { Prisma } from "@prisma/client";
import { payRound } from "./currency";

export type AllocationActor = { name: string; role: string } | null;

export type AllocationTx = {
  staff: any;
  payment: any;
  payrollEarning: any;
  paymentAllocation: any;
  advanceLog: any;
  advanceAdjustment?: any;
  auditLog: any;
  $executeRaw?: any;
  $executeRawUnsafe?: any;
  $queryRaw?: any;
};

export type NewPaymentInput = {
  paidBy: string;
  paidAt?: Date;
  periodLabel?: string;
  note?: string;
  /** Required for creating a new non-legacy allocation Payment (request-level idempotency). */
  idempotencyKey: string;
};

export type AllocateInput = {
  staffId: string;
  amount: number;
  actor: AllocationActor;
  /** Allocate using an existing Payment.id (no Payment row created). */
  paymentId?: string;
  /** Create a new non-legacy allocation Payment (sessionId=null). Requires payment.idempotencyKey. Mutually exclusive with paymentId. */
  payment?: NewPaymentInput;
  /**
   * Allocation-level idempotency/replay key. Required when creating a new Payment (same as payment.idempotencyKey).
   * For existing-payment allocations, optional but recommended for safe replay/dedupe.
   */
  idempotencyKey?: string;
  /** Phase 2A.4: explicit advance adjustment remains deferred/rejected. Must be 0/undefined. */
  advanceAdjustment?: number;
};

export type OutstandingEarning = {
  id: string;
  sessionId: string;
  staffId: string;
  netEarning: number;
  allocatedAmount: number;
  outstandingAmount: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  calculatedAt: Date | null;
  calculationStatus: string;
  legacySettled: boolean;
};

export type AllocationRow = { id: string; payrollEarningId: string; amount: number; idempotencyKey?: string | null };

export type AllocateResult = {
  ok: true;
  paymentId: string | null;
  staffId: string;
  requestedAmount: number;
  actualAllocatedAmount: number;
  /** Compatibility alias for actualAllocatedAmount. */
  allocatedTotal: number;
  unfulfilledAmount: number;
  remainingOutstanding: number;
  allocations: AllocationRow[];
  skippedDuplicate?: boolean;
  /** Explicit allocation outcome. */
  allocationStatus: "FULL" | "PARTIAL" | "NONE" | "REPLAY";
  reason?: string;
  /** Compatibility alias for remainingOutstanding. */
  outstandingAfterTotal?: number;
};

const ELIGIBLE_STATUS = "CALCULATED";

function err(code: string, message?: string, details?: any): Error & { code: string; details?: any } {
  return Object.assign(new Error(message ?? code), { code, details });
}

function isP2002(e: any): boolean {
  return !!e && (e.code === "P2002" || (e?.name === "PrismaClientKnownRequestError" && e?.code === "P2002"));
}

function assertPositiveAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) throw err("INVALID_PAYMENT_AMOUNT");
}

function normalizeKey(key: unknown, code = "INVALID_IDEMPOTENCY_KEY"): string {
  if (typeof key !== "string") throw err(code);
  const v = key.trim();
  if (!v) throw err(code);
  return v;
}

function stableSort(a: OutstandingEarning, b: OutstandingEarning): number {
  const at = a.periodStart?.getTime() ?? a.calculatedAt?.getTime() ?? 0;
  const bt = b.periodStart?.getTime() ?? b.calculatedAt?.getTime() ?? 0;
  if (at !== bt) return at - bt; // oldest unpaid first
  return a.id.localeCompare(b.id); // deterministic tie-breaker
}

function allocKey(base: string, earningId: string): string {
  return `${base}:${earningId}`;
}

async function acquireStaffAllocationLock(tx: AllocationTx, staffId: string): Promise<void> {
  // Advisory transaction-scoped lock serializes all allocation transactions for the same staff member
  // (covers multiple eligible earnings). Deterministic scope: fixed namespace + staffId key.
  // Lock is acquired before reading authoritative outstanding balances; released automatically at tx end.
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('kpsms:alloc:staff'), hashtext(${staffId}))`);
    return;
  }
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", "kpsms:alloc:staff", staffId);
    return;
  }
  throw err("ALLOCATION_LOCK_UNAVAILABLE", "Transaction lock primitive unavailable");
}

/**
 * Server-authoritative outstanding earnings for a staff member.
 * - CALCULATED only; INCOMPLETE excluded.
 * - Outstanding = immutable netEarning - sum(valid allocations), floored at 0.
 * - Legacy compatibility: if a legacy Payment exists with sessionId == earning.sessionId, treat as fully settled
 *   (prevents double counting) and exclude from allocatable outstanding.
 * - No authoritative paidAmount/remainingAmount stored on earning.
 * NOTE: For financial decisions call only after acquiring the staff allocation lock and within the same tx.
 */
export async function getOutstandingEarnings(tx: AllocationTx, staffId: string): Promise<OutstandingEarning[]> {
  const earnings = await tx.payrollEarning.findMany({
    where: { staffId, calculationStatus: ELIGIBLE_STATUS },
    select: {
      id: true, sessionId: true, staffId: true, netEarning: true,
      periodStart: true, periodEnd: true, calculatedAt: true, calculationStatus: true,
    },
  });
  if (earnings.length === 0) return [];

  const ids = earnings.map((e: any) => e.id);
  const sessionIds = earnings.map((e: any) => e.sessionId).filter(Boolean);

  const [allocSums, adjSums, legacyPayments] = await Promise.all([
    tx.paymentAllocation.groupBy
      ? tx.paymentAllocation.groupBy({
          by: ["payrollEarningId"],
          where: { payrollEarningId: { in: ids }, staffId },
          _sum: { amount: true },
        })
      : (async () => {
          const rows = await tx.paymentAllocation.findMany({ where: { payrollEarningId: { in: ids }, staffId }, select: { payrollEarningId: true, amount: true } });
          const map = new Map<string, number>();
          for (const r of rows) map.set(r.payrollEarningId, (map.get(r.payrollEarningId) ?? 0) + (Number(r.amount) || 0));
          return Array.from(map.entries()).map(([payrollEarningId, amount]) => ({ payrollEarningId, _sum: { amount } }));
        })(),
    tx.advanceAdjustment?.groupBy
      ? tx.advanceAdjustment.groupBy({
          by: ["payrollEarningId"],
          where: { payrollEarningId: { in: ids }, staffId },
          _sum: { amount: true },
        })
      : (async () => {
          if (!tx.advanceAdjustment?.findMany) return [] as any[];
          const rows = await tx.advanceAdjustment.findMany({ where: { payrollEarningId: { in: ids }, staffId }, select: { payrollEarningId: true, amount: true } });
          const map = new Map<string, number>();
          for (const r of rows) map.set(r.payrollEarningId, (map.get(r.payrollEarningId) ?? 0) + (Number(r.amount) || 0));
          return Array.from(map.entries()).map(([payrollEarningId, amount]) => ({ payrollEarningId, _sum: { amount } }));
        })(),
    tx.payment.findMany({
      where: { staffId, sessionId: { in: sessionIds } },
      select: { sessionId: true, id: true },
    }),
  ]);

  const allocByEarning = new Map<string, number>();
  for (const row of allocSums as any[]) allocByEarning.set(row.payrollEarningId, payRound(Number(row._sum?.amount ?? 0)));
  const adjByEarning = new Map<string, number>();
  for (const row of adjSums as any[]) adjByEarning.set(row.payrollEarningId, payRound(Number(row._sum?.amount ?? 0)));
  const legacyBySession = new Set((legacyPayments as any[]).map((p) => p.sessionId).filter(Boolean));

  const rows: OutstandingEarning[] = earnings.map((e: any) => {
    const legacySettled = legacyBySession.has(e.sessionId);
    const net = payRound(Number(e.netEarning) || 0);
    const cashAllocated = legacySettled ? net : (allocByEarning.get(e.id) ?? 0);
    const manualAdjusted = legacySettled ? 0 : (adjByEarning.get(e.id) ?? 0);
    const allocatedAmount = payRound(cashAllocated + manualAdjusted);
    const outstandingAmount = legacySettled ? 0 : payRound(Math.max(0, net - allocatedAmount));
    return {
      id: e.id, sessionId: e.sessionId, staffId: e.staffId, netEarning: net,
      allocatedAmount, outstandingAmount,
      periodStart: e.periodStart ?? null, periodEnd: e.periodEnd ?? null,
      calculatedAt: e.calculatedAt ?? null, calculationStatus: String(e.calculationStatus || ""),
      legacySettled,
    };
  });

  return rows.filter((r) => r.outstandingAmount > 0.000001 && !r.legacySettled).sort(stableSort);
}

async function loadAllocationsForPayment(tx: AllocationTx, paymentId: string): Promise<AllocationRow[]> {
  const rows = await tx.paymentAllocation.findMany({
    where: { paymentId },
    select: { id: true, payrollEarningId: true, amount: true, idempotencyKey: true },
    orderBy: { id: "asc" },
  });
  return (rows as any[]).map((r) => ({ id: r.id, payrollEarningId: r.payrollEarningId, amount: Number(r.amount), idempotencyKey: r.idempotencyKey ?? null }));
}

function requestedFromPayment(payment: any, fallbackActual: number): number {
  const v = payment?.allocationRequestedAmount;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return payRound(v);
  // Legacy/compat: older non-legacy allocation rows stored requested amount in batchId as "req:<amount>".
  const b = typeof payment?.batchId === "string" ? payment.batchId : "";
  const m = /^req:(\d+(?:\.\d+)?)$/.exec(b);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return payRound(n);
  }
  return payRound(fallbackActual);
}

function allocationsMatchReplay(allocs: AllocationRow[], baseKey: string, expectedActual: number): boolean {
  const expectedKey = (id: string) => `${baseKey}:${id}`;
  const allocatedTotal = payRound(allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  if (Math.abs(allocatedTotal - expectedActual) > 0.000001) return false;
  if (allocs.length === 0) return expectedActual <= 0.000001;
  return allocs.every((a) => (a.idempotencyKey ?? "") === expectedKey(a.payrollEarningId));
}

async function replayFromExistingPayment(tx: AllocationTx, payment: any, input: AllocateInput, requestKey: string): Promise<AllocateResult> {
  if (payment.staffId !== input.staffId) throw err("PAYMENT_IDEMPOTENCY_MISMATCH", "Idempotency key belongs to a different staff/payment context");
  const allocations = await loadAllocationsForPayment(tx, payment.id);
  const originalActual = payRound(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const originalRequested = requestedFromPayment(payment, originalActual);
  if (Math.abs(payRound(input.amount) - originalRequested) > 0.000001) {
    throw err("PAYMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different amount or allocation result");
  }
  if (!allocationsMatchReplay(allocations, requestKey, originalActual)) {
    throw err("PAYMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different amount or allocation result");
  }
  const after = await getOutstandingEarnings(tx, input.staffId);
  const remainingOutstanding = payRound(after.reduce((s, e) => s + e.outstandingAmount, 0));
  const unfulfilledAmount = payRound(Math.max(0, originalRequested - originalActual));
  return {
    ok: true,
    paymentId: payment.id,
    staffId: input.staffId,
    requestedAmount: originalRequested,
    actualAllocatedAmount: originalActual,
    allocatedTotal: originalActual,
    unfulfilledAmount,
    remainingOutstanding,
    allocations,
    outstandingAfterTotal: remainingOutstanding,
    skippedDuplicate: true,
    allocationStatus: "REPLAY",
    reason: unfulfilledAmount > 0.000001 ? "REPLAY_PARTIAL_ALLOCATION" : "REPLAY_FULL_ALLOCATION",
  };
}

async function findPaymentByIdempotencyKey(tx: AllocationTx, key: string): Promise<any | null> {
  if (!tx.payment.findUnique) return null;
  try {
    return await tx.payment.findUnique({ where: { idempotencyKey: key } });
  } catch {
    if (tx.payment.findFirst) return tx.payment.findFirst({ where: { idempotencyKey: key } });
    return null;
  }
}

export async function allocateToOutstandingEarnings(tx: AllocationTx, input: AllocateInput): Promise<AllocateResult> {
  if (input.advanceAdjustment != null && Number(input.advanceAdjustment) !== 0) {
    throw err("ADVANCE_ADJUSTMENT_DEFERRED");
  }
  assertPositiveAmount(input.amount);
  const requestedAmount = payRound(input.amount);

  if (input.paymentId && input.payment) throw err("AMBIGUOUS_PAYMENT_TARGET");

  // New non-legacy Payment creation requires a validated request-level idempotency key (no unsafe optional path).
  let requestKey: string | undefined = input.idempotencyKey != null ? normalizeKey(input.idempotencyKey) : undefined;
  if (input.payment) {
    const paymentKey = normalizeKey(input.payment.idempotencyKey, "PAYMENT_IDEMPOTENCY_KEY_REQUIRED");
    if (requestKey && requestKey !== paymentKey) throw err("PAYMENT_IDEMPOTENCY_MISMATCH", "payment.idempotencyKey must match idempotencyKey");
    requestKey = paymentKey;
  }

  // Concurrency safety: serialize all allocation transactions for the same staff member before any
  // authoritative balance/staff read or write. Scope covers all eligible earnings of the staff member.
  await acquireStaffAllocationLock(tx, input.staffId);

  const staff = await tx.staff.findUnique({ where: { employeeId: input.staffId }, select: { employeeId: true, fullName: true } });
  if (!staff) throw err("STAFF_NOT_FOUND");

  // Replay check (after lock): same request key must never create a second Payment / second financial transaction.
  // Replay returns the exact original Payment/allocation result without recalculation/modification.
  if (requestKey) {
    const existingPayment = await findPaymentByIdempotencyKey(tx, requestKey);
    if (existingPayment) {
      return replayFromExistingPayment(tx, existingPayment, input, requestKey);
    }
  }

  // If allocating against an existing payment with idempotency key, detect replay by derived allocation keys.
  if (input.paymentId && requestKey) {
    const existingByKey = await tx.paymentAllocation.findMany({
      where: { paymentId: input.paymentId, idempotencyKey: { startsWith: `${requestKey}:` } },
      select: { id: true, payrollEarningId: true, amount: true, idempotencyKey: true },
    });
    if (existingByKey.length > 0) {
      const p = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, staffId: true, idempotencyKey: true, batchId: true, allocationRequestedAmount: true } });
      if (!p) throw err("PAYMENT_NOT_FOUND");
      if (p.staffId !== input.staffId) throw err("PAYMENT_IDEMPOTENCY_MISMATCH");
      const allocations = (existingByKey as any[]).map((r) => ({ id: r.id, payrollEarningId: r.payrollEarningId, amount: Number(r.amount), idempotencyKey: r.idempotencyKey ?? null }));
      const originalActual = payRound(allocations.reduce((s, a) => s + a.amount, 0));
      const originalRequested = requestedFromPayment(p, originalActual);
      if (Math.abs(requestedAmount - originalRequested) > 0.000001 || !allocationsMatchReplay(allocations, requestKey, originalActual)) {
        throw err("PAYMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different amount or allocation result");
      }
      const after = await getOutstandingEarnings(tx, input.staffId);
      const remainingOutstanding = payRound(after.reduce((s, e) => s + e.outstandingAmount, 0));
      const unfulfilledAmount = payRound(Math.max(0, originalRequested - originalActual));
      return {
        ok: true, paymentId: p.id, staffId: input.staffId,
        requestedAmount: originalRequested,
        actualAllocatedAmount: originalActual,
        allocatedTotal: originalActual,
        unfulfilledAmount,
        remainingOutstanding,
        allocations,
        outstandingAfterTotal: remainingOutstanding,
        skippedDuplicate: true,
        allocationStatus: "REPLAY",
        reason: unfulfilledAmount > 0.000001 ? "REPLAY_PARTIAL_ALLOCATION" : "REPLAY_FULL_ALLOCATION",
      };
    }
  }

  // Authoritative re-read after lock (eligible earnings, legacy settlements, allocation aggregates).
  const outstanding = await getOutstandingEarnings(tx, input.staffId);
  const totalOutstanding = payRound(outstanding.reduce((s, e) => s + e.outstandingAmount, 0));

  // Partial allocation policy: allocate max currently available; never reject solely because requested > outstanding.
  // Zero allocatable => no Payment/PaymentAllocation/audit.
  if (totalOutstanding <= 0.000001) {
    return {
      ok: true,
      paymentId: null,
      staffId: input.staffId,
      requestedAmount,
      actualAllocatedAmount: 0,
      allocatedTotal: 0,
      unfulfilledAmount: payRound(requestedAmount),
      remainingOutstanding: 0,
      allocations: [],
      outstandingAfterTotal: 0,
      skippedDuplicate: false,
      allocationStatus: "NONE",
      reason: "NO_OUTSTANDING_AVAILABLE",
    };
  }

  const actualAllocatedAmount = payRound(Math.min(requestedAmount, totalOutstanding));
  const unfulfilledAmount = payRound(Math.max(0, requestedAmount - actualAllocatedAmount));

  // Resolve/create payment target (after lock and idempotency replay checks).
  let paymentId: string | null = null;
  let creatingPayment = !!input.payment;
  if (input.paymentId) {
    creatingPayment = false;
    const p = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { id: true, staffId: true } });
    if (!p) throw err("PAYMENT_NOT_FOUND");
    if (p.staffId !== input.staffId) throw err("PAYMENT_STAFF_MISMATCH");
    paymentId = p.id;
  } else if (input.payment) {
    try {
      const created = await tx.payment.create({
        data: {
          staffId: input.staffId,
          sessionId: null, // never set legacy session settlement link
          date: new Date(),
          paidAt: input.payment.paidAt ?? new Date(),
          periodLabel: input.payment.periodLabel ?? "Allocation",
          dutyHours: 0, workedMin: 0, breakMin: 0, overBreakMin: 0, overtimeMin: 0,
          hourlyRate: 0, grossPay: 0, overtimePay: 0, overBreakDeduction: 0,
          advanceAdjusted: 0,
          netPay: actualAllocatedAmount, // actual allocated, never requested
          status: "PAID",
          paidBy: input.payment.paidBy,
          allocationRequestedAmount: requestedAmount, // original requested amount for idempotent replay validation (Phase 2A.6)
          idempotencyKey: requestKey!, // required for new non-legacy allocation payments
        },
        select: { id: true },
      });
      paymentId = created.id;
    } catch (e: any) {
      // P2002 on Payment.idempotencyKey aborts tx in Postgres; no recovery queries in this tx.
      if (isP2002(e) && requestKey) {
        throw err("PAYMENT_IDEMPOTENCY_CONFLICT", "Concurrent duplicate payment request; retry to replay original result", { idempotencyKey: requestKey });
      }
      throw e;
    }
  } else {
    throw err("PAYMENT_TARGET_REQUIRED");
  }

  let remaining = actualAllocatedAmount;
  const allocations: AllocationRow[] = [];

  try {
    for (const earning of outstanding) {
      if (remaining <= 0.000001) break;

      const fresh = await tx.payrollEarning.findUnique({
        where: { id: earning.id },
        select: { id: true, staffId: true, calculationStatus: true, netEarning: true, sessionId: true },
      });
      if (!fresh) throw err("EARNING_NOT_FOUND");
      if (fresh.staffId !== input.staffId) throw err("CROSS_STAFF_EARNING");
      if (String(fresh.calculationStatus || "") !== ELIGIBLE_STATUS) throw err("INCOMPLETE_EARNING_INELIGIBLE");

      // Legacy settlement exclusion (re-read after lock)
      const legacy = await tx.payment.findFirst({ where: { staffId: input.staffId, sessionId: fresh.sessionId }, select: { id: true } });
      if (legacy) continue;

      const prior = await tx.paymentAllocation.aggregate({
        where: { payrollEarningId: fresh.id, staffId: input.staffId },
        _sum: { amount: true },
      });
      const priorAdj = tx.advanceAdjustment?.aggregate
        ? await tx.advanceAdjustment.aggregate({ where: { payrollEarningId: fresh.id, staffId: input.staffId }, _sum: { amount: true } })
        : { _sum: { amount: 0 } };
      const cashSoFar = payRound(Number(prior?._sum?.amount ?? 0));
      const adjustedSoFar = payRound(Number(priorAdj?._sum?.amount ?? 0));
      const allocatedSoFar = payRound(cashSoFar + adjustedSoFar);
      const net = payRound(Number(fresh.netEarning) || 0);
      const earningOutstanding = payRound(Math.max(0, net - allocatedSoFar));
      if (earningOutstanding <= 0.000001) continue;

      const take = payRound(Math.min(remaining, earningOutstanding));
      if (take <= 0) continue;

      // Enforce cap: no allocation may exceed earning netEarning (and remaining outstanding after cash+manual adjustments).
      if (allocatedSoFar + take - net > 0.000001) {
        throw err("EARNING_ALLOCATION_CAP_EXCEEDED", undefined, { earningId: fresh.id, net, allocatedSoFar, cashSoFar, adjustedSoFar, take });
      }

      const row = await tx.paymentAllocation.create({
        data: {
          paymentId: paymentId!,
          payrollEarningId: fresh.id,
          staffId: input.staffId,
          amount: take,
          allocationType: "SETTLEMENT",
          allocatedAt: new Date(),
          allocatedBy: input.actor?.name ?? null,
          idempotencyKey: requestKey ? allocKey(requestKey, fresh.id) : undefined,
          note: input.payment?.note ?? null,
        },
        select: { id: true, payrollEarningId: true, amount: true, idempotencyKey: true },
      });
      allocations.push({ id: row.id, payrollEarningId: row.payrollEarningId, amount: Number(row.amount), idempotencyKey: row.idempotencyKey ?? null });
      remaining = payRound(remaining - take);
    }

    const actualTotal = payRound(allocations.reduce((s, a) => s + a.amount, 0));
    if (actualTotal + 0.000001 < actualAllocatedAmount) {
      throw err("INSUFFICIENT_OUTSTANDING_AFTER_RECHECK", undefined, { requestedAmount, actualAllocatedAmount, actualTotal });
    }
    if (Math.abs(actualTotal - actualAllocatedAmount) > 0.000001) {
      throw err("ALLOCATION_AMOUNT_INCONSISTENCY", undefined, { actualAllocatedAmount, actualTotal });
    }

    const finalUnfulfilled = payRound(Math.max(0, requestedAmount - actualTotal));
    const allocationStatus: "FULL" | "PARTIAL" = finalUnfulfilled > 0.000001 ? "PARTIAL" : "FULL";

    await tx.auditLog.create({
      data: {
        action: "PAYMENT_ALLOCATION",
        entityType: "Payment",
        entityId: paymentId!,
        actorName: input.actor?.name ?? "System",
        actorRole: input.actor?.role ?? "SYSTEM",
        summary: `Allocated ৳${actualTotal.toFixed(2)} (requested ৳${requestedAmount.toFixed(2)}, unfulfilled ৳${finalUnfulfilled.toFixed(2)}) for ${staff.fullName ?? input.staffId} across ${allocations.length} earning(s)`,
        after: {
          paymentId, staffId: input.staffId,
          requestedAmount, actualAllocatedAmount: actualTotal, unfulfilledAmount: finalUnfulfilled,
          allocationStatus, allocations, idempotencyKey: requestKey ?? null,
        },
      },
    });

    const after = await getOutstandingEarnings(tx, input.staffId);
    const remainingOutstanding = payRound(after.reduce((s, e) => s + e.outstandingAmount, 0));
    return {
      ok: true,
      paymentId: paymentId!,
      staffId: input.staffId,
      requestedAmount,
      actualAllocatedAmount: actualTotal,
      allocatedTotal: actualTotal,
      unfulfilledAmount: finalUnfulfilled,
      remainingOutstanding,
      allocations,
      outstandingAfterTotal: remainingOutstanding,
      allocationStatus,
      reason: allocationStatus === "PARTIAL" ? "PARTIAL_ALLOCATION_INSUFFICIENT_OUTSTANDING" : "FULL_ALLOCATION",
    };
  } catch (e: any) {
    // P2002 inside a transaction aborts that transaction in Postgres; do NOT attempt further queries here.
    if (isP2002(e) && requestKey && creatingPayment) {
      throw err("PAYMENT_IDEMPOTENCY_CONFLICT", "Concurrent duplicate payment request; retry to replay original result", { idempotencyKey: requestKey });
    }
    if (isP2002(e)) {
      throw err("ALLOCATION_CONFLICT", "Allocation conflict; retry safely", { idempotencyKey: requestKey ?? null });
    }
    throw e;
  }
}

