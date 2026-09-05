import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Select, Input, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { Money } from "../components/Money";
import { computeSession } from "../lib/timeclock";
import { formatBDT, formatNumber } from "../lib/currency";
import { formatDate, formatDuration, formatTime12, addMonths, monthKey, monthStart, monthEnd } from "../lib/dates";
import { downloadCSV } from "../lib/utils";

type Range = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export function Attendance() {
  const { data } = useApp();
  const [staffId, setStaffId] = useState("all");
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { start, end } = useMemo(() => {
    const t = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    switch (range) {
      case "today": return { start: iso(t), end: iso(t) };
      case "7d": return { start: iso(new Date(Date.now() - 6 * 86400000)), end: iso(t) };
      case "30d": return { start: iso(new Date(Date.now() - 29 * 86400000)), end: iso(t) };
      case "month": { const k = monthKey(t); return { start: iso(monthStart(k)), end: iso(monthEnd(k)) }; }
      case "lastMonth": { const k = monthKey(addMonths(t, -1)); return { start: iso(monthStart(k)), end: iso(monthEnd(k)) }; }
      case "custom": return { start: from, end: to };
    }
  }, [range, from, to]);

  const rows = useMemo(() => {
    return data.sessions
      .filter((s) => (!start || s.date >= start) && (!end || s.date <= end))
      .filter((s) => staffId === "all" || s.staffId === staffId)
      .map((s) => {
        const staff = data.staff.find((e) => e.employeeId === s.staffId)!;
        const calc = computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : Date.now());
        return { s, staff, calc };
      })
      .filter((r) => r.staff)
      .sort((a, b) => b.s.date.localeCompare(a.s.date) || a.s.staffId.localeCompare(b.s.staffId));
  }, [data.sessions, data.staff, data.config, staffId, start, end]);

  const stats = useMemo(() => {
    const present = rows.length;
    const late = rows.filter((r) => r.calc.lateMin >= 10).length;
    const overBreak = rows.filter((r) => r.calc.overBreakMin > 0).length;
    const ot = rows.filter((r) => r.calc.overtimeMin > 0);
    const workedMin = rows.reduce((s, r) => s + r.calc.grossMin, 0);
    const otMin = rows.reduce((s, r) => s + r.calc.overtimeMin, 0);
    const ded = rows.reduce((s, r) => s + r.calc.overBreakDeduction, 0);
    const net = rows.reduce((s, r) => s + r.calc.netPay, 0);
    const otPay = ot.reduce((s, r) => s + r.calc.overtimePay, 0);
    return { present, late, overBreak, otCount: ot.length, workedMin, otMin, ded, net, otPay };
  }, [rows]);

  const overtimeLogs = data.overtimeLogs
    .filter((o) => (!start || o.date >= start) && (!end || o.date <= end))
    .filter((o) => staffId === "all" || o.staffId === staffId)
    .sort((a, b) => b.date.localeCompare(a.date));

  const exportCSV = () => {
    const out: (string | number)[][] = [["Date", "Staff", "In", "Out", "Worked", "Late", "Over-break", "Overtime", "Net Pay"]];
    rows.forEach((r) => out.push([r.s.date, r.staff.fullName, formatTime12(r.s.timeIn), r.s.timeOut ? formatTime12(r.s.timeOut) : "—", formatDuration(r.calc.grossMin), r.calc.lateMin, formatDuration(r.calc.overBreakMin), formatDuration(r.calc.overtimeMin), r.calc.netPay]));
    downloadCSV("attendance-report.csv", out);
  };

  return (
    <div className="space-y-5 animate-fade">
      {/* Filters — stack vertically on mobile, wrap on desktop */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Select className="w-full sm:w-auto sm:min-w-[180px]" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="all">All staff</option>
            {data.staff.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName}</option>)}
          </Select>
          <Select className="w-full sm:w-auto" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="custom">Custom range</option>
          </Select>
          {range === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="date" className="w-full sm:w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="shrink-0 text-slate-400">→</span>
              <Input type="date" className="w-full sm:w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <Button variant="secondary" icon="download" className="w-full sm:ml-auto sm:w-auto" onClick={exportCSV}>Export CSV</Button>
        </div>
      </Card>

      {/* Performance analytics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon="clock" tone="emerald" label="Sessions" value={formatNumber(stats.present)} sub={`${formatDuration(stats.workedMin)} worked`} />
        <StatCard icon="alert" tone="amber" label="Late (≥10m)" value={formatNumber(stats.late)} sub="needs attention" />
        <StatCard icon="trendUp" tone="indigo" label="Overtime" value={formatNumber(stats.otCount)} sub={`${formatDuration(stats.otMin)} · ৳${formatNumber(stats.otPay, 0)}`} />
        <StatCard icon="wallet" tone="rose" label="Over-break cuts" value={formatBDT(stats.ded, false)} sub={`${stats.overBreak} sessions`} />
      </div>

      {/* Sessions */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3"><p className="text-sm font-medium text-slate-600">{rows.length} session(s)</p></div>
        {rows.length === 0 ? <EmptyState icon="clock" title="No sessions in range" /> : (
          <>
            {/* ===== MOBILE: stacked cards (< md) — badges wrap cleanly ===== */}
            <div className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <div key={r.s.id} className="flex flex-col gap-2 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{r.staff.fullName}</p>
                      <p className="truncate text-xs text-slate-400">{formatDate(r.s.date)}</p>
                    </div>
                    <Money value={r.calc.netPay} className="text-sm text-emerald-600" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                    <span className="shrink-0 tabular-nums">{formatTime12(r.s.timeIn)} → {r.s.timeOut ? formatTime12(r.s.timeOut) : "—"}</span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-700">{formatDuration(r.calc.grossMin)}</span>
                    {r.calc.lateMin >= 10 && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-600">Late {formatDuration(r.calc.lateMin)}</span>}
                    {r.calc.overBreakMin > 0 && <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600">Over {formatDuration(r.calc.overBreakMin)}</span>}
                    {r.calc.overtimeMin > 0 && <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-600">OT {formatDuration(r.calc.overtimeMin)}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* ===== DESKTOP: table (≥ md) ===== */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2.5">Staff</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">In</th>
                    <th className="px-3 py-2.5">Out</th>
                    <th className="px-3 py-2.5 text-right">Worked</th>
                    <th className="px-3 py-2.5 text-right">Late</th>
                    <th className="px-3 py-2.5 text-right">Over</th>
                    <th className="px-3 py-2.5 text-right">OT</th>
                    <th className="px-5 py-2.5 text-right">Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3"><div className="flex items-center gap-2.5"><PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={32} /><div><p className="font-semibold text-slate-900">{r.staff.fullName}</p><p className="text-xs text-slate-400">{r.staff.jobTitle}</p></div></div></td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(r.s.date)}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-600">{formatTime12(r.s.timeIn)}</td>
                      <td className="px-3 py-3 tabular-nums text-slate-500">{r.s.timeOut ? formatTime12(r.s.timeOut) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-700">{formatDuration(r.calc.grossMin)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.calc.lateMin >= 10 ? <span className="font-medium text-amber-600">{formatDuration(r.calc.lateMin)}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.calc.overBreakMin > 0 ? <span className="text-rose-600">{formatDuration(r.calc.overBreakMin)}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.calc.overtimeMin > 0 ? <span className="text-emerald-600">{formatDuration(r.calc.overtimeMin)}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-5 py-3 text-right"><Money value={r.calc.netPay} className="text-emerald-600 text-sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Overtime Section */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="trendUp" size={16} className="text-emerald-600" /> Overtime Section</p>
          <span className="text-xs text-slate-400">{overtimeLogs.length} entries · ৳{formatNumber(stats.otPay, 2)} total</span>
        </div>
        {overtimeLogs.length === 0 ? <EmptyState icon="trendUp" title="No overtime logged" desc="Time worked past a scheduled shift end appears here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Staff</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-right">Overtime</th>
                  <th className="px-3 py-2.5 text-right">Rate/hr</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overtimeLogs.map((o) => {
                  const s = data.staff.find((e) => e.employeeId === o.staffId);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{s?.fullName ?? o.staffId}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(o.date)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-600">{formatDuration(o.overtimeMin)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">৳{formatNumber(o.hourlyRate, 2)} ×1.25</td>
                      <td className="px-5 py-3 text-right"><Money value={o.amount} className="text-emerald-600 text-sm" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ icon, tone, label, value, sub }: { icon: "clock" | "alert" | "trendUp" | "wallet"; tone: "emerald" | "amber" | "indigo" | "rose"; label: string; value: string; sub?: string }) {
  const c = { emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", indigo: "bg-indigo-50 text-indigo-600", rose: "bg-rose-50 text-rose-600" }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p><p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">{value}</p>{sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}</div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c}`}><Icon name={icon} size={18} /></span>
      </div>
    </Card>
  );
}
