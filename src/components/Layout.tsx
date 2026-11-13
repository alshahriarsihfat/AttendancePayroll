import { useState, type ReactNode } from "react";
import { useApp, type PageId } from "../context/AppContext";
import { ROLE_LABEL, ROLE_COLOR, type Permission } from "../lib/auth";
import { cn } from "../lib/utils";
import { PhotoAvatar } from "./PhotoAvatar";
import { Icon, type IconName } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem { page: PageId; label: string; icon: IconName; perm: Permission; }

const ADMIN_NAV: { label: string; items: NavItem[] }[] = [
  { label: 'Main', items: [
    { page: 'dashboard', label: 'Dashboard', icon: 'dashboard', perm: 'manage.staff' },
    { page: 'staff', label: 'Staff Management', icon: 'users2', perm: 'manage.staff' },
    { page: 'payments', label: 'Payroll', icon: 'receipt', perm: 'pay.staff' },
    { page: 'attendance', label: 'Attendance Analytics', icon: 'clock', perm: 'view.attendance' },
    { page: 'settings', label: 'Settings', icon: 'settings', perm: 'manage.config' },
  ] },
];

const SUPERVISOR_NAV: NavItem[] = [
  { page: "attendance", label: "Attendance", icon: "clock", perm: "view.attendance" },
  { page: "monitor", label: "Live Floor", icon: "store", perm: "view.floor" },
  { page: "payments", label: "Payroll", icon: "receipt", perm: "pay.staff" },
  { page: "leave", label: "Leave Management", icon: "calendar", perm: "manage.leave" },
];

const TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Live operational snapshot" },
  monitor: { title: "Live Floor", subtitle: "Real-time staff clock & break status" },
  staff: { title: "Staff", subtitle: "Manage staff, duty times & salary" },
  attendance: { title: "Attendance", subtitle: "Sessions, analytics & live clock controls" },
  leave: { title: "Leave", subtitle: "Requests, approvals & balances" },
  payments: { title: "Payroll", subtitle: "Pay, history & batch settlement" },
  payslip: { title: "Payslip", subtitle: "Receipt view" },
  settings: { title: "Settings", subtitle: "Business rules & configuration" },
  guide: { title: "Guide", subtitle: "How to use this system" },
  terminal: { title: "Time Clock", subtitle: "Clock in, breaks & clock out" },
  profile: { title: "My Profile", subtitle: "Your shifts & payslips" },
  stafftime: { title: "Staff Time", subtitle: "Review a staff member's clock records" },
};

export function Layout({ children }: { children: ReactNode }) {
  const { session, role, view, navigate, logout, data, canPerm } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = TITLES[view.page];

  const groups = role === "ADMIN"
    ? ADMIN_NAV
    : [{ label: "Main", items: role === "SUPERVISOR" ? SUPERVISOR_NAV : SUPERVISOR_NAV.filter((i) => canPerm(i.perm)) }];

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800/90 px-4 py-4">
        <p className="text-[15px] font-bold tracking-tight text-slate-50">KPSMS</p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Khan Pharmacy Staff Management</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{g.label}</p>
            <div className="space-y-1">
              {g.items.map((i) => {
                const active = view.page === i.page || (view.page === "payslip" && i.page === "payments") || ((view.page === "staff") && i.page === "dashboard");
                return (
                  <button key={i.page} onClick={() => { navigate(i.page); setMobileOpen(false); }}
                    className={cn("group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      active ? "bg-primary/15 text-white ring-1 ring-inset ring-primary/25" : "text-slate-300 hover:bg-slate-800/80 hover:text-slate-100")}>
                    {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-bright" aria-hidden="true" />}
                    <Icon name={i.icon} size={18} className={cn("shrink-0", active ? "text-primary-bright" : "text-slate-400 group-hover:text-slate-300")} />
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-800/90 px-3 py-3">
        <div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 py-2.5">
          <PhotoAvatar name={session?.name ?? "U"} photoUrl={session?.staffId ? data.staff.find((e) => e.employeeId === session.staffId)?.photoUrl : undefined} size={34} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{session?.name}</p><p className={cn("mt-0.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", ROLE_COLOR[role])}>{ROLE_LABEL[role]}</p></div>
          <button onClick={logout} title="Sign out" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-700/70 hover:text-slate-100"><Icon name="logout" size={17} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-page transform-gpu">
      <aside className="pl-chrome hidden w-64 shrink-0 bg-slate-900 lg:block will-change-transform">{Sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden transform-gpu">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-slate-900 animate-slide-up will-change-transform">{Sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col transform-gpu">
        <header className="pl-chrome flex h-16 shrink-0 items-center gap-3 border-b border-edge bg-surface px-4 sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted lg:hidden"><Icon name="menu" size={20} /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight text-foreground">{header.title}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{header.subtitle}</p>
          </div>
          <ThemeToggle />
        </header>
        <main id="pl-scroll" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
            {children}
          </div>
        </main>
      </div>
      {/* Ephemeral toasts only — no persistent "all-time" notification widget */}
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  const cfg: Record<string, { icon: IconName; cls: string }> = {
    success: { icon: "check", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25" },
    error: { icon: "alert", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25" },
    info: { icon: "info", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25" },
  };
  return (
    // Floating corner toasts — no persistent bottom bar occupies the viewport now.
    <div className="pointer-events-none fixed bottom-5 right-4 z-60 flex w-full max-w-sm flex-col gap-2 sm:right-5">
      {toasts.map((t) => {
        const c = cfg[t.type];
        return (
          <div key={t.id} className={cn("pointer-events-auto flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-card-lg ring-1 animate-slide-up", c.cls)}>
            <Icon name={c.icon} size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm font-medium">{t.message}</p>
            <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100"><Icon name="x" size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}


