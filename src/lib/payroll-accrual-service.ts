// Server-only accrual service; reuses pure core (computeAccrual/period/rate policy) and canonical engine.
import { payRound } from "./currency";
import { computeAccrual, type AccrualConfig, type AccrualResult, type AccrualSource, type StaffRow, type SessionRow } from "./payroll-accrual-core";

export { computeAccrual, resolvePeriod, deriveHourlyRate, daysInMonth } from "./payroll-accrual-core";
export type { AccrualConfig, AccrualResult, AccrualSource } from "./payroll-accrual-core";
export type AccrualActor = { name: string; role: string } | null;
export type AccrualTx = {
  timeSession: any; staff: any; payrollEarning: any; auditLog: any; paymentAllocation?: any; payment?: any;
};

function earningData(calc: ReturnType<typeof computeAccrual>, staff: any, session: any, input: { actor: AccrualActor; source: AccrualSource }) {
  const payable = calc.payout;
  const accrualIdempotencyKey = "accrual:session:" + session.id;
  return {
    earning: {
      sessionId: session.id, staffId: session.staffId,
      salaryType: String(staff.salaryType || "").toUpperCase(),
      applicableSalary: calc.applicableSalary ?? null,
      dailyDutyHours: calc.dutyHours ?? null,
      workingDaysPerWeek: calc.period.weeklyWorkingDays ?? null,
      weeklyScheduledHours: calc.period.weeklyWorkingDays && calc.dutyHours ? calc.period.weeklyWorkingDays * calc.dutyHours : null,
      monthlyCalendarDays: calc.period.monthlyCalendarDays ?? null,
      monthlyScheduledHours: calc.period.monthlyCalendarDays && calc.dutyHours ? calc.period.monthlyCalendarDays * calc.dutyHours : null,
      periodKind: calc.period.kind, periodKey: calc.period.key, periodStart: calc.period.start, periodEnd: calc.period.end,
      hourlyRate: calc.hourlyRate ?? null,
      payableHours: payable ? payRound(payable.basicMin / 60, 4) : null,
      payableMinutes: payable ? Math.round(payable.basicMin) : null,
      grossEarning: payable ? payable.grossPay : 0,
      overtimeEarning: payable ? payable.overtimePay : 0,
      deductionAmount: payable ? payable.overBreakDeduction : 0,
      netEarning: payable ? payable.netPay : 0,
      calculationStatus: calc.status, incompleteReason: calc.reason ?? null,
      calculatedAt: new Date(), calculatedBy: input.actor?.name ?? null,
      sourceType: input.source, sourceRef: session.id, accrualIdempotencyKey,
    },
    sessionSnap: {
      payrollSalaryType: String(staff.salaryType || "").toUpperCase(),
      payrollApplicableSalary: calc.applicableSalary ?? null,
      payrollPeriodKind: calc.period.kind,
      payrollPeriodKey: calc.period.key,
      payrollPeriodStart: calc.period.start,
      payrollPeriodEnd: calc.period.end,
      weeklyWorkingDaysSnapshot: calc.period.weeklyWorkingDays ?? null,
      weeklyScheduledHoursSnapshot: calc.period.weeklyWorkingDays && calc.dutyHours ? calc.period.weeklyWorkingDays * calc.dutyHours : null,
      monthlyCalendarDaysSnapshot: calc.period.monthlyCalendarDays ?? null,
      monthlyScheduledHoursSnapshot: calc.period.monthlyCalendarDays && calc.dutyHours ? calc.period.monthlyCalendarDays * calc.dutyHours : null,
      scheduledDutyHoursSnapshot: calc.dutyHours ?? null,
      payrollCalculationStatus: calc.status,
      payrollIncompleteReason: calc.reason ?? null,
      payrollSnapshotAt: new Date(),
      payrollSnapshotBy: input.actor?.name ?? null,
      payableHoursSnapshot: payable ? payRound(payable.basicMin / 60, 4) : null,
      payableMinutesSnapshot: payable ? Math.round(payable.basicMin) : null,
      grossEarningSnapshot: payable ? payable.grossPay : null,
      overtimeEarningSnapshot: payable ? payable.overtimePay : null,
      deductionSnapshot: payable ? payable.overBreakDeduction : null,
      netEarningSnapshot: payable ? payable.netPay : null,
      dailyDutyHoursSnapshot: session.dailyDutyHoursSnapshot ?? calc.dutyHours ?? null,
      hourlyRateSnapshot: payable?.hourlyRate ?? calc.hourlyRate ?? null,
    },
  };
}

async function isEarningLocked(tx: AccrualTx, earningId: string, sessionId: string): Promise<boolean> {
  if (tx.paymentAllocation) {
    const allocCount = await tx.paymentAllocation.count({ where: { payrollEarningId: earningId } });
    if (allocCount > 0) return true;
  }
  if (tx.payment) {
    const legacy = await tx.payment.findFirst({ where: { sessionId }, select: { id: true } });
    if (legacy) return true;
  }
  return false;
}

/**
 * Idempotent accrual for completed sessions.
 * - No earning: create (CALCULATED or INCOMPLETE).
 * - Existing INCOMPLETE: recover only via authorized retry/reconciliation sources (RETRY/OVERTIME_DECISION/SYSTEM) using authoritative DB staff+session; never create duplicate.
 * - Existing CALCULATED on normal RETRY: no silent overwrite -> EXISTS. OVERTIME_DECISION may reconcile unlocked CALCULATED via service (OT payable snapshot refresh) with settlement lock.
 * - Settled/locked (allocations or legacy Payment.sessionId): EARNING_LOCKED_SETTLED.
 * Never trusts client-supplied financial values/snapshots.
 */
export async function accrueCompletedSession(
  tx: AccrualTx,
  input: { sessionId: string; actor: AccrualActor; source: AccrualSource; config: AccrualConfig; allowCalculatedReconcile?: boolean }
): Promise<AccrualResult> {
  const session = await tx.timeSession.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (!session.completed || !session.timeOut) return { created: false, skipped: session.timeOut ? "NOT_COMPLETED" : "NO_TIMEOUT" };

  const existing = await tx.payrollEarning.findUnique({ where: { sessionId: session.id }, select: { id: true, calculationStatus: true } });
  if (existing) {
    const status = String(existing.calculationStatus || "").toUpperCase();
    const locked = await isEarningLocked(tx, existing.id, session.id);
    if (locked) return { created: false, skipped: "EARNING_LOCKED_SETTLED", earningId: existing.id, status: status as any, reason: "EARNING_LOCKED_SETTLED" };

    const isRecoverySource = input.source === "RETRY" || input.source === "OVERTIME_DECISION" || input.source === "SYSTEM" || input.source === "MANUAL_CLOSE";
    const canRecoverIncomplete = status === "INCOMPLETE" && isRecoverySource;
    // Reconcile unlocked CALCULATED earnings when OT becomes authoritatively payable/finalized (e.g. supervisor-authorized OT at manual clock-out).
    const canReconcileCalculated = status === "CALCULATED" && (input.source === "OVERTIME_DECISION" || input.source === "MANUAL_CLOSE") && input.allowCalculatedReconcile === true;

    if (!canRecoverIncomplete && !canReconcileCalculated) {
      return { created: false, skipped: "EXISTS", earningId: existing.id, status: status as any };
    }

    // Authorized recovery/reconciliation: re-read authoritative staff+session from DB, recalc via canonical+approved policies.
    const staff = await tx.staff.findUnique({ where: { employeeId: session.staffId } });
    if (!staff) throw new Error("STAFF_NOT_FOUND");
    const calc = computeAccrual(staff as StaffRow, session as SessionRow, input.config);
    const { earning, sessionSnap } = earningData(calc, staff, session, input);

    // Concurrency-safe conditional update (only while still same status and unlocked state checked in-tx context).
    const changed = await tx.payrollEarning.updateMany({
      where: { id: existing.id, sessionId: session.id, calculationStatus: existing.calculationStatus },
      data: { ...earning, accrualIdempotencyKey: "accrual:session:" + session.id },
    });
    if (changed.count !== 1) {
      const row = await tx.payrollEarning.findUnique({ where: { sessionId: session.id }, select: { id: true, calculationStatus: true } });
      return { created: false, skipped: "EXISTS", earningId: row?.id ?? existing.id, status: (row?.calculationStatus as any) || (status as any) };
    }
    await tx.timeSession.update({ where: { id: session.id }, data: sessionSnap });
    await tx.auditLog.create({
      data: {
        action: status === "INCOMPLETE"
          ? (calc.status === "CALCULATED" ? "PAYROLL_ACCRUAL_RECOVERED" : "PAYROLL_ACCRUAL_INCOMPLETE_RETAINED")
          : "PAYROLL_ACCRUAL_RECONCILED",
        entityType: "PayrollEarning", entityId: existing.id,
        actorName: input.actor?.name ?? "System", actorRole: input.actor?.role ?? "SYSTEM",
        summary: status === "INCOMPLETE"
          ? (calc.status === "CALCULATED"
            ? "Recovered incomplete payroll earning for " + (staff.fullName ?? session.staffId) + " session " + session.id + " net=" + (calc.payout?.netPay?.toFixed(2) ?? "0.00")
            : "Incomplete payroll earning remains incomplete for " + (staff.fullName ?? session.staffId) + " session " + session.id + ": " + (calc.reason ?? "unknown"))
          : "Reconciled payroll earning for " + (staff.fullName ?? session.staffId) + " session " + session.id,
        reason: calc.reason ?? null,
        after: { calculationStatus: calc.status, netEarning: calc.payout?.netPay ?? 0 },
      },
    });
    return { created: false, recovered: true, earningId: existing.id, status: calc.status, reason: calc.reason };
  }

  const staff = await tx.staff.findUnique({ where: { employeeId: session.staffId } });
  if (!staff) throw new Error("STAFF_NOT_FOUND");

  const calc = computeAccrual(staff as StaffRow, session as SessionRow, input.config);
  const { earning, sessionSnap } = earningData(calc, staff, session, input);

  try {
    const created = await tx.payrollEarning.create({ data: earning, select: { id: true } });
    await tx.timeSession.update({ where: { id: session.id }, data: sessionSnap });
    await tx.auditLog.create({
      data: {
        action: calc.status === "INCOMPLETE" ? "PAYROLL_ACCRUAL_INCOMPLETE" : "PAYROLL_ACCRUAL_CREATED",
        entityType: "PayrollEarning", entityId: created.id,
        actorName: input.actor?.name ?? "System", actorRole: input.actor?.role ?? "SYSTEM",
        summary: calc.status === "INCOMPLETE"
          ? "Payroll accrual incomplete for " + (staff.fullName ?? session.staffId) + " session " + session.id + ": " + calc.reason
          : "Payroll earning accrued for " + (staff.fullName ?? session.staffId) + " session " + session.id + " net=" + (calc.payout?.netPay?.toFixed(2) ?? "0.00"),
        reason: calc.reason ?? null,
      },
    });
    return { created: true, earningId: created.id, status: calc.status, reason: calc.reason };
  } catch (e: any) {
    if (e?.code === "P2002") {
      const row = await tx.payrollEarning.findUnique({ where: { sessionId: session.id }, select: { id: true, calculationStatus: true } });
      return { created: false, skipped: "EXISTS", earningId: row?.id, status: (row?.calculationStatus as any) || undefined };
    }
    throw e;
  }
}
