"use client";

import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Modal } from "./Modal";
import { PhotoAvatar } from "./PhotoAvatar";
import { StatusBadge } from "./StatusBadge";
import { Button, Field, Input } from "./ui";
import { Icon, type IconName } from "./icons";
import { Money } from "./Money";
import { computeSession } from "../lib/timeclock";
import { formatBDT, payRound } from "../lib/currency";
import { formatDate, formatDuration, formatTime12, monthKey } from "../lib/dates";
import { cn } from "../lib/utils";
import type { Employee, LeaveType } from "../types";

type Tab = "attendance" | "payments" | "leave";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "attendance", label: "Attendance", icon: "clock" },
  { key: "payments", label: "Payments & Advance", icon: "banknote" },
  { key: "leave", label: "Leave & Balances", icon: "calendar" },
];

const LEAVE_TYPES: LeaveType[] = ["Annual", "Sick", "Casual", "Maternity", "Paternity", "Unpaid"];

const TYPE_COLORS: Record<LeaveType, string> = {
  Annual: "bg-primary-soft text-primary ring-primary/25",
  Sick: "bg-rose-50 text-rose-700 ring-rose-200",
  Casual: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Maternity: "bg-pink-50 text-pink-700 ring-pink-200",
  Paternity: "bg-sky-50 text-sky-700 ring-sky-200",
  Unpaid: "bg-surface-muted text-muted-foreground ring-edge",
};

export function StaffDetailModal({ staff, open, onClose }: {
  staff: Employee | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data, todaySession, isOnLeaveToday, paySessions, takeAdvance, canPerm } = useApp();
  const [tab, setTab] = useState<Tab>("attendance");
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmt, setAdvanceAmt] = useState("");
  const now = Date.now();

  const todaySess = staff ? todaySession(staff.employeeId) : undefined;
  const onLeaveToday = staff ? isOnLeaveToday(staff.employeeId) : false;
  const todayCalc = staff ? computeSession(todaySess, staff, data.config, now) : null;

  // ---- day-wise unpaid dues (clocked-out shifts with no payment yet) ------
  const dues = useMemo(() => {
    if (!staff) return [];
    const paidIds = new Set(data.payments.map((p) => p.sessionId));
    return data.sessions
      .filter((s) => s.staffId === staff.employeeId && s.timeOut && !paidIds.has(s.id))
      .map((s) => ({
        session: s,
        calc: computeSession(s, staff, data.config, new Date(s.timeOut!).getTime()),
      }))
      .sort((a, b) => a.session.date.localeCompare(b.session.date));
  }, [staff, data.sessions, data.payments, data.config]);

  // ---- all sessions, newest first -----------------------------------------
  const sessions = useMemo(() => {
    if (!staff) return [];
    return data.sessions
      .filter((s) => s.staffId === staff.employeeId)
      .sort((a, b) => (b.date === a.date ? b.timeIn.localeCompare(a.timeIn) : b.date.localeCompare(a.date)));
  }, [data.sessions, staff]);

  // ---- aggregate stats (all-time + current month) --------------------------
  const sessionStats = useMemo(() => {
    if (!staff) {
      return {
        all: { count: 0, workedMin: 0, net: 0, late: 0, otMin: 0, overMin: 0 },
        month: { count: 0, workedMin: 0, net: 0, late: 0, otMin: 0, overMin: 0 },
      };
    }
    const key = monthKey(new Date());
    const zero = { count: 0, workedMin: 0, net: 0, late: 0, otMin: 0, overMin: 0 };
    const all = { ...zero };
    const month = { ...zero };
    for (const s of sessions) {
      const calc = computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now);
      all.count++; all.workedMin += calc.grossMin; all.net += calc.netPay;
      if (calc.isLate) all.late++; all.otMin += calc.overtimeMin; all.overMin += calc.overBreakMin;
      if (s.date.startsWith(key)) {
        month.count++; month.workedMin += calc.grossMin; month.net += calc.netPay;
        if (calc.isLate) month.late++; month.otMin += calc.overtimeMin; month.overMin += calc.overBreakMin;
      }
    }
    return {
      all: { ...all, net: payRound(all.net) },
      month: { ...month, net: payRound(month.net) },
    };
  }, [staff, sessions, data.config, now]);

  // ---- payments & advances ------------------------------------------------
  const payments = useMemo(() => {
    if (!staff) return [];
    return data.payments
      .filter((p) => p.staffId === staff.employeeId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.payments, staff]);

  const paySummary = useMemo(() => ({
    total: payRound(payments.reduce((s, p) => s + p.netPay, 0)),
    ot: payRound(payments.reduce((s, p) => s + p.overtimePay, 0)),
    over: payRound(payments.reduce((s, p) => s + p.overBreakDeduction, 0)),
  }), [payments]);

  // ---- leave records & balances -------------------------------------------
  const leaves = useMemo(() => {
    if (!staff) return [];
    return data.leaveRequests
      .filter((r) => r.staffId === staff.employeeId)
      .sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  }, [data.leaveRequests, staff]);

  const balances = useMemo(() => {
    if (!staff) return [];
    return data.leaveBalances.filter((b) => b.staffId === staff.employeeId);
  }, [data.leaveBalances, staff]);

  if (!staff || !open) return null;

  const todayPill: { label: string; cls: string; dot: string } = onLeaveToday
    ? { label: "On leave today", cls: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" }
    : !todaySess
      ? { label: "Not clocked in", cls: "bg-surface-muted text-muted-foreground ring-edge", dot: "bg-slate-300" }
      : todayCalc?.clockStatus === "completed"
        ? { label: "Clocked out", cls: "bg-surface-muted text-muted-foreground ring-edge", dot: "bg-slate-400" }
        : ({
            working: { label: "On duty", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
            "on-meal": { label: "On meal break", cls: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500" },
            "on-rest": { label: "On rest break", cls: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
            "on-unpaid": { label: "Unpaid break", cls: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
            "on-goout": { label: "On go-out", cls: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500" },
            "on-leave": { label: "On leave", cls: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
            off: { label: "Not clocked in", cls: "bg-surface-muted text-muted-foreground ring-edge", dot: "bg-slate-300" },
          } as const)[todayCalc?.clockStatus ?? "off"]
            ?? { label: "Not clocked in", cls: "bg-surface-muted text-muted-foreground ring-edge", dot: "bg-slate-300" };
return (<>
    <Modal open={open} onClose={onClose} size="xl" icon="users2" title="Staff Profile"
      subtitle={`${staff.role === "SUPERVISOR" ? "Supervisor" : "Staff"} · ${staff.employeeId}`}>
      <div className="space-y-4">
        {/* ================= Profile hero ================= */}
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-primary-deep via-primary to-primary-bright p-5 text-white shadow-lg shadow-primary/30">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={68} ring={false} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-bold tracking-tight">{staff.fullName}</h3>
                {staff.role === "SUPERVISOR" && (
                  <span className="rounded-full bg-primary/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-bright ring-1 ring-inset ring-primary/30">Supervisor</span>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-blue-100/90">{staff.jobTitle} · {staff.department}</p>
              <p className="mt-0.5 truncate text-xs text-blue-100/80">
                {staff.employeeId}{staff.section ? ` · ${staff.section}` : ""}{staff.counter ? ` · Counter ${staff.counter}` : ""}
              </p>
            </div>
            <div className="text-right">
              <StatusBadge status={staff.status} />
              <p className="mt-1.5 text-xs text-blue-100/90">
                <span className="text-faint-foreground">{staff.salaryType} ·</span>{" "}
                <span className="font-semibold text-white">{salaryText(staff)}</span>
              </p>
            </div>
          </div>

          {/* stat chips */}
          <div className="relative mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HeroChip label="Today" value={todayPill.label} dot dotCls={todayPill.dot} cls={cn("ring-1 ring-inset", todayPill.cls)} />
            <HeroChip label="Sessions · this month" value={String(sessionStats.month.count)} />
            <HeroChip label="Worked · this month" value={formatDuration(sessionStats.month.workedMin)} />
            <HeroChip label="Net · this month" value={formatBDT(sessionStats.month.net, false)} />
          </div>
        </div>

        {/* ================= Tabs ================= */}
        <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                tab === t.key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}>
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ))}
        </div>
{/* ================= ATTENDANCE TAB ================= */}
        {tab === "attendance" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniTile icon="clock" tone="indigo" label="All-time shifts" value={String(sessionStats.all.count)} sub={formatBDT(sessionStats.all.net, false)} />
              <MiniTile icon="alert" tone="amber" label="Late arrivals" value={String(sessionStats.all.late)} sub={`${sessionStats.all.late} of ${sessionStats.all.count} shifts`} />
              <MiniTile icon="trendUp" tone="emerald" label="Overtime" value={formatDuration(sessionStats.all.otMin)} sub="time past shift end" />
              <MiniTile icon="timer" tone="rose" label="Over-break" value={formatDuration(sessionStats.all.overMin)} sub="deducted time" />
            </div>

            <div className="overflow-hidden rounded-xl border border-edge">
              <div className="border-b border-edge bg-surface-muted/70 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attendance History · {sessions.length} sessions</p>
              </div>
              {sessions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-faint-foreground">No clock-in records yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
                        <th className="px-4 py-2">Date</th>
                        <th className="px-2 py-2">In</th>
                        <th className="px-2 py-2">Out</th>
                        <th className="px-2 py-2 text-right">Worked</th>
                        <th className="px-2 py-2">Late</th>
                        <th className="px-2 py-2 text-right">Breaks</th>
                        <th className="px-2 py-2 text-right">OT</th>
                        <th className="px-4 py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {sessions.map((s) => {
                        const c = computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now);
                        return (
                          <tr key={s.id} className="hover:bg-surface-muted/70">
                            <td className="whitespace-nowrap px-4 py-2 font-medium text-foreground">
                              {formatDate(s.date)}
                              {!s.shiftStartMin && <span title="Recorded before shift snapshots existed — evaluated against the staff member's current shift" className="ml-1.5 rounded bg-surface-muted px-1.5 py-px align-middle text-[10px] font-medium text-faint-foreground">legacy</span>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{formatTime12(s.timeIn)}</td>
                            <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{s.timeOut ? formatTime12(s.timeOut) : <span className="text-faint-foreground">—</span>}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">{formatDuration(c.grossMin)}</td>
                            <td className="px-2 py-2">{c.isLate ? <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">+{formatDuration(c.lateMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                            <td className="px-2 py-2 text-right">
                              {s.breaks.length > 0
                                ? <span className="tabular-nums text-muted-foreground">{s.breaks.length}{c.overBreakMin > 0 && <span className="ml-1 text-[10px] font-semibold text-rose-500">+{formatDuration(c.overBreakMin)}</span>}</span>
                                : <span className="text-faint-foreground">—</span>}
                            </td>
                            <td className="px-2 py-2 text-right">{c.overtimeMin > 0 ? <span className="font-semibold tabular-nums text-emerald-600">{formatDuration(c.overtimeMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                            <td className="px-4 py-2 text-right"><Money value={c.netPay} className="text-xs text-emerald-600" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
{/* ================= PAYMENTS TAB ================= */}
{tab === "payments" && (
          <div className="space-y-3">
            {canPerm("pay.staff") && (
              <div className="flex items-center justify-end">
                <Button size="sm" variant="secondary" icon="handCoin"
                  onClick={() => { setAdvanceAmt(""); setAdvanceOpen(true); }}>
                  Give Advance
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <MiniTile icon="wallet" tone="emerald" label="Total paid" value={formatBDT(paySummary.total, false)} sub={`${payments.length} payouts`} />
              <MiniTile icon="handCoin" tone="amber" label="Outstanding advance" value={formatBDT(staff.advance, false)} sub="auto-deducted next payout" />
              <MiniTile icon="alert" tone="rose" label="Arrears due" value={formatBDT(staff.arrears, false)} sub="unpaid daily-wage carry" />
            </div>

            {/* ---- Day-wise outstanding dues (clock-out dependent) ---- */}
            <div className="overflow-hidden rounded-xl border border-edge">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-surface-muted/70 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outstanding Dues · {dues.length} day{dues.length === 1 ? "" : "s"}</p>
                {canPerm("pay.staff") && dues.length > 0 && (
                  <Button size="sm" variant="success" icon="check"
                    onClick={() => paySessions(dues.map((d) => d.session.id))}>
                    Pay Now — {formatBDT(dues.reduce((s, d) => s + d.calc.netPay, 0), false)}
                  </Button>
                )}
              </div>
              {dues.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-faint-foreground">No outstanding dues — all completed shifts are settled.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
                        <th className="px-4 py-2">Date</th>
                        <th className="px-2 py-2 text-right">Hours</th>
                        <th className="px-2 py-2 text-right">OT</th>
                        <th className="px-4 py-2 text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {dues.map(({ session, calc }) => (
                        <tr key={session.id} className="hover:bg-surface-muted/70">
                          <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-foreground">{formatDate(session.date)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(calc.grossMin)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{calc.overtimeMin > 0 ? <span className="font-semibold text-emerald-600">{formatBDT(calc.overtimePay, false)}</span> : "—"}</td>
                          <td className="px-4 py-2 text-right"><Money value={calc.netPay} className="text-sm text-amber-600" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border border-edge">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-surface-muted/70 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment History · {payments.length} records</p>
                {paySummary.ot > 0 && <p className="text-[11px] text-faint-foreground">incl. <span className="font-semibold text-emerald-600">{formatBDT(paySummary.ot, false)}</span> overtime</p>}
              </div>
              {payments.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-faint-foreground">No payments recorded for this staff member.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
                        <th className="px-4 py-2">Shift Day</th>
                        <th className="px-2 py-2">Period</th>
                        <th className="px-2 py-2 text-right">Duty</th>
                        <th className="px-2 py-2 text-right">Worked</th>
                        <th className="px-2 py-2 text-right">Over-brk</th>
                        <th className="px-2 py-2 text-right">OT pay</th>
                        <th className="px-2 py-2 text-right">Net</th>
                        <th className="px-4 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {payments.map((p) => (
                        <tr key={p.id} className="hover:bg-surface-muted/70">
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-foreground">{formatDate(p.date)}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{p.periodLabel}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(p.dutyHours * 60)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(p.workedMin)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{p.overBreakMin > 0 ? <span className="font-semibold text-rose-500">{formatBDT(p.overBreakDeduction, false)}</span> : "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{p.overtimePay > 0 ? <span className="font-semibold text-emerald-600">{formatBDT(p.overtimePay, false)}</span> : "—"}</td>
                          <td className="px-2 py-2 text-right"><Money value={p.netPay} className="text-xs text-emerald-600" /></td>
                          <td className="px-4 py-2 text-right"><StatusBadge status={p.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
{/* ================= LEAVE TAB ================= */}
        {tab === "leave" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-edge p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon name="calendar" size={14} className="text-amber-600" /> Leave Balances · {new Date().getFullYear()}
              </p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {LEAVE_TYPES.map((lt) => {
                  const b = balances.find((x) => x.leaveType === lt);
                  const entitled = b?.entitledDays ?? 0;
                  const used = b?.usedDays ?? 0;
                  const rem = Math.max(0, entitled - used);
                  return (
                    <div key={lt}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">{lt}</span>
                        <span className="tabular-nums text-muted-foreground">{entitled > 0 ? <><span className="font-semibold text-emerald-600">{rem}</span> / {entitled}d left</> : "—"}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-emerald-400" style={{ width: `${entitled > 0 ? Math.min(100, (rem / entitled) * 100) : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-edge">
              <div className="border-b border-edge bg-surface-muted/70 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leave Requests · {leaves.length} records</p>
              </div>
              {leaves.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-faint-foreground">No leave requests on record.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
                        <th className="px-4 py-2">Type</th>
                        <th className="px-2 py-2">From</th>
                        <th className="px-2 py-2">To</th>
                        <th className="px-2 py-2 text-right">Days</th>
                        <th className="px-2 py-2">Reason</th>
                        <th className="px-4 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {leaves.map((r) => (
                        <tr key={r.recordId} className="hover:bg-surface-muted/70">
                          <td className="px-4 py-2">
                            <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", TYPE_COLORS[r.leaveType])}>{r.leaveType}</span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{formatDate(r.fromDate)}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{formatDate(r.toDate)}</td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">{r.days}</td>
                          <td className="max-w-[10rem] truncate px-2 py-2 text-muted-foreground" title={r.reason}>{r.reason || "—"}</td>
                          <td className="px-4 py-2 text-right"><StatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
      {advanceOpen && staff && (
        <Modal open onClose={() => setAdvanceOpen(false)} size="md" title="Give Advance"
          subtitle={staff.fullName} icon="handCoin"
          footer={<>
            <Button variant="ghost" onClick={() => setAdvanceOpen(false)}>Cancel</Button>
            <Button variant="success" icon="check" disabled={!Number(advanceAmt)}
              onClick={() => { takeAdvance(staff.employeeId, Number(advanceAmt)); setAdvanceOpen(false); }}>Log Advance</Button>
          </>}>
          <Field label="Advance Amount (৳)" hint="Automatically deducted from the next payout.">
            <Input type="number" value={advanceAmt} onChange={(e) => setAdvanceAmt(e.target.value)} placeholder="e.g. 500" />
          </Field>
          <p className="mt-3 text-center text-xs text-faint-foreground">
            Current outstanding advance: ৳{formatBDT(staff.advance, false)}
          </p>
        </Modal>
      )}
    </>
  );
}
// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function salaryText(s: Employee): string {
  if (s.salaryType === "Daily") return `${formatBDT(s.dailyRate, false)}/day`;
  if (s.salaryType === "Hourly") return `${formatBDT(s.hourlyRate, false)}/hr`;
  if (s.salaryType === "Weekly") return `${formatBDT(s.baseSalary, false)}/wk`;
  return `${formatBDT(s.baseSalary, false)}/mo`;
}

function HeroChip({ label, value, dot, dotCls, cls }: { label: string; value: string; dot?: boolean; dotCls?: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10 backdrop-blur-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-faint-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm font-bold tabular-nums", dot && cls)}>
        {dot && <span className={cn("mr-1.5 inline-block h-2 w-2 rounded-full align-middle", dotCls)} />}
        {value}
      </p>
    </div>
  );
}

function MiniTile({ icon, tone, label, value, sub }: {
  icon: IconName; tone: "indigo" | "emerald" | "amber" | "rose";
  label: string; value: string; sub?: string;
}) {
  const c = {
    indigo: "bg-primary-soft text-primary", emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600",
  }[tone];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface p-3 shadow-card">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", c)}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-faint-foreground">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-foreground">{value}</p>
        {sub && <p className="truncate text-[11px] text-faint-foreground">{sub}</p>}
      </div>
    </div>
  );
}