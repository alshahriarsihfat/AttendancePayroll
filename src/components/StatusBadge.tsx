import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/** Semantic tone for any status string. Dark variants keep the same hue but
    lower the fill saturation / raise text contrast so badges stay scannable
    on dark surfaces. Never recolored to the royal-blue brand accent. */
export function statusTone(status: string): { label: string; cls: string; dot: string } {
  const map: Record<string, { cls: string; dot: string }> = {
    // employee
    Active: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    "On-leave": { cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25", dot: "bg-amber-500" },
    Terminated: { cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25", dot: "bg-rose-500" },
    // attendance
    Present: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    Late: { cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25", dot: "bg-amber-500" },
    "Half-day": { cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25", dot: "bg-sky-500" },
    Absent: { cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25", dot: "bg-rose-500" },
    Holiday: { cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25", dot: "bg-violet-500" },
    Weekoff: { cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-400" },
    // leave
    Pending: { cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25", dot: "bg-amber-500" },
    Approved: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    Rejected: { cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25", dot: "bg-rose-500" },
    Cancelled: { cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-400" },
    // payroll / payment
    Draft: { cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-400" },
    Posted: { cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25", dot: "bg-sky-500" },
    Locked: { cls: "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-white/15 dark:text-slate-200 dark:ring-white/20", dot: "bg-slate-500" },
    Paid: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    // live clock states
    Working: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25", dot: "bg-emerald-500" },
    "On Meal": { cls: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25", dot: "bg-orange-500" },
    "On Rest": { cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25", dot: "bg-sky-500" },
    Completed: { cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-400" },
    "Off-duty": { cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-300" },
  };
  const t = map[status] ?? { cls: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15", dot: "bg-slate-400" };
  return { label: status, cls: t.cls, dot: t.dot };
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = statusTone(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", t.cls, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {t.label}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}
