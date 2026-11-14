// ============================================================================
// Staff input normalization — shared by the client form/context and the API.
//
// Guarantees, for both layers:
//   • Department is optional: a missing/blank value is stored as a neutral
//     non-null label (the DB column is NOT NULL and must stay that way).
//   • joinDate: empty / whitespace / null / undefined ⇒ today (Dhaka);
//     a valid explicit date is preserved; a non-empty invalid value raises a
//     field-specific StaffInputError instead of ever producing an Invalid Date.
//   • endDate: empty ⇒ null; invalid non-empty ⇒ StaffInputError.
// ============================================================================

import { dhakaDateKey } from "./dates";

/** Neutral label used when no department is selected. The Staff.department
 *  column is NOT NULL in both the Prisma schema and the live database, so an
 *  omitted department is recorded as this value rather than `null`. */
export const DEFAULT_DEPARTMENT = "Unassigned";

export type StaffField = "department" | "joinDate" | "endDate";

export class StaffInputError extends Error {
  readonly field: StaffField;

  constructor(field: StaffField, message: string) {
    super(message);
    this.name = "StaffInputError";
    this.field = field;
  }
}

export function isStaffInputError(value: unknown): value is StaffInputError {
  return value instanceof StaffInputError;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strict calendar-date parser for `YYYY-MM-DD`. Returns a Date at UTC midnight
 * (the same instant the previous `new Date("YYYY-MM-DD")` produced), or null
 * when the value is not a real calendar date (`2024-02-30`, `2024-13-01`, …).
 */
function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

// ISO 8601 calendar date or datetime (optionally with an explicit offset).
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function toDate(value: string): Date | null {
  // A calendar-date string is parsed strictly: `new Date("2024-02-30")` silently
  // rolls over to 2024-03-01, which must never be accepted as "a valid date".
  if (DATE_ONLY.test(value)) return parseDateOnly(value);
  // Only ISO-shaped values are accepted; locale strings ("05/01/2024") are
  // ambiguous and rejected so the stored value is always unambiguous.
  if (!ISO_LIKE.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

export function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Today's calendar date key in the pharmacy timezone (Asia/Dhaka). */
export function todayDateKey(now: Date = new Date()): string {
  return dhakaDateKey(now);
}

/** Blank/absent department ⇒ DEFAULT_DEPARTMENT; a provided value is preserved. */
export function normalizeDepartment(value: unknown): string {
  const trimmed = asTrimmedString(value);
  return trimmed.length > 0 ? trimmed : DEFAULT_DEPARTMENT;
}

/**
 * Empty / whitespace / null / undefined ⇒ today. Valid explicit date ⇒ kept.
 * Non-empty invalid value ⇒ StaffInputError("joinDate").
 */
export function normalizeJoinDate(value: unknown, now: Date = new Date()): Date {
  const raw = asTrimmedString(value);
  if (raw.length === 0) {
    const today = toDate(todayDateKey(now));
    // `todayDateKey` always yields a real calendar date; fall back defensively.
    return today ?? new Date(now.getTime());
  }
  const parsed = toDate(raw);
  if (!parsed) {
    throw new StaffInputError("joinDate", "Join date must be a valid date (YYYY-MM-DD).");
  }
  return parsed;
}

/** Empty / null / undefined ⇒ null. Invalid non-empty ⇒ StaffInputError("endDate"). */
export function normalizeEndDate(value: unknown): Date | null {
  const raw = asTrimmedString(value);
  if (raw.length === 0) return null;
  const parsed = toDate(raw);
  if (!parsed) {
    throw new StaffInputError("endDate", "End date must be a valid date (YYYY-MM-DD).");
  }
  return parsed;
}

/** ISO calendar date (YYYY-MM-DD) for wire payloads. */
export function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}