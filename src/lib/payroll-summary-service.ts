import { payRound } from "./currency";
import { APP_TIMEZONE, dateKeyInZone } from "./dates";

export type PayrollSummaryTx = {
  payrollEarning: any;
  paymentAllocation: any;
  payment: any;
  staff: any;
  timeSession: any;
  advanceAdjustment?: any;
  advanceLog?: any;
};

export type UnavailableMetric = { available: false; reason: string };
export type AmountMetric = { available: true; value: number } | UnavailableMetric;
export type CountMetric = { available: true; value: number } | UnavailableMetric;

export type PaymentStatus = "READY" | "PARTIAL" | "SETTLED" | "INCOMPLETE" | "WORKING" | "NOT_READY";

export interface StaffPayableRow {
  staffId: string;
  staffName: string;
  workDate: string | null; // earning work date (Asia/Dhaka, YYYY-MM-DD) or null if unavailable
  earningPeriod: { start: string | null; end: string | null; kind: string | null };
  payableHours: number | null;
  earnedAmount: number | null; // null when INCOMPLETE/unavailable (never guessed)
  previouslyAllocatedAmount: number; // cash allocations (server-authoritative)
  manualAdvanceAdjustedAmount: number; // confirmed manual advance adjustments against this earning
  remainingOutstandingAmount: number; // remaining payable earned salary for this earning (net - cash - manual adjustments)
  earningStatus: "CALCULATED" | "INCOMPLETE" | "NONE";
  paymentStatus: PaymentStatus;
  paymentPermitted: boolean;
  earningId: string | null;
  sessionId: string | null;
  isToday: boolean;
  isHistoricalOutstanding: boolean;
  legacySettled: boolean;
}

export interface StaffAccountSummary {
  staffId: string;
  staffName: string;
  selectedDateEarnedSalary: AmountMetric;
  selectedDateCashPayments: AmountMetric;
  selectedDateAdvanceAdjustments: AmountMetric;
  selectedDateRemainingPayable: AmountMetric;
  allTimeEarnedSalary: AmountMetric;
  allTimeCashPayments: AmountMetric;
  allTimeAdvanceAdjustments: AmountMetric;
  currentOutstandingEarnedSalary: AmountMetric;
  totalAdvancesReceived: AmountMetric;
  totalAdvancesAdjusted: AmountMetric;
  outstandingAdvances: AmountMetric;
  currentAdvanceBalance?: AmountMetric; // compatibility alias for outstandingAdvances
}

export interface AdvanceHistoryItem {
  id: string;
  staffId: string;
  staffName?: string | null;
  type: "GIVEN" | "ADJUSTED" | string;
  amount: number;
  balanceAfter?: number | null; // legacy snapshot; not sole source of truth
  note?: string | null;
  createdAt: string;
  createdBy?: string | null;
  paymentId?: string | null;
}

export interface AdvanceAdjustmentItem {
  id: string;
  staffId: string;
  staffName?: string | null;
  advanceLogId: string;
  payrollEarningId: string;
  workDate?: string | null;
  amount: number;
  note?: string | null;
  adjustedAt: string;
  adjustedBy?: string | null;
  idempotencyKey: string;
}

export interface PayrollSummaryDTO {
  date: string; // selected work/payment context date (Asia/Dhaka, YYYY-MM-DD)
  timezone: "Asia/Dhaka";
  generatedAt: string;
  summary: {
    todayEarnedAmount: AmountMetric; // Today's Earned Salary
    todayCashPaymentsAmount: AmountMetric; // Today's Cash Payments (payment-date cash allocations)
    todayAdvanceAdjustmentsAmount: AmountMetric; // Today's Advance Adjustments (manual ledger)
    todayPaidAmount: AmountMetric; // compatibility alias for today's cash payments
    todayAvailableAmount: AmountMetric;
    todayAvailableFromOlderOutstandingAmount: AmountMetric;
    todayPaidTowardTodayEarningsAmount: AmountMetric;
    todayPaidTowardOlderEarningsAmount: AmountMetric;
    totalOutstandingAmount: AmountMetric; // Total Outstanding Earned Salary
    outstandingAdvancesAmount: AmountMetric; // Outstanding Advances
    clockedOutCount: CountMetric;
    stillWorkingCount: CountMetric;
    earningReadyCount: CountMetric;
    incompleteEarningCount: CountMetric;
    partiallyPaidCount: CountMetric;
    fullyPaidCount: CountMetric;
  };
  staffPayables: {
    rows: StaffPayableRow[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  staffAccounts?: StaffAccountSummary[];
  advances?: {
    available: boolean;
    reason?: string;
    items: AdvanceHistoryItem[];
    adjustments: AdvanceAdjustmentItem[];
  };
  notes: string[];
}

export interface PayrollSummaryOptions {
  date: string; // YYYY-MM-DD Asia/Dhaka
  staffId?: string;
  limit?: number;
  offset?: number;
}

const ELIGIBLE = "CALCULATED";
const EPS = 0.000001;

function ok(n: number): AmountMetric { return { available: true, value: payRound(n) }; }
function cok(n: number): CountMetric { return { available: true, value: n }; }
function unavailable(reason: string): UnavailableMetric { return { available: false, reason }; }

function dhakaDateKeyOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return dateKeyInZone(d, APP_TIMEZONE);
}

function earningWorkDateKey(e: any): string | null {
  return dhakaDateKeyOf(e?.periodStart) ?? dhakaDateKeyOf(e?.session?.date) ?? dhakaDateKeyOf(e?.periodEnd);
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function statusOf(earningStatus: "CALCULATED" | "INCOMPLETE" | "NONE", outstanding: number, net: number, legacySettled: boolean, hasOpenSession: boolean, hasCompletedUnaccrued: boolean): { paymentStatus: PaymentStatus; paymentPermitted: boolean } {
  if (hasOpenSession) return { paymentStatus: "WORKING", paymentPermitted: false };
  if (earningStatus === "INCOMPLETE") return { paymentStatus: "INCOMPLETE", paymentPermitted: false };
  if (earningStatus === "NONE") return { paymentStatus: hasCompletedUnaccrued ? "NOT_READY" : "NOT_READY", paymentPermitted: false };
  if (legacySettled || outstanding <= EPS) return { paymentStatus: "SETTLED", paymentPermitted: false };
  if (net > outstanding + EPS) return { paymentStatus: "PARTIAL", paymentPermitted: true };
  return { paymentStatus: "READY", paymentPermitted: true };
}

function sumBy<T>(arr: T[], fn: (x: T) => number): number { return payRound(arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0)); }

export async function getPayrollSummary(db: PayrollSummaryTx, opts: PayrollSummaryOptions): Promise<PayrollSummaryDTO> {
  const date = opts.date;
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const notes: string[] = [];

  const sessionWhere: any = opts.staffId ? { staffId: opts.staffId } : {};
  const sessions = await db.timeSession.findMany({
    where: sessionWhere,
    select: { id: true, staffId: true, date: true, timeIn: true, timeOut: true, completed: true },
  });
  const sessionsForDate = sessions.filter((s: any) => dhakaDateKeyOf(s.date) === date);
  const clockedOutForDate = sessionsForDate.filter((s: any) => !!s.timeOut && s.completed === true);
  const stillWorkingForDate = sessionsForDate.filter((s: any) => !s.timeOut);
  const openSessionStaff = new Set(sessions.filter((s: any) => !s.timeOut).map((s: any) => s.staffId));

  const earningWhere: any = opts.staffId ? { staffId: opts.staffId } : {};
  const earnings = await db.payrollEarning.findMany({
    where: earningWhere,
    select: {
      id: true, sessionId: true, staffId: true, netEarning: true, calculationStatus: true,
      periodStart: true, periodEnd: true, periodKind: true, payableHours: true, payableMinutes: true,
      incompleteReason: true,
      staff: { select: { employeeId: true, fullName: true } },
      session: { select: { id: true, date: true, timeIn: true, timeOut: true, completed: true } },
      allocations: { select: { amount: true, paymentId: true } },
    },
  });

  const earningIds = earnings.map((e: any) => e.id);
  const sessionIds = earnings.map((e: any) => e.sessionId).filter(Boolean);

  const legacyPayments = sessionIds.length > 0
    ? await db.payment.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true, sessionId: true, staffId: true, netPay: true, paidAt: true, date: true } })
    : [];
  const legacyBySession = new Map<string, any>();
  for (const p of legacyPayments) if (p.sessionId) legacyBySession.set(p.sessionId, p);

  const dayStartUtc = new Date(`${date}T00:00:00.000+06:00`);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
  const paymentsPaidOnDate = await db.payment.findMany({
    where: { paidAt: { gte: dayStartUtc, lt: dayEndUtc }, ...(opts.staffId ? { staffId: opts.staffId } : {}) },
    select: {
      id: true, staffId: true, sessionId: true, netPay: true, paidAt: true, date: true,
      allocations: { select: { amount: true, payrollEarningId: true } },
    },
  });

  // Manual advance adjustments (append-only ledger)
  let manualAdjustments: any[] = [];
  let adjAvailable = true;
  let adjReason: string | undefined;
  try {
    if (db.advanceAdjustment && typeof db.advanceAdjustment.findMany === "function") {
      manualAdjustments = await db.advanceAdjustment.findMany({
        where: opts.staffId ? { staffId: opts.staffId } : {},
        select: { id: true, staffId: true, advanceLogId: true, payrollEarningId: true, amount: true, note: true, adjustedAt: true, adjustedBy: true, workDate: true, idempotencyKey: true },
      });
      adjAvailable = true;
    } else {
      adjAvailable = false; adjReason = "ADVANCE_ADJUSTMENT_LEDGER_UNAVAILABLE";
    }
  } catch (e) {
    // Distinguish failed request from empty ledger: do not fabricate zero/state on failure.
    adjAvailable = false;
    adjReason = e instanceof Error && e.message ? `ADVANCE_ADJUSTMENT_LEDGER_FAILED:${e.message}` : "ADVANCE_ADJUSTMENT_LEDGER_FAILED";
  }

  const earningById = new Map<string, any>();
  const earningBySession = new Map<string, any>();
  for (const e of earnings) { earningById.set(e.id, e); if (e.sessionId) earningBySession.set(e.sessionId, e); }
  const missingLegacySessionIds = paymentsPaidOnDate.filter((p: any) => p.sessionId && !earningBySession.has(p.sessionId)).map((p: any) => p.sessionId);
  const extraLegacyEarnings = missingLegacySessionIds.length > 0
    ? await db.payrollEarning.findMany({ where: { sessionId: { in: missingLegacySessionIds } }, select: { id: true, sessionId: true, periodStart: true, periodEnd: true, session: { select: { date: true } } } })
    : [];
  for (const e of extraLegacyEarnings) if (e.sessionId) earningBySession.set(e.sessionId, e);

  // Staff names
  const staffIdsNeeded = Array.from(new Set([...sessions.map((s: any) => s.staffId), ...earnings.map((e: any) => e.staffId), ...manualAdjustments.map((a: any) => a.staffId)]));
  const staffRows = staffIdsNeeded.length > 0 ? await db.staff.findMany({ where: { employeeId: { in: staffIdsNeeded } }, select: { employeeId: true, fullName: true } }) : [];
  const staffName = new Map(staffRows.map((s: any) => [s.employeeId, s.fullName ?? s.employeeId]));

  // Adjustment aggregates by earning and by staff/date
  const adjByEarning = new Map<string, number>();
  const adjByStaffAll = new Map<string, number>();
  const adjByStaffDate = new Map<string, number>();
  for (const a of manualAdjustments) {
    const amt = payRound(Number(a.amount) || 0);
    adjByEarning.set(a.payrollEarningId, payRound((adjByEarning.get(a.payrollEarningId) ?? 0) + amt));
    adjByStaffAll.set(a.staffId, payRound((adjByStaffAll.get(a.staffId) ?? 0) + amt));
    const d = dhakaDateKeyOf(a.adjustedAt);
    if (d) adjByStaffDate.set(`${a.staffId}|${d}`, payRound((adjByStaffDate.get(`${a.staffId}|${d}`) ?? 0) + amt));
  }

  let todayEarned = 0;
  let todayAvailable = 0;
  let olderAvailable = 0;
  let totalOutstanding = 0;
  let earningReadyCount = 0;
  let incompleteEarningCount = 0;
  let partiallyPaidCount = 0;
  let fullyPaidCount = 0;

  const rowCandidates: StaffPayableRow[] = [];

  // per-staff aggregates
  type Acc = { staffId: string; staffName: string; selEarned: number; selCash: number; selAdj: number; selRemaining: number; allEarned: number; allCash: number; allAdj: number; outstandingEarned: number; hasIncomplete: boolean };
  const acc = new Map<string, Acc>();
  const getAcc = (sid: string): Acc => { let v = acc.get(sid); if (!v) { v = { staffId: sid, staffName: (staffName.get(sid) ?? sid) as string, selEarned: 0, selCash: 0, selAdj: 0, selRemaining: 0, allEarned: 0, allCash: 0, allAdj: 0, outstandingEarned: 0, hasIncomplete: false }; acc.set(sid, v); } return v; };

  for (const e of earnings) {
    const workDate = earningWorkDateKey(e);
    const status = String(e.calculationStatus || "").toUpperCase();
    const net = payRound(Number(e.netEarning) || 0);
    const cashAlloc = payRound((e.allocations || []).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0));
    const manualAdj = adjByEarning.get(e.id) ?? 0;
    const legacySettled = legacyBySession.has(e.sessionId);
    const hasOpenSession = openSessionStaff.has(e.staffId) && e.session && !e.session.timeOut;
    const A = getAcc(e.staffId)!;
    A.staffName = e.staff?.fullName ?? A.staffName;

    if (status === "INCOMPLETE") {
      incompleteEarningCount += 1;
      A.hasIncomplete = true;
      rowCandidates.push({
        staffId: e.staffId, staffName: e.staff?.fullName ?? e.staffId, workDate,
        earningPeriod: { start: toIso(e.periodStart), end: toIso(e.periodEnd), kind: e.periodKind ?? null },
        payableHours: typeof e.payableHours === "number" ? Number(e.payableHours) : null,
        earnedAmount: null, previouslyAllocatedAmount: payRound(cashAlloc), manualAdvanceAdjustedAmount: manualAdj,
        remainingOutstandingAmount: 0, earningStatus: "INCOMPLETE",
        paymentStatus: hasOpenSession ? "WORKING" : "INCOMPLETE", paymentPermitted: false,
        earningId: e.id, sessionId: e.sessionId ?? null, isToday: workDate === date,
        isHistoricalOutstanding: workDate !== null && workDate < date, legacySettled,
      });
      continue;
    }
    if (status !== ELIGIBLE) continue;

    const effectiveCash = legacySettled ? net : cashAlloc;
    const effectiveAdj = legacySettled ? 0 : manualAdj;
    const outstanding = legacySettled ? 0 : payRound(Math.max(0, net - effectiveCash - effectiveAdj));
    const allocatableOutstanding = (!legacySettled && outstanding > EPS) ? outstanding : 0;

    A.allEarned = payRound(A.allEarned + net);
    A.allCash = payRound(A.allCash + (legacySettled ? net : cashAlloc));
    A.allAdj = payRound(A.allAdj + effectiveAdj);
    A.outstandingEarned = payRound(A.outstandingEarned + outstanding);

    if (workDate === date) {
      todayEarned = payRound(todayEarned + net);
      A.selEarned = payRound(A.selEarned + net);
      A.selRemaining = payRound(A.selRemaining + outstanding);
    }
    if (allocatableOutstanding > 0) {
      totalOutstanding = payRound(totalOutstanding + allocatableOutstanding);
      if (workDate === date) todayAvailable = payRound(todayAvailable + allocatableOutstanding);
      else olderAvailable = payRound(olderAvailable + allocatableOutstanding);
    }

    if (!legacySettled && outstanding <= EPS) fullyPaidCount += 1;
    else if (!legacySettled && (cashAlloc > EPS || manualAdj > EPS) && outstanding > EPS) partiallyPaidCount += 1;
    if (allocatableOutstanding > 0 && !hasOpenSession) earningReadyCount += 1;

    const st = statusOf("CALCULATED", outstanding, net, legacySettled, hasOpenSession, false);
    rowCandidates.push({
      staffId: e.staffId, staffName: e.staff?.fullName ?? e.staffId, workDate,
      earningPeriod: { start: toIso(e.periodStart), end: toIso(e.periodEnd), kind: e.periodKind ?? null },
      payableHours: typeof e.payableHours === "number" ? Number(e.payableHours) : null,
      earnedAmount: net, previouslyAllocatedAmount: legacySettled ? net : payRound(cashAlloc), manualAdvanceAdjustedAmount: legacySettled ? 0 : manualAdj,
      remainingOutstandingAmount: legacySettled ? 0 : outstanding, earningStatus: "CALCULATED",
      paymentStatus: st.paymentStatus, paymentPermitted: st.paymentPermitted,
      earningId: e.id, sessionId: e.sessionId ?? null, isToday: workDate === date,
      isHistoricalOutstanding: workDate !== null && workDate < date && allocatableOutstanding > 0, legacySettled,
    });
  }

  // Today's cash payments (by payment date, Asia/Dhaka) and attribution
  let todayPaid = 0;
  let todayPaidTowardToday = 0;
  let todayPaidTowardOlder = 0;
  let paidAttributionUnavailable = false;
  const cashByStaffDate = new Map<string, number>();

  for (const p of paymentsPaidOnDate) {
    const paidAmount = payRound(Number(p.netPay) || 0);
    todayPaid = payRound(todayPaid + paidAmount);
    // per-staff selected-date cash (by payment date) - record even if attribution uncertain
    const sk = `${p.staffId}|${date}`;
    cashByStaffDate.set(sk, payRound((cashByStaffDate.get(sk) ?? 0) + paidAmount));

    if (p.sessionId) {
      const e = earningBySession.get(p.sessionId);
      const wd = e ? earningWorkDateKey(e) : dhakaDateKeyOf(p.date);
      if (!wd) { paidAttributionUnavailable = true; continue; }
      if (wd === date) todayPaidTowardToday = payRound(todayPaidTowardToday + paidAmount);
      else todayPaidTowardOlder = payRound(todayPaidTowardOlder + paidAmount);
      continue;
    }
    const allocs = p.allocations || [];
    if (allocs.length === 0) {
      notes.push(`Payment ${p.id} paid on ${date} has no allocation rows; excluded from work-date attribution.`);
      paidAttributionUnavailable = true; continue;
    }
    for (const a of allocs) {
      const amt = payRound(Number(a.amount) || 0);
      let e = earningById.get(a.payrollEarningId);
      let wd: string | null = e ? earningWorkDateKey(e) : null;
      if (!wd) {
        const fe = await db.payrollEarning.findUnique({ where: { id: a.payrollEarningId }, select: { id: true, periodStart: true, periodEnd: true, session: { select: { date: true } } } });
        wd = fe ? earningWorkDateKey(fe) : null;
      }
      if (!wd) { paidAttributionUnavailable = true; continue; }
      if (wd === date) todayPaidTowardToday = payRound(todayPaidTowardToday + amt);
      else todayPaidTowardOlder = payRound(todayPaidTowardOlder + amt);
    }
  }

  // apply per-staff selected-date cash/adj
  for (const [sid, A] of acc) {
    A.selCash = cashByStaffDate.get(`${sid}|${date}`) ?? 0;
    A.selAdj = adjByStaffDate.get(`${sid}|${date}`) ?? 0;
  }

  // NOT_READY/WORKING rows for sessions without earnings
  const earningSessionSet = new Set(earnings.map((e: any) => e.sessionId));
  for (const s of sessionsForDate) {
    const sname = staffName.get(s.staffId) ?? s.staffId;
    if (s.timeOut && s.completed && !earningSessionSet.has(s.id)) {
      rowCandidates.push({ staffId: s.staffId, staffName: sname, workDate: date, earningPeriod: { start: dhakaDateKeyOf(s.date) ? `${dhakaDateKeyOf(s.date)}T00:00:00.000+06:00` : null, end: null, kind: null }, payableHours: null, earnedAmount: null, previouslyAllocatedAmount: 0, manualAdvanceAdjustedAmount: 0, remainingOutstandingAmount: 0, earningStatus: "NONE", paymentStatus: "NOT_READY", paymentPermitted: false, earningId: null, sessionId: s.id, isToday: true, isHistoricalOutstanding: false, legacySettled: false });
      notes.push(`Completed clocked-out session ${s.id} has no PayrollEarning; shown as NOT_READY.`);
    }
    if (!s.timeOut) {
      const hasEarningRow = rowCandidates.some(r => r.sessionId === s.id);
      if (!hasEarningRow) {
        rowCandidates.push({ staffId: s.staffId, staffName: sname, workDate: date, earningPeriod: { start: dhakaDateKeyOf(s.date) ? `${dhakaDateKeyOf(s.date)}T00:00:00.000+06:00` : null, end: null, kind: null }, payableHours: null, earnedAmount: null, previouslyAllocatedAmount: 0, manualAdvanceAdjustedAmount: 0, remainingOutstandingAmount: 0, earningStatus: "NONE", paymentStatus: "WORKING", paymentPermitted: false, earningId: null, sessionId: s.id, isToday: true, isHistoricalOutstanding: false, legacySettled: false });
      }
    }
  }

  rowCandidates.sort((a, b) => {
    const aToday = a.isToday ? 0 : 1; const bToday = b.isToday ? 0 : 1;
    if (aToday !== bToday) return aToday - bToday;
    const rank = (r: StaffPayableRow) => r.paymentStatus === "READY" ? 0 : r.paymentStatus === "PARTIAL" ? 1 : r.paymentStatus === "WORKING" ? 2 : r.paymentStatus === "INCOMPLETE" ? 3 : r.paymentStatus === "NOT_READY" ? 4 : 5;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ad = a.earningPeriod.start || a.workDate || ""; const bd = b.earningPeriod.start || b.workDate || "";
    if (ad !== bd) return ad.localeCompare(bd);
    if (a.staffName !== b.staffName) return a.staffName.localeCompare(b.staffName);
    return (a.earningId || a.sessionId || "").localeCompare(b.earningId || b.sessionId || "");
  });

  const totalRows = rowCandidates.length;
  const paged = rowCandidates.slice(offset, offset + limit);

  const attributionOk = !paidAttributionUnavailable && Math.abs(payRound(todayPaidTowardToday + todayPaidTowardOlder) - payRound(todayPaid)) <= 0.01;
  if (!attributionOk && paymentsPaidOnDate.length > 0) notes.push("Payment-to-work-date attribution could not be fully resolved from available data; split paid metrics marked unavailable.");
  if (!adjAvailable) notes.push(`Advance adjustment ledger unavailable: ${adjReason}.`);

  // Advances state/history
  let advanceStateUnavailable: string | null = null;
  let advanceLogs: any[] = [];
  let advancesAvailable = true;
  try {
    if (db.advanceLog && typeof db.advanceLog.findMany === "function") {
      advanceLogs = await db.advanceLog.findMany({ where: opts.staffId ? { staffId: opts.staffId } : {}, select: { id: true, staffId: true, type: true, amount: true, balanceAfter: true, note: true, createdAt: true, createdBy: true, paymentId: true } });
      advancesAvailable = true;
    } else {
      advancesAvailable = false; advanceStateUnavailable = "ADVANCE_LOG_UNAVAILABLE";
    }
  } catch (e) {
    advancesAvailable = false; advanceStateUnavailable = e instanceof Error && e.message ? `ADVANCE_LOG_FAILED:${e.message}` : "ADVANCE_LOG_FAILED";
  }

  // compute advances by staff
  const advGivenByStaff = new Map<string, number>();
  const advLegacyAdjByStaff = new Map<string, number>();
  for (const l of advanceLogs) {
    const amt = payRound(Number(l.amount) || 0);
    const t = String(l.type || "").toUpperCase();
    if (t === "GIVEN") advGivenByStaff.set(l.staffId, payRound((advGivenByStaff.get(l.staffId) ?? 0) + amt));
    else if (t === "ADJUSTED") advLegacyAdjByStaff.set(l.staffId, payRound((advLegacyAdjByStaff.get(l.staffId) ?? 0) + amt));
  }

  const totalOutstandingAdvances = advancesAvailable
    ? payRound(Array.from(new Set([...advGivenByStaff.keys(), ...advLegacyAdjByStaff.keys(), ...adjByStaffAll.keys(), ...(opts.staffId ? [opts.staffId] : [])])).reduce((s, sid) => {
        const given = advGivenByStaff.get(sid) ?? 0;
        const ladj = advLegacyAdjByStaff.get(sid) ?? 0;
        const madj = adjByStaffAll.get(sid) ?? 0;
        return payRound(s + Math.max(0, given - ladj - madj));
      }, 0))
    : null;

  const todayAdvanceAdjustments = adjAvailable ? payRound(manualAdjustments.filter((a: any) => dhakaDateKeyOf(a.adjustedAt) === date).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0)) : null;

  const staffAccounts: StaffAccountSummary[] = Array.from(acc.values()).map((A) => {
    const given = advGivenByStaff.get(A.staffId) ?? 0;
    const ladj = advLegacyAdjByStaff.get(A.staffId) ?? 0;
    const madj = adjByStaffAll.get(A.staffId) ?? 0;
    const totalAdj = payRound(ladj + madj);
    const outAdv = payRound(Math.max(0, given - totalAdj));
    return {
      staffId: A.staffId,
      staffName: A.staffName,
      selectedDateEarnedSalary: ok(A.selEarned),
      selectedDateCashPayments: ok(A.selCash),
      selectedDateAdvanceAdjustments: adjAvailable ? ok(A.selAdj) : unavailable(adjReason || "ADVANCE_ADJUSTMENT_UNAVAILABLE"),
      selectedDateRemainingPayable: ok(A.selRemaining),
      allTimeEarnedSalary: ok(A.allEarned),
      allTimeCashPayments: ok(A.allCash),
      allTimeAdvanceAdjustments: adjAvailable ? ok(madj) : unavailable(adjReason || "ADVANCE_ADJUSTMENT_UNAVAILABLE"),
      currentOutstandingEarnedSalary: ok(A.outstandingEarned),
      totalAdvancesReceived: advancesAvailable ? ok(given) : unavailable(advanceStateUnavailable || "ADVANCE_UNAVAILABLE"),
      totalAdvancesAdjusted: advancesAvailable ? ok(totalAdj) : unavailable(advanceStateUnavailable || "ADVANCE_UNAVAILABLE"),
      outstandingAdvances: advancesAvailable ? ok(outAdv) : unavailable(advanceStateUnavailable || "ADVANCE_UNAVAILABLE"),
      currentAdvanceBalance: advancesAvailable ? ok(outAdv) : unavailable(advanceStateUnavailable || "ADVANCE_UNAVAILABLE"),
    };
  }).sort((a, b) => a.staffName.localeCompare(b.staffName));

  // ensure staff with only advances appear if staffId scoped
  if (opts.staffId && !acc.has(opts.staffId) && advancesAvailable) {
    const given = advGivenByStaff.get(opts.staffId) ?? 0; const ladj = advLegacyAdjByStaff.get(opts.staffId) ?? 0; const madj = adjByStaffAll.get(opts.staffId) ?? 0; const outAdv = payRound(Math.max(0, given - ladj - madj));
    staffAccounts.push({ staffId: String(opts.staffId), staffName: String(staffName.get(String(opts.staffId)) ?? opts.staffId), selectedDateEarnedSalary: ok(0), selectedDateCashPayments: ok(0), selectedDateAdvanceAdjustments: adjAvailable ? ok(0) : unavailable(adjReason || "ADVANCE_ADJUSTMENT_UNAVAILABLE"), selectedDateRemainingPayable: ok(0), allTimeEarnedSalary: ok(0), allTimeCashPayments: ok(0), allTimeAdvanceAdjustments: adjAvailable ? ok(madj) : unavailable(adjReason || "ADVANCE_ADJUSTMENT_UNAVAILABLE"), currentOutstandingEarnedSalary: ok(0), totalAdvancesReceived: ok(given), totalAdvancesAdjusted: ok(payRound(ladj + madj)), outstandingAdvances: ok(outAdv), currentAdvanceBalance: ok(outAdv) });
  }

  const advanceItems: AdvanceHistoryItem[] = advancesAvailable ? advanceLogs.map((l: any) => ({
    id: String(l.id),
    staffId: String(l.staffId),
    staffName: staffName.get(String(l.staffId)) ?? null,
    type: String(l.type || ""),
    amount: payRound(Number(l.amount) || 0),
    balanceAfter: typeof l.balanceAfter === "number" ? Number(l.balanceAfter) : (l.balanceAfter == null ? null : Number(l.balanceAfter)),
    note: l.note ?? null,
    createdAt: toIso(l.createdAt) || new Date().toISOString(),
    createdBy: l.createdBy ?? null,
    paymentId: l.paymentId ?? null,
  } as AdvanceHistoryItem)).sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||"")) : [];
  const adjustmentItems: AdvanceAdjustmentItem[] = adjAvailable ? manualAdjustments.map((a: any) => ({
    id: String(a.id),
    staffId: String(a.staffId),
    staffName: staffName.get(String(a.staffId)) ?? null,
    advanceLogId: String(a.advanceLogId),
    payrollEarningId: String(a.payrollEarningId),
    workDate: a.workDate ?? null,
    amount: payRound(Number(a.amount) || 0),
    note: a.note ?? null,
    adjustedAt: toIso(a.adjustedAt) || new Date().toISOString(),
    adjustedBy: a.adjustedBy ?? null,
    idempotencyKey: String(a.idempotencyKey),
  } as AdvanceAdjustmentItem)).sort((a,b)=> (b.adjustedAt||"").localeCompare(a.adjustedAt||"")) : [];

  return {
    date,
    timezone: "Asia/Dhaka",
    generatedAt: new Date().toISOString(),
    summary: {
      todayEarnedAmount: ok(todayEarned),
      todayCashPaymentsAmount: ok(todayPaid),
      todayAdvanceAdjustmentsAmount: todayAdvanceAdjustments == null ? unavailable(adjReason || "ADVANCE_ADJUSTMENT_UNAVAILABLE") : ok(todayAdvanceAdjustments),
      todayPaidAmount: ok(todayPaid),
      todayAvailableAmount: ok(todayAvailable),
      todayAvailableFromOlderOutstandingAmount: ok(olderAvailable),
      todayPaidTowardTodayEarningsAmount: attributionOk ? ok(todayPaidTowardToday) : unavailable("PAYMENT_WORK_DATE_ATTRIBUTION_UNAVAILABLE"),
      todayPaidTowardOlderEarningsAmount: attributionOk ? ok(todayPaidTowardOlder) : unavailable("PAYMENT_WORK_DATE_ATTRIBUTION_UNAVAILABLE"),
      totalOutstandingAmount: ok(totalOutstanding),
      outstandingAdvancesAmount: totalOutstandingAdvances == null ? unavailable(advanceStateUnavailable || "ADVANCE_UNAVAILABLE") : ok(totalOutstandingAdvances),
      clockedOutCount: cok(clockedOutForDate.length),
      stillWorkingCount: cok(stillWorkingForDate.length),
      earningReadyCount: cok(earningReadyCount),
      incompleteEarningCount: cok(incompleteEarningCount),
      partiallyPaidCount: cok(partiallyPaidCount),
      fullyPaidCount: cok(fullyPaidCount),
    },
    staffPayables: { rows: paged, total: totalRows, limit, offset, hasMore: offset + paged.length < totalRows },
    staffAccounts,
    advances: { available: advancesAvailable && adjAvailable, ...(advancesAvailable && adjAvailable ? {} : { reason: (!advancesAvailable ? advanceStateUnavailable : adjReason) || "UNAVAILABLE" }), items: advanceItems, adjustments: adjustmentItems },
    notes,
  };
}



