import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon, type IconName } from "../components/icons";
import { Money } from "../components/Money";
import { computeSession, empShift, scheduledBoundary } from "../lib/timeclock";
import { formatBDT, formatNumber } from "../lib/currency";
import { formatCountdown, formatElapsed, formatTime12, formatDuration } from "../lib/dates";
import { cn } from "../lib/utils";
import type { ClockStatus, Employee } from "../types";

export function Monitor() {
  const { data, todaySession, isOnLeaveToday, navigate } = useApp();
  const now = useNow(1000);

  const rows = useMemo(() => {
    return data.staff.filter((s) => s.isActive).map((s) => {
      const sess = todaySession(s.employeeId);
      const onLeave = isOnLeaveToday(s.employeeId);
      const calc = computeSession(sess, s, data.config, now);
      const status: ClockStatus = onLeave ? "on-leave" : sess ? calc.clockStatus : "off";
      return { staff: s, sess, calc, status };
    }).sort((a, b) => order(a.status) - order(b.status) || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [data.staff, data.config, todaySession, isOnLeaveToday, now]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { working: 0, "on-meal": 0, "on-rest": 0, "on-leave": 0, completed: 0, off: 0 };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const totalPayToday = rows.reduce((sum, r) => sum + (r.calc.clockStatus !== "off" && r.status !== "on-leave" ? r.calc.netPay : 0), 0);
  const leaveStaff = rows.filter((r) => r.status === "on-leave");

  return (
    <div className="space-y-5 animate-fade">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="users2" tone="emerald" label="On Duty" value={counts.working + counts["on-meal"] + counts["on-rest"]} />
        <Kpi icon="meal" tone="orange" label="On Break" value={counts["on-meal"] + counts["on-rest"]} />
        <Kpi icon="calendar" tone="amber" label="On Leave" value={counts["on-leave"]} />
        <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pay Today (est.)</p><p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-600">{formatBDT(totalPayToday, false)}</p></div><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Icon name="handCoin" size={18} /></span></div></Card>
      </div>

      <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Icon name="timer" size={16} className="text-emerald-600" /> Live Floor</span>
        <span className="text-2xl font-bold tabular-nums text-slate-900">{formatTime12(new Date(now).toISOString())}</span>
        <div className="ml-auto flex flex-wrap gap-3 text-xs">
          <Legend dot="bg-emerald-500" label={`Working ${counts.working}`} />
          <Legend dot="bg-orange-500" label={`Meal ${counts["on-meal"]}`} />
          <Legend dot="bg-sky-500" label={`Rest ${counts["on-rest"]}`} />
          <Legend dot="bg-amber-500" label={`Leave ${counts["on-leave"]}`} />
          <Legend dot="bg-slate-300" label={`Off ${counts.off + counts.completed}`} />
        </div>
      </Card>

      {/* Read-only notice */}
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        <Icon name="info" size={15} className="shrink-0 text-slate-400" />
        Live Floor is a real-time monitor. All payouts are processed in the <b>Payments</b> section.
      </div>

      {leaveStaff.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800"><Icon name="calendar" size={16} /> On Leave Today ({leaveStaff.length})</p>
          <div className="flex flex-wrap gap-2">
            {leaveStaff.map((r) => {
              const annual = data.leaveBalances.find((b) => b.staffId === r.staff.employeeId && b.leaveType === "Annual");
              const rem = annual ? annual.entitledDays - annual.usedDays : 0;
              return (
                <div key={r.staff.employeeId} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2">
                  <PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={28} />
                  <div className="text-xs"><p className="font-semibold text-slate-800">{r.staff.fullName}</p><p className="text-slate-400">{annual ? `${annual.usedDays}d used · ${rem}d left` : "On leave"}</p></div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const isPaid = r.sess ? data.payments.some((p) => p.sessionId === r.sess!.id) : false;
          return (
            <StaffCard key={r.staff.employeeId} staff={r.staff} sess={r.sess} calc={r.calc} status={r.status} now={now} isPaid={isPaid} onView={() => navigate("staff")} />
          );
        })}
      </div>
      {rows.length === 0 && <Card className="p-10"><EmptyState icon="users2" title="No staff" /></Card>}
    </div>
  );
}



function order(s: ClockStatus): number { return { "on-meal": 0, "on-rest": 1, "on-unpaid": 1, "on-goout": 1, working: 2, completed: 3, off: 4, "on-leave": 5 }[s] ?? 9; }

function StaffCard({ staff, sess, calc, status, now, isPaid, onView }: {
  staff: Employee; sess: ReturnType<typeof useApp>["data"]["sessions"][number] | undefined;
  calc: ReturnType<typeof computeSession>; status: ClockStatus; now: number; isPaid: boolean; onView: () => void;
}) {
  const onBreak = status === "on-meal" || status === "on-rest" || status === "on-unpaid" || status === "on-goout";
  // Early-departure minutes (only meaningful once clocked out).
  const earlyDone = sess && sess.timeOut
    ? Math.max(0, Math.round((scheduledBoundary(sess.timeIn, empShift(staff).endMin) - new Date(sess.timeOut).getTime()) / 60000))
    : 0;
  const off = status === "off";
  const leave = status === "on-leave";
  const done = status === "completed";
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;

  return (
    <Card className={cn("overflow-hidden", leave && "border-amber-200 bg-amber-50/30")}>
      <button onClick={onView} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-slate-50">
        <div className="relative">
          <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={44} />
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white", dotColor(status))} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{staff.fullName}</p>
            {staff.counter && <span className="rounded bg-emerald-50 px-1 text-[10px] font-bold text-emerald-700">C{staff.counter}</span>}
          </div>
          <p className="truncate text-xs text-slate-400">{staff.jobTitle} · {staff.employeeId}</p>
        </div>
        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", badgeCls(status))}>{badgeLabel(status)}</span>
      </button>

      <div className="border-t border-slate-100 px-4 py-3">
        {leave ? <p className="text-sm text-amber-600">On approved leave today.</p>
        : off ? <p className="text-sm text-slate-400">Not clocked in yet.</p>
        : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{done ? "Clocked out" : onBreak ? "Break timer" : "On duty since"}</p>
              {/* Timer runs ONLY for actively On-Duty staff; frozen for completed/paid. */}
              <p className={cn("text-lg font-bold tabular-nums", onBreak && calc.breakRemainingSec < 0 ? "text-rose-600" : "text-slate-900")}>
                {done ? formatDuration(calc.grossMin) : onBreak ? formatCountdown(Math.abs(calc.activeElapsedSec)) : formatElapsed(elapsedMs)}
              </p>
              <p className="text-[11px] text-slate-400">In {formatTime12(sess?.timeIn)}{done ? ` · Out ${formatTime12(sess?.timeOut)}` : ""}{calc.lateMin > 0 ? ` · ${formatDuration(calc.lateMin)} late` : ""}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Pay</p>
              <Money value={calc.netPay} className="text-base text-emerald-600" />
              {calc.overtimeMin > 0 && <p className="text-[11px] font-medium text-emerald-600">+{formatDuration(calc.overtimeMin)} OT</p>}
              {calc.overBreakDeduction > 0 && <p className="text-[11px] font-medium text-rose-500">−৳{formatNumber(calc.overBreakDeduction, 2)}</p>}
            </div>
          </div>
        )}
      </div>

      {/* READ-ONLY earned summary — no payout actions on the Live Floor. */}
      {done && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Earned · clocked out</p>
              <p className="text-lg font-bold tabular-nums text-emerald-600">{formatBDT(calc.netPay)}</p>
              <p className="text-[10px] text-slate-400">{formatDuration(calc.grossMin)} worked{earlyDone ? ` · ${formatDuration(earlyDone)} early` : ""}</p>
            </div>
            {isPaid ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200"><Icon name="check" size={15} /> Paid</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                <Icon name="alert" size={14} /> Due
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Kpi({ icon, tone, label, value }: { icon: IconName; tone: "emerald" | "orange" | "amber"; label: string; value: number }) {
  const c = { emerald: "bg-emerald-50 text-emerald-600", orange: "bg-orange-50 text-orange-600", amber: "bg-amber-50 text-amber-600" }[tone];
  return <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p><p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{value}</p></div><span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", c)}><Icon name={icon} size={18} /></span></div></Card>;
}
function Legend({ dot, label }: { dot: string; label: string }) { return <span className="flex items-center gap-1.5 text-slate-500"><span className={cn("h-2 w-2 rounded-full", dot)} />{label}</span>; }
function dotColor(s: ClockStatus) { return { working: "bg-emerald-500", "on-meal": "bg-orange-500", "on-rest": "bg-sky-500", "on-unpaid": "bg-rose-500", "on-goout": "bg-violet-500", "on-leave": "bg-amber-500", completed: "bg-slate-400", off: "bg-slate-300" }[s]; }
function badgeCls(s: ClockStatus) { return { working: "bg-emerald-50 text-emerald-700 ring-emerald-200", "on-meal": "bg-orange-50 text-orange-700 ring-orange-200", "on-rest": "bg-sky-50 text-sky-700 ring-sky-200", "on-unpaid": "bg-rose-50 text-rose-700 ring-rose-200", "on-goout": "bg-violet-50 text-violet-700 ring-violet-200", "on-leave": "bg-amber-50 text-amber-700 ring-amber-200", completed: "bg-slate-100 text-slate-600 ring-slate-200", off: "bg-slate-100 text-slate-400 ring-slate-200" }[s]; }
function badgeLabel(s: ClockStatus) { return { working: "On Duty", "on-meal": "On Meal", "on-rest": "On Rest", "on-unpaid": "Unpaid Break", "on-goout": "Go-Out", "on-leave": "On Leave", completed: "Done", off: "Off-duty" }[s]; }
