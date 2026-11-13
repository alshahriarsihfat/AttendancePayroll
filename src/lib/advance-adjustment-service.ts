import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { payRound } from "./currency";
import { APP_TIMEZONE, dateKeyInZone } from "./dates";

export type AdvanceActor = { name: string; role: string } | null;

export type AdvanceTx = {
  staff: any;
  advanceLog: any;
  advanceAdjustment: any;
  payrollEarning: any;
  payment: any;
  paymentAllocation: any;
  auditLog: any;
  $executeRaw?: any;
  $executeRawUnsafe?: any;
};

export type AdvanceAdjustmentInput = {
  staffId: string;
  advanceLogId: string;
  payrollEarningId: string;
  amount: number;
  idempotencyKey: string;
  note?: string | null;
  actor: AdvanceActor;
};

export type StaffAdvanceState = {
  staffId: string;
  totalGiven: number;
  totalLegacyAdjusted: number; // existing AdvanceLog ADJUSTED rows (legacy payout auto-adjust), preserved
  totalManualAdjusted: number;  // confirmed AdvanceAdjustment ledger rows
  totalAdjusted: number;        // legacy + manual
  outstandingAdvance: number;   // derived: given - totalAdjusted
  givenAdvances: Array<{
    id: string;
    amount: number;
    adjusted: number; // manual adjustments applied to this advance log
    outstanding: number;
    note: string | null;
    createdAt: string;
    createdBy: string;
  }>;
};

export type EligibleEarningState = {
  id: string;
  sessionId: string;
  staffId: string;
  workDate: string | null;
  netEarning: number;
  cashAllocated: number;
  manualAdjusted: number;
  remainingEligible: number;
  calculationStatus: string;
  legacySettled: boolean;
};

const EPS = 0.000001;

export function advErr(code: string, message?: string, details?: any): Error & { code: string; details?: any } {
  return Object.assign(new Error(message ?? code), { code, details });
}

export function isP2002(e: any): boolean {
  return !!e && (e.code === "P2002" || (e?.name === "PrismaClientKnownRequestError" && e?.code === "P2002"));
}

export async function acquireStaffAdvanceLock(tx: AdvanceTx, staffId: string): Promise<void> {
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('kpsms:advance:staff'), hashtext(${staffId}))`);
    return;
  }
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", "kpsms:advance:staff", staffId);
    return;
  }
  throw advErr("ADVANCE_LOCK_UNAVAILABLE", "Transaction lock primitive unavailable");
}

export function normalizeIdemKey(key: unknown): string {
  if (typeof key !== "string") throw advErr("INVALID_IDEMPOTENCY_KEY");
  const v = key.trim();
  if (!v) throw advErr("INVALID_IDEMPOTENCY_KEY");
  return v;
}

export function adjustmentFingerprint(input: { staffId: string; advanceLogId: string; payrollEarningId: string; amount: number; note?: string | null }): string {
  const norm = {
    staffId: input.staffId,
    advanceLogId: input.advanceLogId,
    payrollEarningId: input.payrollEarningId,
    amount: payRound(input.amount),
    note: (input.note ?? "").trim(),
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

function dhakaWorkDate(e: any): string | null {
  const v = e?.periodStart ?? e?.session?.date ?? e?.periodEnd ?? null;
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return dateKeyInZone(d, APP_TIMEZONE);
}

export async function getStaffAdvanceState(tx: AdvanceTx, staffId: string): Promise<StaffAdvanceState> {
  const adj = (tx as any).advanceAdjustment;
  const [logs, manualAgg, manualByAdvance] = await Promise.all([
    tx.advanceLog.findMany({ where: { staffId }, select: { id: true, type: true, amount: true, note: true, createdAt: true, createdBy: true } }),
    adj?.aggregate ? adj.aggregate({ where: { staffId }, _sum: { amount: true } }) : (async () => {
      const rows = adj?.findMany ? await adj.findMany({ where: { staffId }, select: { amount: true } }) : [];
      return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } };
    })(),
    adj?.groupBy ? adj.groupBy({ by: ["advanceLogId"], where: { staffId }, _sum: { amount: true } }) : (async () => {
      const rows = adj?.findMany ? await adj.findMany({ where: { staffId }, select: { advanceLogId: true, amount: true } }) : [];
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.advanceLogId, (m.get(r.advanceLogId) ?? 0) + (Number(r.amount) || 0));
      return Array.from(m.entries()).map(([advanceLogId, amount]) => ({ advanceLogId, _sum: { amount } }));
    })(),
  ]);

  let totalGiven = 0;
  let totalLegacyAdjusted = 0;
  const given: any[] = [];
  for (const l of logs as any[]) {
    const amt = payRound(Number(l.amount) || 0);
    const t = String(l.type || "").toUpperCase();
    if (t === "GIVEN") { totalGiven = payRound(totalGiven + amt); given.push(l); }
    else if (t === "ADJUSTED") { totalLegacyAdjusted = payRound(totalLegacyAdjusted + amt); }
  }
  const manualMap = new Map<string, number>();
  for (const r of manualByAdvance as any[]) manualMap.set(r.advanceLogId, payRound(Number(r._sum?.amount ?? 0)));
  const totalManualAdjusted = payRound(Number((manualAgg as any)?._sum?.amount ?? 0));
  const totalAdjusted = payRound(totalLegacyAdjusted + totalManualAdjusted);
  const outstandingAdvance = payRound(Math.max(0, totalGiven - totalAdjusted));

  const givenAdvances = given
    .map((l: any) => {
      const amount = payRound(Number(l.amount) || 0);
      const adjusted = manualMap.get(l.id) ?? 0;
      return {
        id: l.id,
        amount,
        adjusted,
        outstanding: payRound(Math.max(0, amount - adjusted)),
        note: l.note ?? null,
        createdAt: (l.createdAt instanceof Date ? l.createdAt : new Date(l.createdAt)).toISOString(),
        createdBy: String(l.createdBy ?? ""),
      };
    })
    .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return { staffId, totalGiven, totalLegacyAdjusted, totalManualAdjusted, totalAdjusted, outstandingAdvance, givenAdvances };
}

export async function getEligibleEarningsForStaff(tx: AdvanceTx, staffId: string): Promise<EligibleEarningState[]> {
  const earnings = await tx.payrollEarning.findMany({
    where: { staffId, calculationStatus: "CALCULATED" },
    select: {
      id: true, sessionId: true, staffId: true, netEarning: true, calculationStatus: true,
      periodStart: true, periodEnd: true,
      session: { select: { date: true } },
    },
  });
  if (earnings.length === 0) return [];
  const ids = earnings.map((e: any) => e.id);
  const sessionIds = earnings.map((e: any) => e.sessionId).filter(Boolean);

  const pa = (tx as any).paymentAllocation;
  const adj = (tx as any).advanceAdjustment;
  const [allocSums, adjSums, legacyPayments] = await Promise.all([
    pa?.groupBy
      ? pa.groupBy({ by: ["payrollEarningId"], where: { payrollEarningId: { in: ids }, staffId }, _sum: { amount: true } })
      : (async () => { const rows = pa?.findMany ? await pa.findMany({ where: { payrollEarningId: { in: ids }, staffId }, select: { payrollEarningId: true, amount: true } }) : []; const m = new Map<string, number>(); for (const r of rows) m.set(r.payrollEarningId, (m.get(r.payrollEarningId) ?? 0) + (Number(r.amount) || 0)); return Array.from(m.entries()).map(([payrollEarningId, amount]) => ({ payrollEarningId, _sum: { amount } })); })(),
    adj?.groupBy
      ? adj.groupBy({ by: ["payrollEarningId"], where: { payrollEarningId: { in: ids }, staffId }, _sum: { amount: true } })
      : (async () => { const rows = adj?.findMany ? await adj.findMany({ where: { payrollEarningId: { in: ids }, staffId }, select: { payrollEarningId: true, amount: true } }) : []; const m = new Map<string, number>(); for (const r of rows) m.set(r.payrollEarningId, (m.get(r.payrollEarningId) ?? 0) + (Number(r.amount) || 0)); return Array.from(m.entries()).map(([payrollEarningId, amount]) => ({ payrollEarningId, _sum: { amount } })); })(),
    tx.payment.findMany({ where: { staffId, sessionId: { in: sessionIds } }, select: { sessionId: true } }),
  ]);

  const cashBy = new Map<string, number>();
  for (const r of allocSums as any[]) cashBy.set(r.payrollEarningId, payRound(Number(r._sum?.amount ?? 0)));
  const adjBy = new Map<string, number>();
  for (const r of adjSums as any[]) adjBy.set(r.payrollEarningId, payRound(Number(r._sum?.amount ?? 0)));
  const legacySet = new Set((legacyPayments as any[]).map((p) => p.sessionId).filter(Boolean));

  const rows: EligibleEarningState[] = [];
  for (const e of earnings as any[]) {
    const legacySettled = legacySet.has(e.sessionId);
    const net = payRound(Number(e.netEarning) || 0);
    const cashAllocated = legacySettled ? net : (cashBy.get(e.id) ?? 0);
    const manualAdjusted = adjBy.get(e.id) ?? 0;
    const remainingEligible = legacySettled ? 0 : payRound(Math.max(0, net - cashAllocated - manualAdjusted));
    rows.push({
      id: e.id, sessionId: e.sessionId, staffId: e.staffId, workDate: dhakaWorkDate(e),
      netEarning: net, cashAllocated, manualAdjusted, remainingEligible,
      calculationStatus: String(e.calculationStatus || ""), legacySettled,
    });
  }
  return rows.filter((r) => r.remainingEligible > EPS && !r.legacySettled)
    .sort((a, b) => (a.workDate || "").localeCompare(b.workDate || "") || a.id.localeCompare(b.id));
}

export type AdvanceAdjustmentResult = {
  ok: true;
  adjustmentId: string;
  staffId: string;
  advanceLogId: string;
  payrollEarningId: string;
  amount: number;
  remainingAdvance: number;
  remainingEarning: number;
  skippedDuplicate: boolean;
  reason?: string;
};

export async function createAdvanceAdjustment(tx: AdvanceTx, input: AdvanceAdjustmentInput): Promise<AdvanceAdjustmentResult> {
  const staffId = String(input.staffId || "").trim();
  if (!staffId) throw advErr("STAFF_REQUIRED");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) throw advErr("INVALID_ADJUSTMENT_AMOUNT");
  const amount = payRound(input.amount);
  if (amount <= 0) throw advErr("INVALID_ADJUSTMENT_AMOUNT");
  const idempotencyKey = normalizeIdemKey(input.idempotencyKey);
  const advanceLogId = String(input.advanceLogId || "").trim();
  const payrollEarningId = String(input.payrollEarningId || "").trim();
  if (!advanceLogId) throw advErr("ADVANCE_LOG_REQUIRED");
  if (!payrollEarningId) throw advErr("EARNING_REQUIRED");

  const fingerprint = adjustmentFingerprint({ staffId, advanceLogId, payrollEarningId, amount, note: input.note ?? null });

  await acquireStaffAdvanceLock(tx, staffId);

  const existing = await tx.advanceAdjustment.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.staffId !== staffId || existing.advanceLogId !== advanceLogId || existing.payrollEarningId !== payrollEarningId || Math.abs(payRound(Number(existing.amount) || 0) - amount) > EPS) {
      throw advErr("ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different payload");
    }
    if (existing.requestFingerprint && existing.requestFingerprint !== fingerprint) {
      throw advErr("ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different payload");
    }
    const state = await getStaffAdvanceState(tx, staffId);
    const elig = await getEligibleEarningsForStaff(tx, staffId);
    const earningRow = elig.find((e) => e.id === payrollEarningId);
    // remaining after this (already applied) adjustment
    const earningFresh = await tx.payrollEarning.findUnique({ where: { id: payrollEarningId }, select: { id: true } });
    let remainingEarning = earningRow?.remainingEligible ?? 0;
    if (!earningFresh) remainingEarning = 0;
    return {
      ok: true,
      adjustmentId: existing.id,
      staffId,
      advanceLogId,
      payrollEarningId,
      amount: payRound(Number(existing.amount) || 0),
      remainingAdvance: state.outstandingAdvance,
      remainingEarning,
      skippedDuplicate: true,
      reason: "REPLAY",
    };
  }

  const staff = await tx.staff.findUnique({ where: { employeeId: staffId }, select: { employeeId: true, fullName: true, advance: true } });
  if (!staff) throw advErr("STAFF_NOT_FOUND");

  const advanceLog = await tx.advanceLog.findUnique({ where: { id: advanceLogId }, select: { id: true, staffId: true, type: true, amount: true } });
  if (!advanceLog) throw advErr("ADVANCE_LOG_NOT_FOUND");
  if (advanceLog.staffId !== staffId) throw advErr("CROSS_STAFF_ADVANCE");
  if (String(advanceLog.type || "").toUpperCase() !== "GIVEN") throw advErr("ADVANCE_NOT_ADJUSTABLE", "Only GIVEN advances can be manually adjusted");

  const earning = await tx.payrollEarning.findUnique({
    where: { id: payrollEarningId },
    select: { id: true, staffId: true, sessionId: true, netEarning: true, calculationStatus: true, periodStart: true, session: { select: { date: true } } },
  });
  if (!earning) throw advErr("EARNING_NOT_FOUND");
  if (earning.staffId !== staffId) throw advErr("CROSS_STAFF_EARNING");
  if (String(earning.calculationStatus || "").toUpperCase() !== "CALCULATED") throw advErr("EARNING_NOT_ELIGIBLE", "Earning is not accrued/calculated");

  // Legacy settlement exclusion
  const legacy = await tx.payment.findFirst({ where: { staffId, sessionId: earning.sessionId }, select: { id: true } });
  if (legacy) throw advErr("EARNING_ALREADY_SETTLED", "Legacy-settled earning cannot be adjusted");

  const pa = (tx as any).paymentAllocation;
  const adj = (tx as any).advanceAdjustment;
  const [cashAgg, adjAggEarning, adjAggAdvance, state] = await Promise.all([
    pa?.aggregate ? pa.aggregate({ where: { payrollEarningId, staffId }, _sum: { amount: true } }) : (async () => { const rows = pa?.findMany ? await pa.findMany({ where: { payrollEarningId, staffId }, select: { amount: true } }) : []; return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } }; })(),
    adj?.aggregate ? adj.aggregate({ where: { payrollEarningId, staffId }, _sum: { amount: true } }) : (async () => { const rows = adj?.findMany ? await adj.findMany({ where: { payrollEarningId, staffId }, select: { amount: true } }) : []; return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } }; })(),
    adj?.aggregate ? adj.aggregate({ where: { advanceLogId, staffId }, _sum: { amount: true } }) : (async () => { const rows = adj?.findMany ? await adj.findMany({ where: { advanceLogId, staffId }, select: { amount: true } }) : []; return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } }; })(),
    getStaffAdvanceState(tx, staffId),
  ]);

  const net = payRound(Number(earning.netEarning) || 0);
  const cashAllocated = payRound(Number(cashAgg?._sum?.amount ?? 0));
  const earningAdjusted = payRound(Number(adjAggEarning?._sum?.amount ?? 0));
  const remainingEarningBefore = payRound(Math.max(0, net - cashAllocated - earningAdjusted));
  if (remainingEarningBefore <= EPS) throw advErr("EARNING_FULLY_PAID_OR_ADJUSTED");

  const advanceLogAmount = payRound(Number(advanceLog.amount) || 0);
  const advanceLogAdjusted = payRound(Number(adjAggAdvance?._sum?.amount ?? 0));
  const advanceLogOutstanding = payRound(Math.max(0, advanceLogAmount - advanceLogAdjusted));
  if (state.outstandingAdvance <= EPS || advanceLogOutstanding <= EPS) throw advErr("NO_OUTSTANDING_ADVANCE");

  if (amount - state.outstandingAdvance > EPS) throw advErr("ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE");
  if (amount - advanceLogOutstanding > EPS) throw advErr("ADJUSTMENT_EXCEEDS_ADVANCE_LOG_OUTSTANDING");
  if (amount - remainingEarningBefore > EPS) throw advErr("ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING");

  const workDate = dhakaWorkDate(earning);
  let adjustment: any;
  try {
    adjustment = await tx.advanceAdjustment.create({
      data: {
        staffId,
        advanceLogId,
        payrollEarningId,
        amount,
        idempotencyKey,
        note: (input.note ?? "").trim() || null,
        adjustedBy: input.actor?.name ?? "System",
        adjustedByRole: input.actor?.role ?? "SYSTEM",
        workDate,
        requestFingerprint: fingerprint,
      },
      select: { id: true, amount: true, staffId: true, advanceLogId: true, payrollEarningId: true },
    });
  } catch (e: any) {
    if (isP2002(e)) throw advErr("ADVANCE_ADJUSTMENT_CONFLICT", "Concurrent duplicate adjustment request; retry safely", { idempotencyKey });
    throw e;
  }

  // Derive authoritative balances after insert (append-only ledger is source of truth). Keep Staff.advance cache in sync.
  const paAfter = (tx as any).paymentAllocation;
  const adjAfterModel = (tx as any).advanceAdjustment;
  const [stateAfter, cashAfter, adjAfter] = await Promise.all([
    getStaffAdvanceState(tx, staffId),
    paAfter?.aggregate ? paAfter.aggregate({ where: { payrollEarningId, staffId }, _sum: { amount: true } }) : (async () => { const rows = paAfter?.findMany ? await paAfter.findMany({ where: { payrollEarningId, staffId }, select: { amount: true } }) : []; return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } }; })(),
    adjAfterModel?.aggregate ? adjAfterModel.aggregate({ where: { payrollEarningId, staffId }, _sum: { amount: true } }) : (async () => { const rows = adjAfterModel?.findMany ? await adjAfterModel.findMany({ where: { payrollEarningId, staffId }, select: { amount: true } }) : []; return { _sum: { amount: rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0) } }; })(),
  ]);
  const remainingEarning = payRound(Math.max(0, net - payRound(Number(cashAfter?._sum?.amount ?? 0)) - payRound(Number(adjAfter?._sum?.amount ?? 0))));

  await tx.staff.update({ where: { employeeId: staffId }, data: { advance: stateAfter.outstandingAdvance } });

  await tx.auditLog.create({
    data: {
      action: "ADVANCE_ADJUSTED",
      entityType: "AdvanceAdjustment",
      entityId: adjustment.id,
      actorName: input.actor?.name ?? "System",
      actorRole: input.actor?.role ?? "SYSTEM",
      summary: `Manual advance adjustment ৳${amount.toFixed(2)} for ${staff.fullName ?? staffId} against earning ${payrollEarningId} (advance ${advanceLogId})`,
      after: {
        adjustmentId: adjustment.id, staffId, advanceLogId, payrollEarningId, amount,
        remainingAdvance: stateAfter.outstandingAdvance, remainingEarning,
        workDate, idempotencyKey,
      },
    },
  });

  return {
    ok: true,
    adjustmentId: adjustment.id,
    staffId,
    advanceLogId,
    payrollEarningId,
    amount,
    remainingAdvance: stateAfter.outstandingAdvance,
    remainingEarning,
    skippedDuplicate: false,
  };
}
