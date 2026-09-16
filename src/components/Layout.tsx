import { useState, type ReactNode } from "react";
import { useApp, type PageId } from "../context/AppContext";
import { ROLE_LABEL, ROLE_COLOR, type Permission } from "../lib/auth";
import { cn } from "../lib/utils";
import { PhotoAvatar } from "./PhotoAvatar";
import { Icon, type IconName } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem { page: PageId; label: string; icon: IconName; perm: Permission; }

const ADMIN_NAV: { label: string; items: NavItem[] }[] = [
  { label: "Main", items: [
    { page: "dashboard", label: "Dashboard", icon: "dashboard", perm: "manage.staff" },
    { page: "staff", label: "Staff Management", icon: "users2", perm: "manage.staff" },
    { page: "attendance", label: "Attendance Analytics", icon: "clock", perm: "view.attendance" },
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
  { page: "attendance", label: "Live Attendance", icon: "clock", perm: "view.attendance" },
  { page: "leave", label: "Leave Management", icon: "calendar", perm: "manage.leave" },
  { page: "payments", label: "Pay", icon: "receipt", perm: "pay.staff" },
];

const TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Live operational snapshot" },
  monitor: { title: "Live Floor", subtitle: "Real-time staff clock & break status" },
  staff: { title: "Staff", subtitle: "Manage staff, duty times & salary" },
  attendance: { title: "Attendance", subtitle: "Sessions, analytics & live clock controls" },
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
  const { session, role, view, navigate, logout, data, canPerm } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = TITLES[view.page];

  const groups = role === "ADMIN" ? ADMIN_NAV : [{ label: "Main", items: SUPERVISOR_NAV.filter((i) => canPerm(i.perm)) }];

  const Sidebar = (
    <div className="flex h-full flex-col">
      {/* Text-only brand header — no logo */}
<div className="px-5 py-5">
        <p className="text-base font-extrabold tracking-tight text-white">KPSMS</p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-bright">Khan Pharmacy Staff Management</p>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((i) => {
                const active = view.page === i.page || (view.page === "payslip" && i.page === "payments") || ((view.page === "staff") && i.page === "dashboard");
                return (
                  <button key={i.page} onClick={() => { navigate(i.page); setMobileOpen(false); }}
                    className={cn("group flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-all",
                      active ? "bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-md shadow-primary/25" : "text-slate-300 hover:bg-slate-800 hover:text-white")}>
                    <Icon name={i.icon} size={18} className={active ? "text-white" : "text-slate-400 group-hover:text-slate-200"} />
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
          <button onClick={logout} title="Sign out" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white"><Icon name="logout" size={17} /></button>
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
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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

