import { CURRENCY_SYMBOL } from "./config";

// ============================================================================
// Currency helpers. payRound() is the SINGLE rounding point in the system —
// every money figure carries full precision until the final formatting step.
// ============================================================================

/** The one rounding function. Banker-safe via epsilon. */
export function payRound(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Format BDT with symbol, 2 decimals, thousands separators: ৳1,234.56 */
export function formatBDT(value: number, withSymbol = true): string {
  const n = Number.isFinite(value) ? value : 0;
  const s = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return withSymbol ? `${CURRENCY_SYMBOL}${s}` : s;
}

/** Plain number formatting without symbol. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Compact money using South-Asian grouping (lakh / crore) for KPI headlines.
 * ৳3.50 L  /  ৳1.20 Cr
 */
export function formatBDTCompact(value: number): string {
  const n = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (n >= 1e7) return `${sign}${CURRENCY_SYMBOL}${payRound(n / 1e7, 2)} Cr`;
  if (n >= 1e5) return `${sign}${CURRENCY_SYMBOL}${payRound(n / 1e5, 2)} L`;
  if (n >= 1e3) return `${sign}${CURRENCY_SYMBOL}${payRound(n / 1e3, 1)}K`;
  return formatBDT(value);
}

/** Parse a user-typed money string into a number (strips symbol & commas). */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
