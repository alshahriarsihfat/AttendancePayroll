import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEPARTMENT,
  StaffInputError,
  isStaffInputError,
  isValidDate,
  normalizeDepartment,
  normalizeEndDate,
  normalizeJoinDate,
  toDateKey,
  todayDateKey,
} from "./staff-input";

const todayKey = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
};

describe("staff-input: department", () => {
  it("uses the neutral label when omitted", () => {
    expect(normalizeDepartment(undefined)).toBe(DEFAULT_DEPARTMENT);
    expect(normalizeDepartment(null)).toBe(DEFAULT_DEPARTMENT);
    expect(normalizeDepartment("")).toBe(DEFAULT_DEPARTMENT);
    expect(normalizeDepartment("   ")).toBe(DEFAULT_DEPARTMENT);
  });

  it("preserves a provided department (trimmed)", () => {
    expect(normalizeDepartment("Pharmacy Counter")).toBe("Pharmacy Counter");
    expect(normalizeDepartment("  Cash Counter  ")).toBe("Cash Counter");
  });
});

describe("staff-input: joinDate", () => {
  const now = new Date("2026-11-14T04:00:00.000Z"); // 10:00 Dhaka, same calendar day

  it("uses today (Dhaka) when the value is missing", () => {
    expect(toDateKey(normalizeJoinDate(undefined, now))).toBe(todayKey(now));
    expect(toDateKey(normalizeJoinDate(null, now))).toBe(todayKey(now));
    expect(toDateKey(normalizeJoinDate("", now))).toBe(todayKey(now));
    expect(toDateKey(normalizeJoinDate("   ", now))).toBe(todayKey(now));
    expect(todayDateKey(now)).toBe("2026-11-14");
  });

  it("preserves a valid explicit date", () => {
    expect(toDateKey(normalizeJoinDate("2024-01-05", now))).toBe("2024-01-05");
    expect(toDateKey(normalizeJoinDate(" 2024-01-05 ", now))).toBe("2024-01-05");
  });

  it("preserves a valid ISO datetime", () => {
    const d = normalizeJoinDate("2024-01-05T09:30:00.000Z", now);
    expect(isValidDate(d)).toBe(true);
    expect(d.toISOString()).toBe("2024-01-05T09:30:00.000Z");
  });

  it("rejects a non-empty invalid date with a field-specific error", () => {
    for (const bad of ["not-a-date", "2024-13-01", "2024-02-30", "05/01/2024"]) {
      try {
        normalizeJoinDate(bad, now);
        throw new Error(`expected ${bad} to be rejected`);
      } catch (error) {
        expect(isStaffInputError(error)).toBe(true);
        expect(error).toBeInstanceOf(StaffInputError);
        expect((error as StaffInputError).field).toBe("joinDate");
        expect((error as Error).message).toMatch(/valid date/i);
      }
    }
  });

  it("never returns an Invalid Date", () => {
    const resolved = normalizeJoinDate("", now);
    expect(Number.isNaN(resolved.getTime())).toBe(false);
  });
});

describe("staff-input: endDate", () => {
  it("maps empty values to null", () => {
    expect(normalizeEndDate(undefined)).toBeNull();
    expect(normalizeEndDate(null)).toBeNull();
    expect(normalizeEndDate("")).toBeNull();
    expect(normalizeEndDate("   ")).toBeNull();
  });

  it("preserves a valid date", () => {
    expect(normalizeEndDate("2025-06-30")?.toISOString()).toBe("2025-06-30T00:00:00.000Z");
  });

  it("rejects an invalid non-empty date", () => {
    try {
      normalizeEndDate("nope");
      throw new Error("expected rejection");
    } catch (error) {
      expect(isStaffInputError(error)).toBe(true);
      expect((error as StaffInputError).field).toBe("endDate");
    }
  });
});