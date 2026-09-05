import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, Button, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon, type IconName } from "../components/icons";
import { Monitor } from "./Monitor";
import { Staff } from "./Staff";
import { computeSession } from "../lib/timeclock";
import { formatBDTCompact, formatNumber } from "../lib/currency";
import { formatTime12 } from "../lib/dates";
import { configValue, COUNTER_NUMBERS } from "../lib/config";
import { cn } from "../lib/utils";
import type { Employee } from "../types";

type Tab = "overview" | "floor" | "staff" | "counters";

export function Dashboard() {
  const { data, navigate, assignCounter } = useApp();
  const now = useNow(5000);
  const [tab, setTab] = useState<Tab>("overview");
  const [pickFor, setPickFor] = useState<number | null>(null);

  const tabs: { key: Tab; label: string; icon: IconName }[] = [
    { key: "overview", label: "Overview", icon: "dashboard" },
    { key: "floor", label: "Live Floor", icon: "store" },
    { key: "staff", label: "Staff", icon: "users2" },
    { key: "counters", label: "Counters", icon: "store" },
  ];

  return (
    <div className="space-y-5 animate-fade">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-emerald-700 via-teal-700 to-emerald-900 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-200">{configValue(data.config, "ORG_NAME", "Khan Pharmacy")}</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Admin Control Center</h2>
              <p className="mt-1.5 text-sm text-emerald-100/80">Floor tracking 9:00 AM – 11:00 PM · {formatTime12(new Date(now).toISOString())}</p>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("flex shrink-0 items-center gap-2 px-5 py-3 text-sm font-semibold transition", tab === t.key ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-800")}>
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          ))}
        </div>
      </Card>

      {tab === "overview" && <Overview navigate={navigate} />}
      {tab === "floor" && <Monitor />}
      {tab === "staff" && <Staff />}
      {tab === "counters" && <Counters pickFor={pickFor} setPickFor={setPickFor} onAssign={assignCounter} />}
    </div>
  );
}

function Overview({ navigate }: { navigate: (p: "monitor" | "staff" | "leave" | "payments") => void }) {
  const { data, todaySession, isOnLeaveToday } = useApp();
  const now = useNow(5000);
  const active = data.staff.filter((s) => s.isActive);
  const todayPay = useMemo(() => {
    let pay = 0, onDuty = 0;
    for (const s of active) {
      const sess = todaySession(s.employeeId);
      if (!sess) continue;
      pay += computeSession(sess, s, data.config, now).netPay;
      onDuty++;
    }
    return { pay, onDuty };
  }, [active, todaySession, data.config, now]);
  const onLeave = active.filter((s) => isOnLeaveToday(s.employeeId));
  const pharmaCount = active.filter((s) => s.department === "Pharmacy Counter" && s.counter).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon="users2" tone="indigo" label="Active Staff" value={formatNumber(active.length)} sub={`${pharmaCount} on counters`} action={() => navigate("staff")} />
        <Kpi icon="store" tone="emerald" label="On Duty Now" value={formatNumber(todayPay.onDuty)} action={() => navigate("monitor")} />
        <Kpi icon="handCoin" tone="emerald" label="Pay Today (est.)" value={formatBDTCompact(todayPay.pay)} action={() => navigate("payments")} />
        <Kpi icon="calendar" tone="amber" label="On Leave" value={formatNumber(onLeave.length)} action={() => navigate("leave")} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="calendar" size={16} className="text-emerald-600" /> On Leave Today</h3>
            <Button size="sm" variant="ghost" onClick={() => navigate("leave")}>Manage</Button>
          </div>
          <div className="mt-4">
            {onLeave.length === 0 ? <EmptyState icon="check" title="No one on leave" /> : (
              <div className="space-y-2">
                {onLeave.map((s) => {
                  const annual = data.leaveBalances.find((b) => b.staffId === s.employeeId && b.leaveType === "Annual");
                  const rem = annual ? annual.entitledDays - annual.usedDays : 0;
                  return (
                    <div key={s.employeeId} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                      <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={36} />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{s.fullName}</p><p className="text-xs text-slate-400">{s.employeeId} · {rem}d annual left</p></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="store" size={16} className="text-emerald-600" /> Counter Coverage</h3>
            <Button size="sm" variant="ghost" onClick={() => navigate("staff")}>All staff</Button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {COUNTER_NUMBERS.map((n) => {
              const s = active.find((x) => x.counter === n && x.department === "Pharmacy Counter");
              return (
                <div key={n} className={cn("rounded-lg border p-2 text-center", s ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-slate-200")}>
                  <p className="text-[10px] font-bold uppercase text-slate-400">Counter {n}</p>
                  {s ? <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={28} /> : <span className="mx-auto mt-1 block text-lg text-slate-300">—</span>}
                  {s && <p className="mt-1 truncate text-[10px] text-slate-500">{s.fullName.split(" ")[0]}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Counters({ pickFor, setPickFor, onAssign }: { pickFor: number | null; setPickFor: (n: number | null) => void; onAssign: (id: string, c: number | null) => void }) {
  const { data } = useApp();
  const active = data.staff.filter((s) => s.isActive && s.department === "Pharmacy Counter");
  const assigned = (n: number) => active.find((s) => s.counter === n);

  return (
    <div className="space-y-5">
      <Card className="border-emerald-200 bg-emerald-50/30 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><Icon name="store" size={16} /> Pharmacy Counter Management</h3>
        <p className="mt-1 text-sm text-emerald-700/80">9 designated counters. Assign or reassign staff to any counter.</p>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COUNTER_NUMBERS.map((n) => {
          const s = assigned(n);
          return (
            <Card key={n} className={cn("p-5", s && "border-emerald-200")}>
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">C{n}</span>
                {s ? <StatusBadge text="Assigned" tone="emerald" /> : <StatusBadge text="Empty" tone="slate" />}
              </div>
              {s ? (
                <div className="mt-4 flex items-center gap-3">
                  <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{s.fullName}</p>
                    <p className="truncate text-xs text-slate-400">{s.jobTitle} · {s.employeeId}</p>
                  </div>
                  <Button size="sm" variant="secondary" icon="pencil" onClick={() => setPickFor(n)}>Change</Button>
                </div>
              ) : (
                <div className="mt-4">
                  <Button size="sm" variant="primary" icon="plus" className="w-full" onClick={() => setPickFor(n)}>Assign Staff</Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {pickFor !== null && (
        <PickerModal counter={pickFor} active={active} onClose={() => setPickFor(null)} onPick={(id) => { onAssign(id, pickFor); setPickFor(null); }} onClear={() => { const s = assigned(pickFor); if (s) onAssign(s.employeeId, null); setPickFor(null); }} current={assigned(pickFor)?.employeeId} />
      )}
    </div>
  );
}

function PickerModal({ counter, active, current, onClose, onPick, onClear }: { counter: number; active: Employee[]; current?: string; onClose: () => void; onPick: (id: string) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const list = active.filter((s) => !q || s.fullName.toLowerCase().includes(q.toLowerCase()) || s.employeeId.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-scale-in sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Assign to Counter {counter}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><Icon name="x" size={18} /></button>
        </div>
        <div className="p-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" className="mb-3 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {list.map((s) => (
              <button key={s.employeeId} onClick={() => onPick(s.employeeId)} className={cn("flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-slate-50", current === s.employeeId && "bg-emerald-50")}>
                <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={34} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{s.fullName}</p><p className="truncate text-xs text-slate-400">{s.jobTitle} · {s.employeeId}{s.counter ? ` · now C${s.counter}` : ""}</p></div>
                {current === s.employeeId && <Icon name="check" size={16} className="text-emerald-600" />}
              </button>
            ))}
            {list.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No matching staff.</p>}
          </div>
          {current && <button onClick={onClear} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"><Icon name="x" size={15} /> Clear counter {counter}</button>}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, tone, label, value, sub, action }: { icon: IconName; tone: "indigo" | "emerald" | "amber"; label: string; value: string; sub?: string; action?: () => void }) {
  const c = { indigo: "bg-indigo-50 text-indigo-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600" }[tone];
  const tc = { indigo: "text-indigo-600", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", tc)}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", c)}><Icon name={icon} size={18} /></span>
      </div>
      {action && <button onClick={action} className="mt-2 text-xs font-semibold text-emerald-600 hover:underline">View →</button>}
    </Card>
  );
}

function StatusBadge({ text, tone }: { text: string; tone: "emerald" | "slate" }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset", tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200")}>{text}</span>;
}


