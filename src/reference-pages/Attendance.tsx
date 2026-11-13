"use client";
// ============================================================================
// Attendance Analytics — Admin dashboard (Modern Professional redesign).
// Uses existing server/context data only. Preserves finalized-record/audit/
// canonical payroll rules (server-enforced). UI computes attendance summaries
// from existing session/leave data via computeSession/canonical path.
// Financial information is intentionally excluded (Payroll section only).
// ============================================================================

import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Select, Input, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon, type IconName } from "../components/icons";
import { HeroBand } from "../components/HeroBand";
import { StaffDetailModal } from "../components/StaffDetailModal";
import { VBars, Donut } from "../components/charts";
import { computeSession, dhakaTodayKey } from "../lib/timeclock";
import { formatDate, formatDuration, formatLongDate, formatTime12, addDays, addMonths, isoDate, monthKey, monthStart, monthEnd, monthShort, parseISO } from "../lib/dates";
import { downloadCSV, cn } from "../lib/utils";
import { useNow } from "../hooks/useNow";
import type { ClockStatus, Employee } from "../types";

type Range = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";
type SortKey = "recent" | "worked" | "late" | "name";

const RANGE_CHIPS: { key: Range; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" }, { key: "lastMonth", label: "Last month" }, { key: "custom", label: "Custom" },
];

export function Attendance() {
  const { data, todaySession, isOnLeaveToday } = useApp();
  const now = useNow(1000);
  const [staffId, setStaffId] = useState("all");
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
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

  const baseRows = useMemo(() => {
    return data.sessions
      .filter((s) => (!start || s.date >= start) && (!end || s.date <= end))
      .filter((s) => staffId === "all" || s.staffId === staffId)
      .map((s) => {
        const staff = data.staff.find((e) => e.employeeId === s.staffId)!;
        const calc = computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now);
        return { s, staff, calc };
      })
      .filter((r) => r.staff);
  }, [data.sessions, data.staff, data.config, staffId, start, end, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return baseRows
      .filter((r) => !q || [r.staff.fullName, r.staff.employeeId, r.staff.department, r.s.date].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "worked") return b.calc.grossMin - a.calc.grossMin;
        if (sort === "late") return b.calc.lateMin - a.calc.lateMin;
        if (sort === "name") return a.staff.fullName.localeCompare(b.staff.fullName);
        return b.s.date.localeCompare(a.s.date) || b.s.timeIn.localeCompare(a.s.timeIn);
      });
  }, [baseRows, query, sort]);

  const stats = useMemo(() => {
    const present = baseRows.length;
    const unique = new Set(baseRows.map((r) => r.staff.employeeId)).size;
    const late = baseRows.filter((r) => r.calc.isLate).length;
    const overBreak = baseRows.filter((r) => r.calc.overBreakMin > 0).length;
    const workedMin = baseRows.reduce((s, r) => s + r.calc.grossMin, 0);
    const otMin = baseRows.reduce((s, r) => s + r.calc.overtimeMin, 0);
    return { present, unique, late, overBreak, workedMin, otMin };
  }, [baseRows]);

  const overtimeLogs = useMemo(() => data.overtimeLogs
    .filter((o) => (!start || o.date >= start) && (!end || o.date <= end))
    .filter((o) => staffId === "all" || o.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date)), [data.overtimeLogs, start, end, staffId]);

  const monthlyTrend = useMemo(() => {
    const d = new Date();
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) keys.push(monthKey(addMonths(d, -i)));
    return keys.map((k) => {
      let count = 0;
      for (const s of data.sessions) {
        if (s.date.startsWith(k)) count += 1;
      }
      return { label: monthShort(k), value: count, color: "#2563eb" };
    });
  }, [data.sessions]);

  const statusMix = useMemo(() => {
    const active = data.staff.filter((s) => s.isActive);
    const pool = staffId === "all" ? active : active.filter((s) => s.employeeId === staffId);
    const present = new Set<string>(); const late = new Set<string>();
    baseRows.forEach((r) => (r.calc.isLate ? late : present).add(r.staff.employeeId));
    const onLeave = new Set(pool.filter((s) => data.leaveRequests.some((r) => r.staffId === s.employeeId && r.status === "Approved" && (!end || r.fromDate <= end) && (!start || r.toDate >= start))).map((s) => s.employeeId));
    for (const id of present) onLeave.delete(id); for (const id of late) onLeave.delete(id);
    const absent = Math.max(0, pool.length - present.size - late.size - onLeave.size);
    return { present: present.size, late: late.size, onLeave: onLeave.size, absent, pool: pool.length };
  }, [data.staff, data.leaveRequests, baseRows, start, end, staffId]);

  const staffGrid = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.staff
      .filter((s) => s.isActive)
      .filter((s) => staffId === "all" || s.employeeId === staffId)
      .filter((s) => !q || [s.fullName, s.employeeId, s.department, s.jobTitle].some((v) => (v || "").toLowerCase().includes(q)))
      .map((s) => {
        let count = 0, workedMin = 0, late = 0, otMin = 0;
        for (const x of data.sessions) {
          if (x.staffId !== s.employeeId || (start && x.date < start) || (end && x.date > end)) continue;
          const c = computeSession(x, s, data.config, x.timeOut ? new Date(x.timeOut).getTime() : now);
          count++; workedMin += c.grossMin; otMin += c.overtimeMin; if (c.isLate) late++;
        }
        const onLeave = data.leaveRequests.some((r) => r.staffId === s.employeeId && r.status === "Approved" && (!end || r.fromDate <= end) && (!start || r.toDate >= start));
        const tSess = todaySession(s.employeeId);
        const tCalc = computeSession(tSess, s, data.config, now);
        const status: ClockStatus = isOnLeaveToday(s.employeeId) ? "on-leave" : tSess ? tCalc.clockStatus : "off";
        return { staff: s, count, workedMin, late, otMin, onLeave, status };
      })
      .sort((a, b) => b.workedMin - a.workedMin || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [data.staff, data.sessions, data.leaveRequests, data.config, todaySession, isOnLeaveToday, start, end, now, staffId, query]);

  const exportCSVFn = () => {
    const out: (string | number)[][] = [["Date", "Staff", "Employee ID", "In", "Out", "Worked", "Late (min)", "Over-break", "Overtime"]];
    baseRows.forEach((r) => out.push([r.s.date, r.staff.fullName, r.staff.employeeId, formatTime12(r.s.timeIn), r.s.timeOut ? formatTime12(r.s.timeOut) : "—", formatDuration(r.calc.grossMin), Math.round(r.calc.lateMin), formatDuration(r.calc.overBreakMin), formatDuration(r.calc.overtimeMin)]));
    downloadCSV("attendance-analytics.csv", out);
  };

  return (
    <div className="space-y-5 animate-fade">
      <HeroBand
        eyebrow="Attendance Analytics"
        title="Attendance Insights"
        subtitle={`${formatDate(start)} – ${formatDate(end)} · ${formatLongDate(dhakaTodayKey())} (Dhaka). Attendance, leave, and session summaries from existing records.`}
        icon="chart"
        stats={[
          { label: "Sessions", value: stats.present, icon: "clock" },
          { label: "Employees", value: stats.unique, icon: "users2" },
          { label: "Late", value: stats.late, icon: "alert" },
        ]}
        actions={<button onClick={exportCSVFn} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20"><Icon name="download" size={16} /> Export CSV</button>}
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
            {RANGE_CHIPS.map((c) => <button key={c.key} onClick={() => setRange(c.key)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm", range === c.key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{c.label}</button>)}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_auto] lg:items-center">
            <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"><Icon name="search" size={15} /></span><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search staff, department, date…" className="pl-9" /></div>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="all">All staff</option>{data.staff.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName} · {s.employeeId}</option>)}</Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="recent">Sort: Recent</option><option value="worked">Sort: Worked hours</option><option value="late">Sort: Late</option><option value="name">Sort: Name</option></Select>
            <p className="text-xs text-faint-foreground">{formatDate(start)} – {formatDate(end)} · {rows.length} shown</p>
          </div>
          {range === "custom" && <div className="flex flex-wrap items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /><span className="text-xs text-faint-foreground">to</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></div>}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile icon="clock" tone="indigo" label="Sessions" value={String(stats.present)} sub={`${formatDuration(stats.workedMin)} worked`} />
        <KpiTile icon="users2" tone="emerald" label="Employees" value={String(stats.unique)} sub="In selected range" />
        <KpiTile icon="alert" tone="amber" label="Late Arrivals" value={String(stats.late)} sub={`${stats.overBreak} over-break`} />
        <KpiTile icon="x" tone="rose" label="Absent (est.)" value={String(statusMix.absent)} sub={`Pool ${statusMix.pool}`} />
        <KpiTile icon="calendar" tone="amber" label="On Leave" value={String(statusMix.onLeave)} sub="Approved overlap" />
        <KpiTile icon="trendUp" tone="emerald" label="Overtime" value={formatDuration(stats.otMin)} sub="Supervisor-authorized OT (duration)" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="chart" size={16} className="text-primary" /> Session Trend</p><span className="text-xs text-faint-foreground">Session count · last 6 months</span></div>
          <VBars data={monthlyTrend} height={170} color="#2563eb" format={(v) => String(Math.round(v))} />
        </Card>
        <Card className="p-5">
          <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="users2" size={16} className="text-emerald-600" /> Status Distribution</p>
          <Donut center={String(statusMix.present + statusMix.late)} centerSub="attended" segments={[{ label: "Present", value: statusMix.present, color: "#10b981" }, { label: "Late", value: statusMix.late, color: "#f59e0b" }, { label: "On leave", value: statusMix.onLeave, color: "#0ea5e9" }, { label: "Absent", value: statusMix.absent, color: "#94a3b8" }]} />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5"><p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="users2" size={16} className="text-primary" /> Employee-wise Attendance Overview</p><span className="text-xs text-faint-foreground">Click a card for full profile</span></div>
        {staffGrid.length === 0 ? <div className="p-8"><EmptyState icon="users2" title="No staff data" desc="Adjust filters or add active staff." /></div> : (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {staffGrid.map((r) => (
              <button key={r.staff.employeeId} onClick={() => setDetailFor(r.staff)} className="group rounded-2xl border border-edge bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <div className="flex items-start gap-3"><PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={42} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{r.staff.fullName}</p><p className="truncate text-xs text-muted-foreground">{r.staff.employeeId} · {r.staff.jobTitle || r.staff.department}</p><div className="mt-1.5"><StatusBadge status={r.status} /></div></div></div>
                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-edge pt-3"><MiniStatBox label="Sessions" value={String(r.count)} /><MiniStatBox label="Worked" value={formatDuration(r.workedMin)} /><MiniStatBox label="Late" value={String(r.late)} tone={r.late ? "amber" : "slate"} /><MiniStatBox label="OT" value={formatDuration(r.otMin)} tone="emerald" /></div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-faint-foreground"><span>Overtime {formatDuration(r.otMin)}</span>{r.onLeave ? <span className="font-semibold text-sky-600">Leave in range</span> : r.late === 0 ? <span className="font-semibold text-emerald-600">No late marks</span> : <span className="font-semibold text-amber-600">{r.late} late</span>}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5"><p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="list" size={16} className="text-primary" /> Session Ledger</p><span className="text-xs text-faint-foreground">{rows.length} sessions · {formatDuration(stats.workedMin)} worked</span></div>
        {rows.length === 0 ? <div className="p-8"><EmptyState icon="clock" title="No sessions in range" desc="Try a wider date range or another filter." /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-edge bg-surface-muted/70 text-left text-xs font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-5 py-2.5">Date</th><th className="px-3 py-2.5">Staff</th><th className="px-3 py-2.5">In</th><th className="px-3 py-2.5">Out</th><th className="px-3 py-2.5 text-right">Worked</th><th className="px-3 py-2.5 text-right">Late</th><th className="px-3 py-2.5 text-right">Over-break</th><th className="px-5 py-2.5 text-right">Overtime</th></tr></thead>
              <tbody className="divide-y divide-edge">
                {rows.map((r) => (
                  <tr key={r.s.id} className="hover:bg-surface-muted/70">
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(r.s.date)}{!r.s.shiftStartMin && <span title="Recorded before shift snapshots existed — evaluated against the staff member's current shift" className="ml-1.5 rounded bg-surface-muted px-1.5 py-px align-middle text-[10px] font-medium text-faint-foreground">legacy</span>}</td>
                    <td className="px-3 py-3"><div className="flex items-center gap-2.5"><PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={30} /><span className="whitespace-nowrap font-medium text-foreground">{r.staff.fullName}</span></div></td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{formatTime12(r.s.timeIn)}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">{r.s.timeOut ? formatTime12(r.s.timeOut) : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-foreground">{formatDuration(r.calc.grossMin)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.calc.isLate ? <span className="font-semibold text-amber-600">{formatDuration(r.calc.lateMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.calc.overBreakMin > 0 ? <span className="text-rose-600">{formatDuration(r.calc.overBreakMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.calc.overtimeMin > 0 ? <span className="text-emerald-600">{formatDuration(r.calc.overtimeMin)}</span> : <span className="text-faint-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5"><p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="trendUp" size={16} className="text-emerald-600" /> Overtime Section</p><span className="text-xs text-faint-foreground">{overtimeLogs.length} entries · {formatDuration(stats.otMin)} session OT</span></div>
        {overtimeLogs.length === 0 ? <div className="p-8"><EmptyState icon="trendUp" title="No overtime logged" desc="Approved/stored overtime entries in this range appear here. Extra time is tracked separately." /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b border-edge bg-surface-muted/70 text-left text-xs font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-5 py-2.5">Staff</th><th className="px-3 py-2.5">Date</th><th className="px-5 py-2.5 text-right">Overtime</th></tr></thead>
              <tbody className="divide-y divide-edge">{overtimeLogs.map((o) => { const s = data.staff.find((e) => e.employeeId === o.staffId); return (<tr key={o.id} className="hover:bg-surface-muted/70"><td className="px-5 py-3 font-medium text-foreground">{s?.fullName ?? o.staffId}</td><td className="px-3 py-3 text-muted-foreground">{formatDate(o.date)}</td><td className="px-5 py-3 text-right font-semibold tabular-nums text-emerald-600">{formatDuration(o.overtimeMin)}</td></tr>); })}</tbody>
            </table>
          </div>
        )}
      </Card>

      <StaffDetailModal staff={detailFor} open={!!detailFor} onClose={() => setDetailFor(null)} />
    </div>
  );
}

function KpiTile({ icon, tone, label, value, sub }: { icon: IconName; tone: "indigo" | "emerald" | "amber" | "rose"; label: string; value: string; sub?: string }) {
  const chip = { indigo: "bg-primary-soft text-primary", emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" }[tone];
  return (
    <Card className="p-3.5 transition hover:-translate-y-0.5 hover:shadow-card-lg"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className="mt-0.5 truncate text-lg font-bold tabular-nums text-foreground">{value}</p>{sub && <p className="truncate text-[10px] text-faint-foreground">{sub}</p>}</div><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", chip)}><Icon name={icon} size={17} /></span></div></Card>
  );
}
function MiniStatBox({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "emerald" | "amber" }) {
  const c = { slate: "text-foreground", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return <div className="rounded-lg bg-surface-muted px-1.5 py-1.5 text-center"><p className="text-[9px] font-semibold uppercase tracking-wider text-faint-foreground">{label}</p><p className={cn("mt-0.5 truncate text-[11px] font-bold tabular-nums", c)}>{value}</p></div>;
}
function StatusBadge({ status }: { status: ClockStatus }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    working: { label: "On Duty", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    "on-meal": { label: "On Meal", cls: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25", dot: "bg-orange-500" },
    "on-rest": { label: "On Rest", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25", dot: "bg-sky-500" },
    "on-unpaid": { label: "Unpaid Break", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25", dot: "bg-rose-500" },
    "on-goout": { label: "Go-Out", cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25", dot: "bg-violet-500" },
    "on-leave": { label: "On Leave", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25", dot: "bg-amber-500" },
    completed: { label: "Done", cls: "bg-surface-muted text-muted-foreground ring-edge", dot: "bg-slate-400" },
    off: { label: "Not In", cls: "bg-surface-muted text-faint-foreground ring-edge", dot: "bg-slate-300" },
  };
  const m = map[status] || map.off;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset", m.cls)}><span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.label}</span>;
}
