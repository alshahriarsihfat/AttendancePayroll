// ============================================================================
// Attendance Analytics — Admin dashboard (Venus-style premium UI).
// Live KPI tiles, filtered sessions ledger, overtime section, plus an
// interactive Staff Analytics grid: clicking any staff member opens the
// shared StaffDetailModal with full attendance / payment / leave history.
// ============================================================================
"use client";

import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Select, Input, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon, type IconName } from "../components/icons";
import { Money } from "../components/Money";
import { HeroBand } from "../components/HeroBand";
import { StaffDetailModal } from "../components/StaffDetailModal";
import { VBars, Donut } from "../components/charts";
import { computeSession, dhakaTodayKey } from "../lib/timeclock";
import { formatBDT, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDuration, formatTime12, addDays, addMonths, isoDate, monthKey, monthStart, monthEnd, monthShort, parseISO } from "../lib/dates";
import { downloadCSV, cn } from "../lib/utils";
import { useNow } from "../hooks/useNow";
import type { ClockStatus, Employee } from "../types";

type Range = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

const RANGE_CHIPS: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export function Attendance() {
  const { data, todaySession, isOnLeaveToday } = useApp();
  const now = useNow(1000);
  const [staffId, setStaffId] = useState("all");
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detailFor, setDetailFor] = useState<Employee | null>(null);

  const { start, end } = useMemo(() => {
    const todayK = dhakaTodayKey();
    switch (range) {
      case "today": return { start: todayK, end: todayK };
      case "7d": return { start: isoDate(addDays(parseISO(todayK), -6)), end: todayK };
      case "30d": return { start: isoDate(addDays(parseISO(todayK), -29)), end: todayK };
      case "month": { const k = monthKey(parseISO(todayK)); return { start: isoDate(monthStart(k)), end: isoDate(monthEnd(k)) }; }
      case "lastMonth": { const k = monthKey(addMonths(parseISO(todayK), -1)); return { start: isoDate(monthStart(k)), end: isoDate(monthEnd(k)) }; }
      case "custom": return { start: from, end: to };
    }
  }, [range, from, to]);

  // ---- filtered session rows (range + staff) -------------------------------
  const rows = useMemo(() => {
    return data.sessions
      .filter((s) => (!start || s.date >= start) && (!end || s.date <= end))
      .filter((s) => staffId === "all" || s.staffId === staffId)
      .map((s) => {
        const staff = data.staff.find((e) => e.employeeId === s.staffId)!;
        const calc = computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now);
        return { s, staff, calc };
      })
      .filter((r) => r.staff)
      .sort((a, b) => b.s.date.localeCompare(a.s.date) || a.s.staffId.localeCompare(b.s.staffId));
  }, [data.sessions, data.staff, data.config, staffId, start, end, now]);

  // ---- headline metrics for the selected range -----------------------------
  const stats = useMemo(() => {
    const present = rows.length;
    const late = rows.filter((r) => r.calc.isLate).length;
    const overBreak = rows.filter((r) => r.calc.overBreakMin > 0).length;
    const ot = rows.filter((r) => r.calc.overtimeMin > 0);
    const workedMin = rows.reduce((s, r) => s + r.calc.grossMin, 0);
    const otMin = rows.reduce((s, r) => s + r.calc.overtimeMin, 0);
    const ded = rows.reduce((s, r) => s + r.calc.overBreakDeduction, 0);
    const net = payRound(rows.reduce((s, r) => s + r.calc.netPay, 0));
    const otPay = payRound(ot.reduce((s, r) => s + r.calc.overtimePay, 0));
    return { present, late, overBreak, otCount: ot.length, workedMin, otMin, ded, net, otPay };
  }, [rows]);

  const overtimeLogs = useMemo(() => data.overtimeLogs
    .filter((o) => (!start || o.date >= start) && (!end || o.date <= end))
    .filter((o) => staffId === "all" || o.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date)), [data.overtimeLogs, start, end, staffId]);
// ---- payroll trend: net pay per month, last 6 months ---------------------
  const monthlyTrend = useMemo(() => {
    const d = new Date();
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) keys.push(monthKey(addMonths(d, -i)));
    return keys.map((k) => {
      let net = 0;
      for (const s of data.sessions) {
        if (!s.date.startsWith(k)) continue;
        const st = data.staff.find((e) => e.employeeId === s.staffId);
        if (!st) continue;
        net += computeSession(s, st, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now).netPay;
      }
      return { label: monthShort(k), value: payRound(net), color: "#2563eb" };
    });
  }, [data.sessions, data.staff, data.config, now]);

  // ---- status mix for the range: Present / Late / On Leave / Absent --------
  const statusMix = useMemo(() => {
    const active = data.staff.filter((s) => s.isActive);
    const present = new Set<string>();
    const late = new Set<string>();
    rows.forEach((r) => (r.calc.isLate ? late : present).add(r.staff.employeeId));
    const onLeave = new Set(
      active
        .filter((s) => data.leaveRequests.some((r) =>
          r.staffId === s.employeeId && r.status === "Approved" && (!end || r.fromDate <= end) && (!start || r.toDate >= start)))
        .map((s) => s.employeeId)
    );
    const absent = Math.max(0, active.length - present.size - late.size - onLeave.size);
    return { present: present.size, late: late.size, onLeave: onLeave.size, absent };
  }, [data.staff, data.leaveRequests, rows, start, end]);

  // ---- per-staff analytics in the range (powers the interactive grid) ------
  const staffGrid = useMemo(() => {
    return data.staff
      .filter((s) => s.isActive)
      .map((s) => {
        let count = 0, workedMin = 0, net = 0, late = 0;
        for (const x of data.sessions) {
          if (x.staffId !== s.employeeId || (start && x.date < start) || (end && x.date > end)) continue;
          const c = computeSession(x, s, data.config, x.timeOut ? new Date(x.timeOut).getTime() : now);
          count++; workedMin += c.grossMin; net += c.netPay; if (c.isLate) late++;
        }
        const tSess = todaySession(s.employeeId);
        const onLeave = isOnLeaveToday(s.employeeId);
        const tCalc = computeSession(tSess, s, data.config, now);
        const status: ClockStatus = onLeave ? "on-leave" : tSess ? tCalc.clockStatus : "off";
        return { staff: s, count, workedMin, net: payRound(net), late, status };
      });
  }, [data.staff, data.sessions, data.config, todaySession, isOnLeaveToday, start, end, now]);

  const exportCSV = () => {
    const out: (string | number)[][] = [["Date", "Staff", "In", "Out", "Worked", "Late", "Over-break", "Overtime", "Net Pay"]];
    rows.forEach((r) => out.push([
      r.s.date, r.staff.fullName, formatTime12(r.s.timeIn),
      r.s.timeOut ? formatTime12(r.s.timeOut) : "—", formatDuration(r.calc.grossMin),
      r.calc.lateMin, formatDuration(r.calc.overBreakMin), formatDuration(r.calc.overtimeMin), r.calc.netPay,
    ]));
    downloadCSV("attendance-report.csv", out);
  };
return (
    <div className="space-y-5 animate-fade">
      {/* ================= Hero ================= */}
      <HeroBand
        eyebrow="Attendance Analytics · Admin"
        title="Attendance & Payroll Analytics"
        subtitle="KPIs, trends and a per-staff breakdown across every session — click any staff card to open their full profile with attendance, payment & leave history."
        icon="chart"
        stats={[
          { label: "Sessions", value: stats.present, icon: "clock" },
          { label: "Late Arrivals", value: stats.late, icon: "alert" },
          { label: "Overtime", value: formatDuration(stats.otMin), icon: "trendUp" },
          { label: "Net Pay", value: formatBDT(stats.net, false), icon: "wallet" },
        ]}
        actions={
          <button onClick={exportCSV}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20">
            <Icon name="download" size={16} /> Export CSV
          </button>
        }
      />

      {/* ================= Filter toolbar ================= */}
      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
            {RANGE_CHIPS.map((c) => (
              <button key={c.key} onClick={() => setRange(c.key)}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm",
                  range === c.key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Select className="w-full sm:w-56" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="all">All staff</option>
              {data.staff.map((s) => (
                <option key={s.employeeId} value={s.employeeId}>{s.fullName} · {s.employeeId}</option>
              ))}
            </Select>
            {range === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
                <span className="text-xs text-faint-foreground">to</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
              </div>
            )}
            <p className="text-xs text-faint-foreground">
              {formatDate(start)} – {formatDate(end)} · {rows.length} session{rows.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </Card>

      {/* ================= KPI tiles ================= */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="clock" tone="indigo" label="Sessions" value={String(stats.present)} sub={`${formatDuration(stats.workedMin)} worked`} />
        <KpiTile icon="alert" tone="amber" label="Late Arrivals" value={String(stats.late)} sub={`${payRound((stats.late / Math.max(1, stats.present)) * 100, 1)}% of shifts`} />
        <KpiTile icon="trendUp" tone="emerald" label="Overtime" value={formatDuration(stats.otMin)} sub={`+${formatBDT(stats.otPay, false)} OT pay`} />
        <KpiTile icon="wallet" tone="rose" label="Net Pay" value={formatBDT(stats.net, false)} sub={`−${formatBDT(stats.ded, false)} deductions`} />
      </div>

      {/* ================= Charts ================= */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon name="chart" size={16} className="text-primary" /> Payroll Trend
            </p>
            <span className="text-xs text-faint-foreground">Net pay · last 6 months</span>
          </div>
          <VBars data={monthlyTrend} height={160} color="#2563eb" format={(v) => formatBDT(v, false)} />
        </Card>

        <Card className="p-5">
          <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon name="users2" size={16} className="text-emerald-600" /> Status Mix
          </p>
          <Donut
            center={String(statusMix.present + statusMix.late)}
            centerSub="on floor"
            segments={[
              { label: "Present", value: statusMix.present, color: "#10b981" },
              { label: "Late", value: statusMix.late, color: "#f59e0b" },
              { label: "On leave", value: statusMix.onLeave, color: "#0ea5e9" },
              { label: "Absent", value: statusMix.absent, color: "#94a3b8" },
            ]}
          />
        </Card>
      </div>
{/* ================= Interactive staff analytics ================= */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Icon name="users2" size={18} className="text-primary" /> Staff Analytics
          </h3>
          <p className="mt-0.5 text-sm text-faint-foreground">Click any staff member to open their full profile — attendance, payments & leave.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 font-medium text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" />Present</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 font-medium text-muted-foreground"><span className="h-2 w-2 rounded-full bg-amber-500" />Late</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 font-medium text-muted-foreground"><span className="h-2 w-2 rounded-full bg-sky-500" />On Leave</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 font-medium text-muted-foreground"><span className="h-2 w-2 rounded-full bg-slate-300" />Not In</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {staffGrid.map((r) => (
          <button key={r.staff.employeeId} onClick={() => setDetailFor(r.staff)}
            className="group flex flex-col rounded-2xl border border-edge bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <div className="flex items-start gap-3">
              <PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-foreground">{r.staff.fullName}</p>
                  {r.staff.role === "SUPERVISOR" && (
                    <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary ring-1 ring-inset ring-primary/25">Supervisor</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.staff.employeeId} · {r.staff.jobTitle}</p>
                <div className="mt-1.5">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset", badgeCls(r.status))}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", dotColor(r.status))} />
                    {badgeLabel(r.status)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-3">
              <MiniStatBox label="Sessions" value={String(r.count)} />
              <MiniStatBox label="Worked" value={formatDuration(r.workedMin)} />
              <MiniStatBox label="Net pay" value={formatBDT(r.net, false)} tone={r.net > 0 ? "emerald" : "slate"} />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-faint-foreground">
              <span>{r.staff.department}</span>
              {r.late > 0 ? (
                <span className="shrink-0 font-semibold text-amber-600">{r.late} late{r.late === 1 ? "" : "s"}</span>
              ) : (
                <span className="shrink-0 font-semibold text-emerald-600">On time</span>
              )}
            </div>

            <span className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full bg-linear-to-r from-primary-deep to-primary-bright py-1.5 text-[11px] font-bold text-white shadow-md shadow-primary/25 transition group-hover:from-primary group-hover:to-primary-bright">
              <Icon name="eye" size={13} /> View Full Profile
            </span>
          </button>
        ))}
      </div>
{/* ================= Detailed sessions ledger ================= */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon name="list" size={16} className="text-primary" /> Session Ledger
          </p>
          <span className="text-xs text-faint-foreground">{rows.length} sessions · {formatDuration(stats.workedMin)} worked</span>
        </div>
        {rows.length === 0 ? <EmptyState icon="clock" title="No sessions in range" desc="Try a wider date range or another staff member." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge bg-surface-muted/70 text-left text-xs font-semibold uppercase tracking-wide text-faint-foreground">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Staff</th>
                  <th className="px-3 py-2.5">In</th>
                  <th className="px-3 py-2.5">Out</th>
                  <th className="px-3 py-2.5 text-right">Worked</th>
                  <th className="px-3 py-2.5 text-right">Late</th>
                  <th className="px-3 py-2.5 text-right">Over-break</th>
                  <th className="px-3 py-2.5 text-right">Overtime</th>
                  <th className="px-5 py-2.5 text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {rows.map((r) => (
                  <tr key={r.s.id} className="hover:bg-surface-muted/70">
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                      {formatDate(r.s.date)}
                      {!r.s.shiftStartMin && <span title="Recorded before shift snapshots existed — evaluated against the staff member's current shift" className="ml-1.5 rounded bg-surface-muted px-1.5 py-px align-middle text-[10px] font-medium text-faint-foreground">legacy</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={30} />
                        <span className="whitespace-nowrap font-medium text-foreground">{r.staff.fullName}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{formatTime12(r.s.timeIn)}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{r.s.timeOut ? formatTime12(r.s.timeOut) : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-foreground">{formatDuration(r.calc.grossMin)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.calc.isLate ? <span className="font-semibold text-amber-600">{formatDuration(r.calc.lateMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.calc.overBreakMin > 0 ? <span className="text-rose-600">{formatDuration(r.calc.overBreakMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.calc.overtimeMin > 0 ? <span className="text-emerald-600">{formatDuration(r.calc.overtimeMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-5 py-3 text-right"><Money value={r.calc.netPay} className="text-emerald-600 text-sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
{/* ================= Overtime section ================= */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="trendUp" size={16} className="text-emerald-600" /> Overtime Section</p>
          <span className="text-xs text-faint-foreground">{overtimeLogs.length} entries · ৳{formatNumber(stats.otPay, 2)} total</span>
        </div>
        {overtimeLogs.length === 0 ? <EmptyState icon="trendUp" title="No overtime logged" desc="Time worked past a scheduled shift end appears here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge bg-surface-muted/70 text-left text-xs font-semibold uppercase tracking-wide text-faint-foreground">
                  <th className="px-5 py-2.5">Staff</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Overtime</th>
                  <th className="px-3 py-2.5 text-right">Rate/hr</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {overtimeLogs.map((o) => {
                  const s = data.staff.find((e) => e.employeeId === o.staffId);
                  return (
                    <tr key={o.id} className="hover:bg-surface-muted/70">
                      <td className="px-5 py-3 font-medium text-foreground">{s?.fullName ?? o.staffId}</td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(o.date)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-600">{formatDuration(o.overtimeMin)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">৳{formatNumber(o.hourlyRate, 2)} ×1.25</td>
                      <td className="px-5 py-3 text-right"><Money value={o.amount} className="text-emerald-600 text-sm" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ================= Staff detail drawer ================= */}
      <StaffDetailModal staff={detailFor} open={!!detailFor} onClose={() => setDetailFor(null)} />
    </div>
  );
}
// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function KpiTile({ icon, tone, label, value, sub }: {
  icon: IconName; tone: "indigo" | "emerald" | "amber" | "rose";
  label: string; value: string; sub?: string;
}) {
  const chip = {
    indigo: "bg-primary-soft text-primary", emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600",
  }[tone];
  return (
    <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint-foreground">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-foreground">{value}</p>
          {sub && <p className="truncate text-[11px] text-faint-foreground">{sub}</p>}
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", chip)}>
          <Icon name={icon} size={19} />
        </span>
      </div>
    </Card>
  );
}

function MiniStatBox({ label, value, tone = "slate" }: {
  label: string; value: string; tone?: "slate" | "emerald" | "amber";
}) {
  const c = { slate: "text-foreground", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return (
    <div className="rounded-lg bg-surface-muted px-2 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-xs font-bold tabular-nums", c)}>{value}</p>
    </div>
  );
}

function badgeCls(s: ClockStatus) {
  return {
    working: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    "on-meal": "bg-orange-50 text-orange-700 ring-orange-200",
    "on-rest": "bg-sky-50 text-sky-700 ring-sky-200",
    "on-unpaid": "bg-rose-50 text-rose-700 ring-rose-200",
    "on-goout": "bg-violet-50 text-violet-700 ring-violet-200",
    "on-leave": "bg-amber-50 text-amber-700 ring-amber-200",
    completed: "bg-surface-muted text-muted-foreground ring-edge",
    off: "bg-surface-muted text-faint-foreground ring-edge",
  }[s];
}
function dotColor(s: ClockStatus) {
  return {
    working: "bg-emerald-500", "on-meal": "bg-orange-500", "on-rest": "bg-sky-500",
    "on-unpaid": "bg-rose-500", "on-goout": "bg-violet-500", "on-leave": "bg-amber-500",
    completed: "bg-slate-400", off: "bg-slate-300",
  }[s];
}
function badgeLabel(s: ClockStatus) {
  return {
    working: "On Duty", "on-meal": "On Meal", "on-rest": "On Rest",
    "on-unpaid": "Unpaid Break", "on-goout": "Go-Out", "on-leave": "On Leave",
    completed: "Clocked Out", off: "Not In",
  }[s];
}