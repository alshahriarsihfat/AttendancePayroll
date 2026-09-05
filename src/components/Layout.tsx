import { useState, type ReactNode } from "react";
import { useApp, type PageId } from "../context/AppContext";
import { ROLE_LABEL, ROLE_COLOR, type Permission } from "../lib/auth";
import { cn } from "../lib/utils";
import { PhotoAvatar } from "./PhotoAvatar";
import { Icon, type IconName } from "./icons";

interface NavItem { page: PageId; label: string; icon: IconName; perm: Permission; }

const ADMIN_NAV: { label: string; items: NavItem[] }[] = [
  { label: "Main", items: [
    { page: "dashboard", label: "Dashboard", icon: "dashboard", perm: "manage.staff" },
    { page: "staff", label: "Staff Management", icon: "users2", perm: "manage.staff" },
    { page: "attendance", label: "Attendance", icon: "clock", perm: "view.attendance" },
    { page: "leave", label: "Leave", icon: "calendar", perm: "manage.leave" },
    { page: "payments", label: "Payments", icon: "receipt", perm: "pay.staff" },
  ] },
  { label: "System", items: [
    { page: "settings", label: "Settings", icon: "settings", perm: "manage.config" },
    { page: "guide", label: "Setup & Data", icon: "fileText", perm: "manage.config" },
  ] },
];

const SUPERVISOR_NAV: NavItem[] = [
  { page: "monitor", label: "Dashboard", icon: "dashboard", perm: "view.floor" },
  { page: "leave", label: "Leave Management", icon: "calendar", perm: "manage.leave" },
  { page: "payments", label: "Pay", icon: "receipt", perm: "pay.staff" },
  { page: "terminal", label: "My Clock", icon: "timer", perm: "clock.self" },
];

const TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Overview · Live Floor · Staff · Counters" },
  monitor: { title: "Live Floor", subtitle: "Real-time staff clock & break status" },
  staff: { title: "Staff", subtitle: "Manage staff, duty times & salary" },
  attendance: { title: "Attendance", subtitle: "Clock sessions, hours & performance" },
  leave: { title: "Leave", subtitle: "Requests, approvals & balances" },
  payments: { title: "Payments", subtitle: "Payslips, payouts & overtime" },
  payslip: { title: "Payslip", subtitle: "Earnings, deductions & net pay" },
  settings: { title: "Settings", subtitle: "Shifts, breaks, PINs & sync" },
  guide: { title: "Setup & Data Guide", subtitle: "Manage data & connect Google Sheets" },
  stafftime: { title: "Staff Time Management", subtitle: "Manage any staff member's clock on their behalf" },
  terminal: { title: "My Clock Terminal", subtitle: "" },
  profile: { title: "Profile", subtitle: "" },
};

export function Layout({ children }: { children: ReactNode }) {
  const { session, role, view, navigate, logout, data, canPerm, mustClockInFirst } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = TITLES[view.page];

  // Supervisors must clock in before admin rails unlock.
  const locked = role === "SUPERVISOR" && mustClockInFirst;
  const groups = role === "ADMIN" ? ADMIN_NAV : [{ label: "Main", items: SUPERVISOR_NAV.filter((i) => canPerm(i.perm)) }];

  const Sidebar = (
    <div className="flex h-full flex-col">
      {/* Text-only brand header — no logo */}
      <div className="px-5 py-5">
        <p className="text-base font-extrabold tracking-tight text-white">AttendancePayroll</p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300/80">Attendance &amp; Payroll</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((i) => {
                const active = view.page === i.page || (view.page === "payslip" && i.page === "payments") || ((view.page === "staff") && i.page === "dashboard");
                // Supervisor admin rails (not their own clock) stay locked until they clock in.
                const itemLocked = locked && i.page !== "terminal";
                return (
                  <button key={i.page} disabled={itemLocked} onClick={() => { if (!itemLocked) { navigate(i.page); setMobileOpen(false); } }}
                    className={cn("group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-emerald-600 text-white shadow-sm shadow-emerald-900/30" : "text-slate-300 hover:bg-slate-800 hover:text-white",
                      itemLocked && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-slate-300")}>
                    <Icon name={itemLocked ? "lock" : i.icon} size={18} className={active ? "text-white" : "text-slate-400 group-hover:text-slate-200"} />
                    <span className="flex-1 text-left">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <PhotoAvatar name={session?.name ?? "U"} photoUrl={session?.staffId ? data.staff.find((e) => e.employeeId === session.staffId)?.photoUrl : undefined} size={36} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{session?.name}</p><p className={cn("inline-block rounded px-1.5 text-[10px] font-semibold ring-1 ring-inset", ROLE_COLOR[role])}>{ROLE_LABEL[role]}</p></div>
          <button onClick={logout} title="Sign out" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"><Icon name="logout" size={17} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside className="pl-chrome hidden w-64 shrink-0 bg-slate-900 lg:block">{Sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-slate-900 animate-slide-up">{Sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pl-chrome flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"><Icon name="menu" size={20} /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">{header.title}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{header.subtitle}</p>
          </div>
          {locked && (
            <span className="hidden items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200 sm:flex">
              <Icon name="lock" size={13} /> Clock in to unlock tools
            </span>
          )}
        </header>
        <main id="pl-scroll" className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {locked && (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><Icon name="lock" size={20} /></span>
                <div className="flex-1"><p className="text-sm font-semibold text-amber-800">Clock in to begin your shift</p><p className="text-xs text-amber-600">As a supervisor you must clock in first. Pay, Leave &amp; Live Floor unlock afterwards.</p></div>
                <button onClick={() => navigate("terminal")} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">Open Clock-In</button>
              </div>
            )}
            {children}
          </div>
        </main>
        {/* Supervisor bottom bar / footer with profile changer */}
        {role === "SUPERVISOR" && session?.staffId && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <PhotoAvatar name={session.name} photoUrl={data.staff.find((e) => e.employeeId === session.staffId)?.photoUrl} size={30} />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-800">{session.name}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Supervisor · {session.staffId}</p>
              </div>
            </div>
            <button onClick={() => navigate("terminal")} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">
              <Icon name="timer" size={14} /> {locked ? "Clock In" : "My Clock"}
            </button>
          </footer>
        )}
      </div>
      {/* Ephemeral toasts only — no persistent "all-time" notification widget */}
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  const cfg: Record<string, { icon: IconName; cls: string }> = {
    success: { icon: "check", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    error: { icon: "alert", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    info: { icon: "info", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  };
  return (
    // Raised above the supervisor bottom bar so it never covers action buttons.
    <div className="pointer-events-none fixed bottom-20 right-4 z-60 flex w-full max-w-sm flex-col gap-2 sm:bottom-5 sm:right-5">
      {toasts.map((t) => {
        const c = cfg[t.type];
        return (
          <div key={t.id} className={cn("pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 shadow-lg ring-1 animate-slide-up", c.cls)}>
            <Icon name={c.icon} size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm font-medium">{t.message}</p>
            <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100"><Icon name="x" size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
