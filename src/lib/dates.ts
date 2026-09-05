// ============================================================================
// Date utilities — all storage is ISO 8601 (yyyy-mm-dd). Display is localized.
// Bangladesh work week: Friday + Saturday off (weekday indices 5 & 6).
// ============================================================================

export const WEEKEND_DEFAULT = [5, 6]; // Fri(5), Sat(6)

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  // Treat as local date (no timezone drift)
  const [y, m, d] = s.split("T")[0].split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO(): string {
  return isoDate(new Date());
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthShort(key: string): string {
  const [, m] = key.split("-").map(Number);
  return MONTHS[m - 1].slice(0, 3);
}

export function monthStart(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function monthEnd(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0); // day 0 = last day of previous month = last of (m)
}

export interface Period {
  key: string;
  label: string;
  start: string;
  end: string;
}

export function periodFromKey(key: string): Period {
  return {
    key,
    label: monthLabel(key),
    start: isoDate(monthStart(key)),
    end: isoDate(monthEnd(key)),
  };
}

/** Format an ISO date for display: "12 Mar 2026". */
export function formatDate(s?: string | null): string {
  if (!s) return "—";
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** Format ISO date as "12 March 2026". */
export function formatDateLong(s?: string | null): string {
  if (!s) return "—";
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format an ISO datetime for the audit log: "12 Mar, 14:32". */
export function formatDateTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, ${hh}:${mm}`;
}

/** Relative time: "2h ago". */
export function timeAgo(s?: string | null): string {
  if (!s) return "—";
  const diff = Date.now() - new Date(s).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(s);
}

export function isWeekend(date: Date, weekendDays: number[] = WEEKEND_DEFAULT): boolean {
  return weekendDays.includes(date.getDay());
}

export function isHoliday(date: Date, holidays: { date: string }[]): boolean {
  const ds = isoDate(date);
  return holidays.some((h) => h.date === ds);
}

/** Inclusive list of dates between two ISO dates. */
export function eachDate(startISO: string, endISO: string): Date[] {
  const out: Date[] = [];
  let d = parseISO(startISO);
  const end = parseISO(endISO);
  while (d <= end) {
    out.push(new Date(d));
    d = addDays(d, 1);
  }
  return out;
}

/** Working days in a month (excluding weekends + holidays). */
export function workingDaysInMonth(
  key: string,
  holidays: { date: string }[] = [],
  weekendDays: number[] = WEEKEND_DEFAULT
): number {
  const start = monthStart(key);
  const end = monthEnd(key);
  let count = 0;
  let d = new Date(start);
  while (d <= end) {
    if (!isWeekend(d, weekendDays) && !isHoliday(d, holidays)) count++;
    d = addDays(d, 1);
  }
  return count;
}

/** Working days between two inclusive ISO dates (for leave). */
export function workingDaysBetween(
  fromISO: string,
  toISO: string,
  holidays: { date: string }[] = [],
  weekendDays: number[] = WEEKEND_DEFAULT
): number {
  return eachDate(fromISO, toISO).filter(
    (d) => !isWeekend(d, weekendDays) && !isHoliday(d, holidays)
  ).length;
}

/** Number of months of tenure from joinDate to a reference date. */
export function tenureMonths(joinISO: string, ref = new Date()): number {
  const j = parseISO(joinISO);
  return Math.max(
    0,
    (ref.getFullYear() - j.getFullYear()) * 12 + (ref.getMonth() - j.getMonth())
  );
}

// ----- 12-hour formatting for the pharmacy clock system -------------------

/** Format an ISO datetime as 12-hour time: "08:30 AM". */
export function formatTime12(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Minutes between two ISO datetimes. */
export function minutesBetween(aISO: string, bISO: string): number {
  return (new Date(bISO).getTime() - new Date(aISO).getTime()) / 60000;
}

/** Format minutes as a compact duration: "3h 24m" / "45m" / "0m". */
export function formatDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Strictly minutes + seconds (never fractional): "14m 50s". */
export function formatMinSec(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) mins = 0;
  const totalSec = Math.floor(mins * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Human-readable long form: "1 hour 22 minutes" / "30 minutes" / "45 seconds". */
export function formatLongDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) mins = 0;
  const totalSec = Math.round(mins * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m > 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (parts.length === 0 && s > 0) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  if (parts.length === 0) return "0 minutes";
  return parts.join(" ");
}

/** Format a live elapsed time from milliseconds: "3h 24m 05s". */
export function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Format seconds as a countdown clock MM:SS; negative => over-time "+MM:SS". */
export function formatCountdown(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${neg ? "+" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Today's date key in local time. */
export function todayKey(): string {
  return isoDate(new Date());
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Verbose localized date: "01 Jan 2026 Monday" (DD mmm YYYY dddd). */
export function formatLongDate(d: Date | string | number = new Date()): string {
  const dt = typeof d === "number" ? new Date(d) : typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()} ${DAYS_FULL[dt.getDay()]}`;
}

/** Format a millisecond countdown as "Xh Ym Zs" (until next shift). */
export function formatCountdownHMS(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}


