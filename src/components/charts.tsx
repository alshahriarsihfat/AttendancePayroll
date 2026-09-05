import { cn } from "../lib/utils";

// Lightweight, dependency-free charts (pure SVG + flexbox).

export interface BarDatum { label: string; value: number; color?: string; sub?: string; }

export function HBars({ data, format }: { data: BarDatum[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate text-right text-xs font-medium text-slate-600" title={d.label}>{d.label}</div>
          <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div className="flex h-full items-center justify-end rounded-md px-2 text-[11px] font-semibold text-white transition-all"
              style={{ width: `${Math.max(6, (d.value / max) * 100)}%`, background: d.color ?? "#6366f1" }}>
              <span className="tabular-nums">{format ? format(d.value) : d.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VBars({ data, format, color = "#6366f1", height = 120 }: {
  data: BarDatum[]; format?: (v: number) => string; color?: string; height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[10px] font-semibold text-slate-400 opacity-0 transition group-hover:opacity-100">
            {format ? format(d.value) : d.value}
          </span>
          <div
            className="w-full rounded-t-md transition-all hover:opacity-80"
            style={{ height: `${Math.max(3, (d.value / max) * (height - 28))}px`, background: color }}
            title={`${d.label}: ${format ? format(d.value) : d.value}`}
          />
          <span className="text-[10px] font-medium text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface DonutSegment { label: string; value: number; color: string; }

export function Donut({ segments, size = 140, thickness = 20, center, centerSub }: {
  segments: DonutSegment[]; size?: number; thickness?: number; center?: string; centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          {segments.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
            );
            offset += len;
            return el;
          })}
        </svg>
        {center && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold tabular-nums text-slate-900">{center}</span>
            {centerSub && <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{centerSub}</span>}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-600">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-900">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniStat({ label, value, tone = "slate", className }: {
  label: string; value: string | number; tone?: "slate" | "emerald" | "rose" | "amber" | "indigo"; className?: string;
}) {
  const toneCls = {
    slate: "text-slate-900", emerald: "text-emerald-600", rose: "text-rose-600", amber: "text-amber-600", indigo: "text-indigo-600",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums", toneCls)}>{value}</p>
    </div>
  );
}
