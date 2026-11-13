import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { computeSession } from "../lib/timeclock";
import { formatCountdown, formatElapsed, formatTime12, formatDuration, formatLongDate } from "../lib/dates";
import { cn } from "../lib/utils";
import type { ClockStatus, Employee } from "../types";

function otLabel(sess: any, nowMs: number): string | null {
  if (!sess?.overtimeActivatedAt) return null;
  if (!sess.timeOut) {
    const t = Date.parse(String(sess.overtimeActivatedAt));
    return `OVERTIME RUNNING${Number.isFinite(t) ? ` · ${formatDuration(Math.max(0, (nowMs - t) / 60000))}` : ""}`;
  }
  return null;
}

export function Monitor() {
  const { data, todaySession, navigate } = useApp();
  const now = useNow(1000);

  const rows = useMemo(() => {
    return data.staff
      .filter((s) => s.isActive)
      .map((s) => {
        const sess = todaySession(s.employeeId);
        const calc = computeSession(sess, s, data.config, now);
        const status: ClockStatus = sess ? calc.clockStatus : "off";
        return { staff: s, sess, calc, status };
      })
      .filter((r) => {
        // Authoritative session state: show only currently clocked-in staff with an
        // active, unfinished attendance session (includes On Break). Exclude not
        // clocked in, clocked out/completed, historical, and leave-without-clock-in.
        const activeSession = !!r.sess && !r.sess.timeOut && r.sess.completed === false;
        const activeStatus =
          r.status === "working" ||
          r.status === "on-meal" ||
          r.status === "on-rest" ||
          r.status === "on-unpaid" ||
          r.status === "on-goout";
        return activeSession && activeStatus;
      })
      .sort((a, b) => order(a.status) - order(b.status) || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [data.staff, data.config, todaySession, now]);

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Live Floor</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Real-time staff clock and break status</p>
        </div>
        <p className="text-sm font-medium tabular-nums text-muted-foreground">{formatTime12(new Date(now).toISOString())} · {formatLongDate(now)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <StaffCard
            key={r.staff.employeeId}
            staff={r.staff}
            sess={r.sess}
            calc={r.calc}
            status={r.status}
            now={now}
            onView={() => navigate("attendance")}
          />
        ))}
      </div>
      {rows.length === 0 && (
        <Card className="p-10">
          <EmptyState icon="users2" title="No active staff on floor" desc="Only currently clocked-in staff with active, unfinished sessions appear here." />
        </Card>
      )}
    </div>
  );
}

function order(s: ClockStatus): number {
  return { "on-meal": 0, "on-rest": 1, "on-unpaid": 1, "on-goout": 1, working: 2, completed: 3, off: 4, "on-leave": 5 }[s] ?? 9;
}

function StaffCard({ staff, sess, calc, status, now, onView }: {
  staff: Employee;
  sess: ReturnType<typeof useApp>["data"]["sessions"][number] | undefined;
  calc: ReturnType<typeof computeSession>;
  status: ClockStatus;
  now: number;
  onView: () => void;
}) {
  const onBreak = status === "on-meal" || status === "on-rest" || status === "on-unpaid" || status === "on-goout";
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;

  return (
    <Card className="overflow-hidden">
      <button onClick={onView} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-surface-muted">
        <div className="relative">
          <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={44} />
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white dark:ring-slate-900", dotColor(status))} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{staff.fullName}</p>
            {staff.counter && <span className="rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-bold text-primary ring-1 ring-inset ring-primary/25">C{staff.counter}</span>}
          </div>
          <p className="truncate text-xs text-faint-foreground">{staff.jobTitle} · {staff.employeeId}</p>
        </div>
        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", badgeCls(status))}>{badgeLabel(status)}</span>
      </button>

      <div className="border-t border-edge px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-faint-foreground">{onBreak ? "Break timer" : "On duty since"}</p>
            <p className={cn("text-lg font-bold tabular-nums", onBreak && calc.breakRemainingSec < 0 ? "text-rose-600" : "text-foreground")}>
              {onBreak ? formatCountdown(Math.abs(calc.activeElapsedSec)) : formatElapsed(elapsedMs)}
            </p>
            <p className="text-[11px] text-faint-foreground">In {formatTime12(sess?.timeIn)}{calc.lateMin > 0 ? ` · ${formatDuration(calc.lateMin)} late` : ""}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-faint-foreground">Status</p>
            <p className="text-sm font-semibold text-foreground">{otLabel(sess, now) ? otLabel(sess, now) : (onBreak ? "On Break" : "On Duty")}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function dotColor(s: ClockStatus) {
  return { working: "bg-emerald-500", "on-meal": "bg-orange-500", "on-rest": "bg-sky-500", "on-unpaid": "bg-rose-500", "on-goout": "bg-violet-500", "on-leave": "bg-amber-500", completed: "bg-slate-400", off: "bg-slate-300" }[s];
}
function badgeCls(s: ClockStatus) {
  return { working: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", "on-meal": "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25", "on-rest": "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25", "on-unpaid": "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25", "on-goout": "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25", "on-leave": "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25", completed: "bg-surface-muted text-muted-foreground ring-edge", off: "bg-surface-muted text-faint-foreground ring-edge" }[s];
}
function badgeLabel(s: ClockStatus) {
  return { working: "On Duty", "on-meal": "On Meal", "on-rest": "On Rest", "on-unpaid": "Unpaid Break", "on-goout": "Go-Out", "on-leave": "On Leave", completed: "Done", off: "Off-duty" }[s];
}
