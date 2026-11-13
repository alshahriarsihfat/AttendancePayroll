import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, Button, EmptyState, Select } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon, type IconName } from "../components/icons";
import { HeroBand } from "../components/HeroBand";

import { Staff } from "./Staff";
import { computeSession, dhakaTodayKey } from "../lib/timeclock";
import { formatBDT, formatBDTCompact, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDuration, formatLongDate, formatTime12, isoDate, addDays, parseISO, monthKey } from "../lib/dates";
import { configValue, COUNTER_NUMBERS } from "../lib/config";
import { cn } from "../lib/utils";
import type { ClockStatus, Employee } from "../types";

type Tab = "overview" | "staff" | "counters";

function statusOf(s: Employee, todaySession: (id: string) => any, isOnLeaveToday: (id: string) => boolean, config: any[], now: number): { status: ClockStatus; calc: ReturnType<typeof computeSession>; sess: any } {
  const onLeave = isOnLeaveToday(s.employeeId);
  const sess = todaySession(s.employeeId);
  const calc = computeSession(sess, s, config, now);
  const status: ClockStatus = onLeave ? "on-leave" : sess ? calc.clockStatus : "off";
  return { status, calc, sess };
}

export function Dashboard() {
  const { data, role, navigate, assignCounter, canPerm } = useApp();
  const now = useNow(5000);
  const [tab, setTab] = useState<Tab>("overview");
  const [pickFor, setPickFor] = useState<number | null>(null);
  const todayKey = dhakaTodayKey();

  const canManageStaff = canPerm("manage.staff");
  const tabs: { key: Tab; label: string; icon: IconName }[] = [
    { key: "overview", label: "Overview", icon: "dashboard" },
    ...(canManageStaff ? [
      { key: "staff" as Tab, label: "Staff", icon: "users2" as IconName },
      { key: "counters" as Tab, label: "Counters", icon: "store" as IconName },
    ] : []),
  ];
  const activeTab: Tab = canManageStaff ? tab : tab === "staff" || tab === "counters" ? "overview" : tab;

  return (
    <div className="space-y-5 animate-fade">
      <HeroBand
        eyebrow={configValue(data.config, "ORG_NAME", "Khan Pharmacy")}
        title={role === "SUPERVISOR" ? "Supervisor Control Center" : "Admin Dashboard"}
        subtitle={`${formatLongDate(now)} · ${formatTime12(new Date(now).toISOString())} (Dhaka) · Live operational snapshot`}
        icon="dashboard"
        stats={[
          { label: "Active Staff", value: data.staff.filter((s) => s.isActive).length, icon: "users2" },
          { label: "On Duty", value: data.sessions.filter((s) => s.date === todayKey && !s.timeOut).length, icon: "clock" },
          { label: "Today", value: formatDate(todayKey), icon: "calendar" },
        ]}
      />

      <Card className="p-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition", activeTab === t.key ? "bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-sm shadow-primary/25" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground")}>
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === "overview" && <Overview navigate={navigate} />}
      {activeTab === "staff" && canManageStaff && <Staff />}
      {activeTab === "counters" && canManageStaff && <Counters pickFor={pickFor} setPickFor={setPickFor} onAssign={assignCounter} />}
    </div>
  );
}

function Overview({ navigate }: { navigate: (p: any, params?: any) => void }) {
  const { data, todaySession, isOnLeaveToday } = useApp();
  const now = useNow(5000);
  const todayKey = dhakaTodayKey();
  const active = data.staff.filter((s) => s.isActive);

  const computed = useMemo(() => {
    let present = 0, onDuty = 0, completed = 0, late = 0, onBreak = 0, onLeave = 0, absent = 0, payEst = 0, otPayEst = 0, workedMin = 0;
    const rows = active.map((s) => {
      const { status, calc, sess } = statusOf(s, todaySession, isOnLeaveToday, data.config, now);
      if (status === "on-leave") onLeave++;
      else if (sess) {
        present++;
        workedMin += calc.grossMin;
        payEst += calc.netPay;
        otPayEst += calc.overtimePay;
        if (calc.isLate) late++;
        if (status === "working") onDuty++;
        if (["on-meal", "on-rest", "on-unpaid", "on-goout"].includes(status)) onBreak++;
        if (status === "completed") completed++;
      } else absent++;
      return { staff: s, status, calc, sess };
    });
    return { rows, present, onDuty, completed, late, onBreak, onLeave, absent, payEst: payRound(payEst), otPayEst: payRound(otPayEst), workedMin, paidToday: payRound(data.payments.filter((p) => p.date === todayKey).reduce((s, p) => s + p.netPay, 0)), pendingDays: data.sessions.filter((s) => s.timeOut && !data.payments.some((p) => p.sessionId === s.id)).length };
  }, [active, todaySession, isOnLeaveToday, data.config, data.payments, data.sessions, now, todayKey]);

  const statusMix = [
    { label: "Present/Active", value: computed.present, color: "bg-emerald-500" },
    { label: "On Leave", value: computed.onLeave, color: "bg-amber-500" },
    { label: "Absent/Not In", value: computed.absent, color: "bg-slate-400" },
  ];
  const mixTotal = Math.max(1, statusMix.reduce((s, x) => s + x.value, 0));

  const recent = useMemo(() => {
    return data.sessions
      .filter((s) => s.date >= isoDate(addDays(parseISO(todayKey), -2)))
      .map((s) => {
        const staff = data.staff.find((e) => e.employeeId === s.staffId);
        const calc = staff ? computeSession(s, staff, data.config, s.timeOut ? new Date(s.timeOut).getTime() : now) : null;
        return { s, staff, calc };
      })
      .filter((r) => r.staff)
      .sort((a, b) => (b.s.timeIn || b.s.date).localeCompare(a.s.timeIn || a.s.date))
      .slice(0, 8);
  }, [data.sessions, data.staff, data.config, now, todayKey]);

  if (active.length === 0) {
    return <Card className="p-10"><EmptyState icon="users2" title="No active staff" desc="Add staff in Staff Management to see dashboard insights." action={canNavigateStaff(data) ? <Button icon="plus" onClick={() => navigate("staff")}>Open Staff</Button> : undefined} /></Card>;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Kpi icon="users2" tone="primary" label="Active Staff" value={formatNumber(active.length)} sub={`${computed.present} clocked in`} onClick={() => navigate("staff")} />
        <Kpi icon="clock" tone="emerald" label="On Duty Now" value={formatNumber(computed.onDuty)} sub={`${computed.onBreak} on break`} />
        <Kpi icon="alert" tone="amber" label="Late Today" value={formatNumber(computed.late)} sub="Based on clock-ins" onClick={() => navigate("attendance")} />
        <Kpi icon="calendar" tone="amber" label="On Leave" value={formatNumber(computed.onLeave)} sub={`${computed.absent} not in`} onClick={() => navigate("leave")} />
        <Kpi icon="handCoin" tone="emerald" label="Pay Today (est.)" value={formatBDTCompact(computed.payEst)} sub={`OT ${formatBDTCompact(computed.otPayEst)}`} onClick={() => navigate("payments")} />
        <Kpi icon="receipt" tone="primary" label="Paid Today" value={formatBDTCompact(computed.paidToday)} sub={`${computed.pendingDays} unpaid days`} onClick={() => navigate("payments")} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3"><p className="text-sm font-semibold text-foreground">Today’s Attendance Overview</p><Button size="sm" variant="ghost" onClick={() => navigate("attendance")}>Analytics</Button></div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniPanel label="Present" value={String(computed.present)} tone="emerald" />
              <MiniPanel label="Completed" value={String(computed.completed)} />
              <MiniPanel label="On Break" value={String(computed.onBreak)} tone="amber" />
              <MiniPanel label="Absent/Not In" value={String(computed.absent)} />
            </div>
            <div className="mt-4 rounded-xl border border-edge bg-surface-muted/30 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Status distribution (today)</p>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-muted">
                {statusMix.map((m) => m.value > 0 ? <div key={m.label} className={m.color} style={{ width: `${(m.value / mixTotal) * 100}%` }} title={`${m.label}: ${m.value}`} /> : null)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {statusMix.map((m) => <span key={m.label} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", m.color)} />{m.label}: <span className="font-semibold text-foreground">{m.value}</span></span>)}
              </div>
            </div>
          </div>
          <div className="border-t border-edge">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-edge bg-surface-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-4 py-2.5">Staff</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">In</th><th className="px-3 py-2.5 text-right">Worked</th><th className="px-4 py-2.5 text-right">Net (est.)</th></tr></thead>
                <tbody className="divide-y divide-edge">
                  {computed.rows.filter((r) => r.sess || r.status === "on-leave").slice(0, 8).map((r) => (
                    <tr key={r.staff.employeeId} className="hover:bg-surface-muted/30"><td className="px-4 py-2.5"><div className="flex items-center gap-2"><PhotoAvatar name={r.staff.fullName} photoUrl={r.staff.photoUrl} size={28} /><span className="truncate font-medium text-foreground">{r.staff.fullName}</span></div></td><td className="px-3 py-2.5"><StatusPill status={r.status} /></td><td className="px-3 py-2.5 text-xs text-muted-foreground">{r.sess ? formatTime12(r.sess.timeIn) : "—"}</td><td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{r.sess ? formatDuration(r.calc.grossMin).replace("h ", "h") : "—"}</td><td className="px-4 py-2.5 text-right text-xs font-semibold tabular-nums">{r.sess ? formatBDT(r.calc.netPay, false) : "—"}</td></tr>
                  ))}
                  {computed.rows.filter((r) => r.sess || r.status === "on-leave").length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-faint-foreground">No attendance activity yet today.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="chart" size={16} className="text-primary" /> Operational Notes</h3><span className="text-xs text-faint-foreground">Existing data only</span></div>
            <div className="mt-4 space-y-2 text-sm">
              <Note label="Worked time today (est.)" value={formatDuration(computed.workedMin)} />
              <Note label="Late arrivals" value={`${computed.late} staff`} tone={computed.late > 0 ? "amber" : undefined} />
              <Note label="Payroll dues pending" value={`${computed.pendingDays} day${computed.pendingDays === 1 ? "" : "s"}`} tone={computed.pendingDays > 0 ? "amber" : undefined} />
              <Note label="Counter coverage" value={`${active.filter((s) => s.department === "Pharmacy Counter" && s.counter).length}/${COUNTER_NUMBERS.length}`} />
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon name="clock" size={16} className="text-primary" /> Recent Activity</h3></div>
            {recent.length === 0 ? <p className="mt-3 text-sm text-faint-foreground">No recent session activity.</p> : (
              <div className="mt-3 space-y-2">
                {recent.map(({ s, staff }) => (
                  <div key={s.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-surface-muted/30 p-2.5">
                    <PhotoAvatar name={staff?.fullName ?? "?"} photoUrl={staff?.photoUrl} size={30} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{staff?.fullName}</p><p className="text-[11px] text-faint-foreground">{formatDate(s.date)} · In {formatTime12(s.timeIn)}{s.timeOut ? ` · Out ${formatTime12(s.timeOut)}` : " · On duty"}</p></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function canNavigateStaff(data: any) { return true; }

function Counters({ pickFor, setPickFor, onAssign }: { pickFor: number | null; setPickFor: (n: number | null) => void; onAssign: (id: string, c: number | null) => void }) {
  const { data } = useApp();
  const active = data.staff.filter((s) => s.isActive && s.department === "Pharmacy Counter");
  const assigned = (n: number) => active.find((s) => s.counter === n);
  return (
    <div className="space-y-5">
      <Card className="border-primary/30 bg-primary-soft/40 p-5"><h3 className="flex items-center gap-2 text-sm font-semibold text-primary"><Icon name="store" size={16} /> Pharmacy Counter Management</h3><p className="mt-1 text-sm text-primary/80">Assign or reassign staff to designated counters.</p></Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COUNTER_NUMBERS.map((n) => {
          const s = assigned(n);
          return (
            <Card key={n} className={cn("p-5", s && "border-primary/30")}>
              <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-primary-deep to-primary-bright text-sm font-bold text-white">C{n}</span><StatusBadge text={s ? "Assigned" : "Empty"} tone={s ? "emerald" : "slate"} /></div>
              {s ? (
                <div className="mt-4 flex items-center gap-3"><PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={40} /><div className="min-w-0 flex-1"><p className="truncate font-semibold text-foreground">{s.fullName}</p><p className="truncate text-xs text-faint-foreground">{s.jobTitle} · {s.employeeId}</p></div><Button size="sm" variant="secondary" icon="pencil" onClick={() => setPickFor(n)}>Change</Button></div>
              ) : (<div className="mt-4"><Button size="sm" variant="primary" icon="plus" className="w-full" onClick={() => setPickFor(n)}>Assign Staff</Button></div>)}
            </Card>
          );
        })}
      </div>
      {pickFor !== null && <PickerModal counter={pickFor} active={active} onClose={() => setPickFor(null)} onPick={(id) => { onAssign(id, pickFor); setPickFor(null); }} onClear={() => { const s = assigned(pickFor); if (s) onAssign(s.employeeId, null); setPickFor(null); }} current={assigned(pickFor)?.employeeId} />}
    </div>
  );
}

function PickerModal({ counter, active, current, onClose, onPick, onClear }: { counter: number; active: Employee[]; current?: string; onClose: () => void; onPick: (id: string) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const list = active.filter((s) => !q || s.fullName.toLowerCase().includes(q.toLowerCase()) || s.employeeId.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"><div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl bg-surface shadow-2xl animate-scale-in sm:rounded-2xl"><div className="flex items-center justify-between border-b border-edge px-5 py-4"><h3 className="text-base font-semibold text-foreground">Assign to Counter {counter}</h3><button onClick={onClose} className="text-faint-foreground hover:text-foreground"><Icon name="x" size={18} /></button></div>
        <div className="p-4"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" className="mb-3 h-10 w-full rounded-full border-0 bg-surface-muted px-4 text-sm text-foreground placeholder:text-faint-foreground focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25" />
          <div className="max-h-72 space-y-1 overflow-y-auto">{list.map((s) => (<button key={s.employeeId} onClick={() => onPick(s.employeeId)} className={cn("flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-surface-muted", current === s.employeeId && "bg-primary-soft")}><PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={34} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{s.fullName}</p><p className="truncate text-xs text-faint-foreground">{s.jobTitle} · {s.employeeId}{s.counter ? ` · now C${s.counter}` : ""}</p></div>{current === s.employeeId && <Icon name="check" size={16} className="text-primary" />}</button>))}{list.length === 0 && <p className="py-6 text-center text-sm text-faint-foreground">No matching staff.</p>}</div>
          {current && <button onClick={onClear} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-200 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/30"><Icon name="x" size={15} /> Clear counter {counter}</button>}
        </div></div></div>
  );
}

function Kpi({ icon, tone, label, value, sub, onClick }: { icon: IconName; tone: "primary" | "emerald" | "amber"; label: string; value: string; sub?: string; onClick?: () => void }) {
  const c = { primary: "bg-primary-soft text-primary", emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" }[tone];
  return (
    <Card className="p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>{sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}</div><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", c)}><Icon name={icon} size={17} /></span></div>{onClick && <button onClick={onClick} className="mt-2 text-xs font-semibold text-primary hover:underline">View</button>}</Card>
  );
}
function MiniPanel({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" }) {
  return <div className="rounded-xl border border-edge bg-surface p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className={cn("mt-1 text-lg font-bold tabular-nums", tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground")}>{value}</p></div>;
}
function Note({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-muted/30 px-3 py-2"><span className="text-muted-foreground">{label}</span><span className={cn("font-semibold tabular-nums", tone === "amber" ? "text-amber-600" : "text-foreground")}>{value}</span></div>;
}
function StatusBadge({ text, tone }: { text: string; tone: "emerald" | "slate" }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset", tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25" : "bg-surface-muted text-muted-foreground ring-edge")}>{text}</span>;
}
function StatusPill({ status }: { status: ClockStatus }) {
  const map: Record<string, { label: string; cls: string }> = {
    working: { label: "On Duty", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25" },
    "on-meal": { label: "Meal", cls: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25" },
    "on-rest": { label: "Rest", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25" },
    "on-unpaid": { label: "Unpaid Break", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25" },
    "on-goout": { label: "Go-Out", cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25" },
    completed: { label: "Done", cls: "bg-surface-muted text-muted-foreground ring-edge" },
    "on-leave": { label: "Leave", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25" },
    off: { label: "Not In", cls: "bg-surface-muted text-faint-foreground ring-edge" },
  };
  const m = map[status] || map.off;
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset", m.cls)}>{m.label}</span>;
}

