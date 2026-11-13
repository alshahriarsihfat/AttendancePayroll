"use client";

import { useMemo, useState, useEffect } from "react";
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

// Advance UX in this modal uses existing context/action only (no second adjustment implementation).
// Policy: advances are separate from earned salary, never auto-deducted; only supervisor-explicit manual adjustment is allowed via authoritative payroll flows.

type Tab = "attendance" | "payments" | "leave" | "departments" | "responsibilities";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "attendance", label: "Attendance", icon: "clock" },
  { key: "payments", label: "Payments", icon: "receipt" },
  { key: "leave", label: "Leave", icon: "calendar" },
];

const LEAVE_TYPES: LeaveType[] = ["Annual", "Sick", "Earned", "Casual", "Maternity", "Paternity", "Unpaid"];

const TYPE_COLORS: Record<LeaveType, string> = {
  Annual: "bg-primary-soft text-primary ring-primary/25",
  Sick: "bg-rose-50 text-rose-700 ring-rose-200",
  Earned: "bg-amber-50 text-amber-700 ring-amber-200",
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
  const { data, todaySession, isOnLeaveToday, takeAdvance, canPerm, navigate } = useApp();
  const [tab, setTab] = useState<Tab>("attendance");
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmt, setAdvanceAmt] = useState("");
  const [deptList, setDeptList] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [deptAssignments, setDeptAssignments] = useState<any[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [deptSaving, setDeptSaving] = useState(false);
  const [respList, setRespList] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [respAssignments, setRespAssignments] = useState<any[]>([]);
  const [respLoading, setRespLoading] = useState(false);
  const [respError, setRespError] = useState("");
  const [selectedResp, setSelectedResp] = useState("");
  const [respSaving, setRespSaving] = useState(false);
  const now = Date.now();

  const todaySess = staff ? todaySession(staff.employeeId) : undefined;
  const onLeaveToday = staff ? isOnLeaveToday(staff.employeeId) : false;
  const todayCalc = staff ? computeSession(todaySess, staff, data.config, now) : null;

  useEffect(() => {
    if (!staff || tab !== "departments") return;
    setDeptLoading(true); setDeptError("");
    Promise.all([
      fetch("/api/departments", { credentials: "same-origin" }).then((r) => r.json()),
      fetch(`/api/staff-departments?staffId=${staff.employeeId}`, { credentials: "same-origin" }).then((r) => r.json()),
    ])
      .then(([d, a]) => {
        setDeptList(Array.isArray(d.departments) ? d.departments : []);
        setDeptAssignments(Array.isArray(a.assignments) ? a.assignments : []);
      })
      .catch(() => setDeptError("Failed to load"))
      .finally(() => setDeptLoading(false));
  }, [staff, tab]);

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

  useEffect(() => {
    if (!staff || tab !== "responsibilities") return;
    setRespLoading(true); setRespError("");
    Promise.all([
      fetch("/api/responsibilities", { credentials: "same-origin" }).then((r) => r.json()),
      fetch(`/api/staff-responsibilities?staffId=${staff.employeeId}`, { credentials: "same-origin" }).then((r) => r.json()),
    ])
      .then(([d, a]) => {
        setRespList(Array.isArray(d.responsibilities) ? d.responsibilities : []);
        setRespAssignments(Array.isArray(a.assignments) ? a.assignments : []);
      })
      .catch(() => setRespError("Failed to load"))
      .finally(() => setRespLoading(false));
  }, [staff, tab]);

  const assignResp = async () => {
    if (!staff || !selectedResp || respSaving) return;
    setRespSaving(true);
    try {
      const res = await fetch("/api/staff-responsibilities", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: staff.employeeId, responsibilityId: selectedResp }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      setSelectedResp("");
      const a = await fetch(`/api/staff-responsibilities?staffId=${staff.employeeId}`, { credentials: "same-origin" }).then((r) => r.json());
      setRespAssignments(Array.isArray(a.assignments) ? a.assignments : []);
    } catch (e: any) { setRespError(e?.message || "Failed"); }
    finally { setRespSaving(false); }
  };
  const endResp = async (id: string) => {
    if (respSaving) return;
    setRespSaving(true);
    try {
      const res = await fetch(`/api/staff-responsibilities/${id}`, { method: "DELETE", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      const a = await fetch(`/api/staff-responsibilities?staffId=${staff!.employeeId}`, { credentials: "same-origin" }).then((r) => r.json());
      setRespAssignments(Array.isArray(a.assignments) ? a.assignments : []);
    } catch (e: any) { setRespError(e?.message || "Failed"); }
    finally { setRespSaving(false); }
  };

  const assignDept = async () => {
    if (!staff || !selectedDept || deptSaving) return;
    setDeptSaving(true);
    try {
      const res = await fetch("/api/staff-departments", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: staff.employeeId, departmentId: selectedDept }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      setSelectedDept("");
      // refresh
      const a = await fetch(`/api/staff-departments?staffId=${staff.employeeId}`, { credentials: "same-origin" }).then((r) => r.json());
      setDeptAssignments(Array.isArray(a.assignments) ? a.assignments : []);
    } catch (e: any) { setDeptError(e?.message || "Failed"); }
    finally { setDeptSaving(false); }
  };
  const endDept = async (id: string) => {
    if (deptSaving) return;
    setDeptSaving(true);
    try {
      const res = await fetch(`/api/staff-departments/${id}`, { method: "DELETE", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      const a = await fetch(`/api/staff-departments?staffId=${staff!.employeeId}`, { credentials: "same-origin" }).then((r) => r.json());
      setDeptAssignments(Array.isArray(a.assignments) ? a.assignments : []);
    } catch (e: any) { setDeptError(e?.message || "Failed"); }
    finally { setDeptSaving(false); }
  };

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
        <div className="rounded-2xl border border-edge bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-bold tracking-tight text-foreground">{staff.fullName}</h3>
                  {staff.role === "SUPERVISOR" && <span className="rounded-md bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary ring-1 ring-inset ring-primary/20">Supervisor</span>}
                  <StatusBadge status={staff.status} />
                  <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", todayPill.cls)}><span className={cn("h-1.5 w-1.5 rounded-full", todayPill.dot)} />{todayPill.label}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{staff.jobTitle || "—"} · {staff.department || "—"}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Employee ID</dt><dd className="font-medium text-foreground">{staff.employeeId}</dd></div>
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Section</dt><dd className="font-medium text-foreground">{staff.section || "—"}</dd></div>
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Counter</dt><dd className="font-medium text-foreground">{staff.counter ? `Counter ${staff.counter}` : "—"}</dd></div>
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Salary</dt><dd className="font-medium text-foreground">{salaryText(staff)} <span className="text-faint-foreground">({staff.salaryType})</span></dd></div>
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Phone</dt><dd className="font-medium text-foreground">{staff.phone || "—"}</dd></div>
                  <div><dt className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">Join date</dt><dd className="font-medium text-foreground">{staff.joinDate ? formatDate(staff.joinDate) : "—"}</dd></div>
                </dl>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:w-56 sm:grid-cols-1">
              <HeroChip label="Sessions · this month" value={String(sessionStats.month.count)} />
              <HeroChip label="Worked · this month" value={formatDuration(sessionStats.month.workedMin)} />
              <HeroChip label="Net · this month" value={formatBDT(sessionStats.month.net, false)} />
              <HeroChip label="Outstanding advance" value={formatBDT(staff.advance ?? 0, false)} />
            </div>
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
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Salary payments and settlements are managed from the main <span className="font-semibold">Payroll</span> section using canonical, server-authoritative allocation (oldest unpaid first, idempotent, no over-allocation). Legacy session-settlement actions are disabled in this modal. Advances are separate and are not auto-deducted by canonical salary allocation.
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canPerm("pay.staff") && (
                <Button size="sm" variant="secondary" icon="handCoin" onClick={() => { setAdvanceAmt(""); setAdvanceOpen(true); }}>
                  Give Advance
                </Button>
              )}
              <Button size="sm" variant="secondary" icon="receipt" onClick={() => { onClose(); navigate("payments"); }}>
                Open Payroll
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <MiniTile icon="wallet" tone="emerald" label="Total paid (history)" value={formatBDT(paySummary.total, false)} sub={`${payments.length} record${payments.length === 1 ? "" : "s"}`} />
              <MiniTile icon="handCoin" tone="amber" label="Outstanding advance" value={formatBDT(staff.advance ?? 0, false)} sub="separate balance" />
              <MiniTile icon="alert" tone="rose" label="Arrears due" value={formatBDT(staff.arrears ?? 0, false)} sub="legacy/unpaid carry" />
            </div>

            <div className="overflow-hidden rounded-xl border border-edge">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-surface-muted/70 px-4 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outstanding Dues (session view, read-only) · {dues.length} day{dues.length === 1 ? "" : "s"}</p>
                {canPerm("pay.staff") && dues.length > 0 && (
                  <span className="text-[11px] font-medium text-muted-foreground">Use Payroll → canonical allocation to pay</span>
                )}
              </div>
              {dues.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-faint-foreground">No outstanding session dues in this legacy view.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
                        <th className="px-4 py-2">Date</th>
                        <th className="px-2 py-2 text-right">Hours</th>
                        <th className="px-2 py-2 text-right">OT</th>
                        <th className="px-4 py-2 text-right">Legacy due est.</th>
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
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment History (read-only, preserved) · {payments.length} record{payments.length === 1 ? "" : "s"}</p>
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

{/* ================= DEPARTMENTS TAB ================= */}
        {tab === "departments" && (
          <div className="space-y-3">
            {deptLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {deptError && <p className="text-sm text-rose-600">{deptError}</p>}
            <div className="flex gap-2">
              <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)} className="h-9 rounded-lg border border-edge bg-surface px-2 text-sm">
                <option value="">Select department</option>
                {deptList.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button size="sm" onClick={() => void assignDept()} disabled={deptSaving || !selectedDept}>Assign</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-edge">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-4 py-2">Department</th><th className="px-2 py-2">Start</th><th className="px-2 py-2">End</th><th className="px-4 py-2">Action</th></tr></thead>
                <tbody className="divide-y divide-edge">
                  {deptAssignments.map((a: any) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2">{a.department?.name || a.departmentId}</td>
                      <td className="px-2 py-2">{new Date(a.startDate).toLocaleDateString()}</td>
                      <td className="px-2 py-2">{a.endDate ? new Date(a.endDate).toLocaleDateString() : "Active"}</td>
                      <td className="px-4 py-2">{!a.endDate && <Button size="sm" variant="ghost" onClick={() => void endDept(a.id)}>End</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
{/* ================= RESPONSIBILITIES TAB ================= */}
        {tab === "responsibilities" && (
          <div className="space-y-3">
            {respLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {respError && <p className="text-sm text-rose-600">{respError}</p>}
            <div className="flex gap-2">
              <select value={selectedResp} onChange={(e) => setSelectedResp(e.target.value)} className="h-9 rounded-lg border border-edge bg-surface px-2 text-sm">
                <option value="">Select responsibility</option>
                {respList.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button size="sm" onClick={() => void assignResp()} disabled={respSaving || !selectedResp}>Assign</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-edge">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-edge text-left text-[10px] font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-4 py-2">Responsibility</th><th className="px-2 py-2">Start</th><th className="px-2 py-2">End</th><th className="px-4 py-2">Action</th></tr></thead>
                <tbody className="divide-y divide-edge">
                  {respAssignments.map((a: any) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2">{a.responsibility?.name || a.responsibilityId}</td>
                      <td className="px-2 py-2">{new Date(a.startDate).toLocaleDateString()}</td>
                      <td className="px-2 py-2">{a.endDate ? new Date(a.endDate).toLocaleDateString() : "Active"}</td>
                      <td className="px-4 py-2">{!a.endDate && <Button size="sm" variant="ghost" onClick={() => void endResp(a.id)}>End</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
          <Field label="Advance Amount (৳)" hint="Recorded as a separate advance balance. Never auto-deducted from salary or payout.">
            <Input type="number" value={advanceAmt} onChange={(e) => setAdvanceAmt(e.target.value)} placeholder="e.g. 500" />
          </Field>
          <p className="mt-3 text-center text-xs text-faint-foreground">
            Current outstanding advance: ৳{formatBDT(staff.advance, false)}. Manual adjustment (full/partial) is supervisor-explicit only via authoritative Payroll/Advance flows.
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
    <div className="rounded-xl border border-edge bg-surface-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground", dot && cls)}>
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