import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export interface HeroStat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
}

/**
 * Premium dark-gradient hero banner used at the top of supervisor pages.
 * Pure presentation — takes pre-computed stats/actions and renders them.
 */
export function HeroBand({ eyebrow, title, subtitle, icon, stats, actions, right }: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  stats?: HeroStat[];
  actions?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-card-lg ring-1 ring-white/10">
      {/* Decorative gradient glows — royal blue accents */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-linear-to-br from-primary-deep/60 to-primary-bright/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-linear-to-tr from-primary/40 to-transparent blur-3xl" />

      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary-bright">
            <Icon name={icon} size={14} /> {eyebrow}
          </p>
          <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-300">{subtitle}</p>
          )}
          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
        </div>

        {right ? (
          <div className="shrink-0">{right}</div>
        ) : stats && stats.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:min-w-[26rem] sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/10 px-3.5 py-3 ring-1 ring-white/15 backdrop-blur-sm">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  {s.icon && <Icon name={s.icon} size={12} />} {s.label}
                </p>
                <p className="mt-1 truncate text-xl font-bold tabular-nums">{s.value}</p>
                {s.sub && <p className="truncate text-[11px] text-slate-400">{s.sub}</p>}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}