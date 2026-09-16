import type {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from "react";
import { cn, colorFromString, initials } from "../lib/utils";
import { Icon, type IconName } from "./icons";

// ---------------- Button ---------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "subtle";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-linear-to-br from-primary-deep to-primary-bright text-white hover:from-primary hover:to-primary-bright shadow-sm shadow-primary/25",
  secondary: "bg-surface-muted text-foreground hover:bg-surface-muted/70",
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-500/20",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-500/20",
  subtle: "bg-primary-soft text-primary hover:bg-primary/15",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

export function Button({
  variant = "primary", size = "md", icon, iconRight, loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; icon?: IconName; iconRight?: IconName; loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap active:scale-[0.99]",
        VARIANTS[variant], SIZES[size], className
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Spinner size={15} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={16} /> : null}
    </button>
  );
}

export function IconButton({
  icon, className, size = "md", label, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; size?: Size; label?: string }) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40",
        dim, className
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 15 : 17} />
    </button>
  );
}

// ---------------- Spinner --------------------------------------------------
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={cn("animate-spin text-current", className)} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------- Card -----------------------------------------------------
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl bg-surface text-foreground shadow-card ring-1 ring-edge", className)}>{children}</div>;
}

export function SectionHeader({
  title, subtitle, icon, actions, className,
}: { title: ReactNode; subtitle?: ReactNode; icon?: IconName; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Icon name={icon} size={18} />
          </span>
        )}
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------- Form fields ---------------------------------------------
export function Field({
  label, hint, error, required, children, className,
}: { label?: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-foreground">
          {label}{required && <span className="text-rose-500">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-rose-600">
          <Icon name="alert" size={12} /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-faint-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-full border-0 bg-surface-muted px-4 py-2.5 text-sm text-foreground placeholder:text-faint-foreground transition focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-surface-muted/60 disabled:text-faint-foreground";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, "rounded-2xl resize-none", className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputCls, "appearance-none bg-no-repeat pr-9", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2398a2b3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right 0.75rem center" }}
      {...rest}
    >
      {children}
    </select>
  );
}

// ---------------- Misc -----------------------------------------------------
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const bg = colorFromString(name);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon = "info", title, desc, action }: { icon?: IconName; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-faint-foreground">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm text-faint-foreground">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-edge", className)} />;
}

export function KeyStat({ label, value, sub, tone = "slate" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "slate" | "emerald" | "rose" | "indigo" }) {
  const toneCls = { slate: "text-foreground", emerald: "text-emerald-600", rose: "text-rose-600", indigo: "text-primary" }[tone];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-faint-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", toneCls)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint-foreground">{sub}</p>}
    </div>
  );
}
