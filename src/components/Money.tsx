import { formatBDT, formatBDTCompact } from "../lib/currency";
import { cn } from "../lib/utils";

interface MoneyProps {
  value: number;
  compact?: boolean;
  className?: string;
  /** Show + / − sign for deltas */
  signed?: boolean;
  muted?: boolean;
}

/** Right-aligned money figures everywhere — symbol, 2 decimals. */
export function Money({ value, compact, className, signed, muted }: MoneyProps) {
  const isNeg = value < 0;
  const text = compact ? formatBDTCompact(value) : formatBDT(value);
  const display = signed ? `${isNeg ? "−" : "+"}${compact ? formatBDTCompact(Math.abs(value)) : formatBDT(Math.abs(value))}` : text;
  return (
    <span
      className={cn(
        "tabular-nums font-semibold tracking-tight",
        muted && "text-slate-400",
        !muted && (isNeg ? "text-rose-600" : "text-slate-900"),
        className
      )}
    >
      {display}
    </span>
  );
}
