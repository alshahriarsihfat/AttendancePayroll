import { describe, it, expect } from "vitest";
import {
  formatTime12,
  formatDate,
  formatDuration,
  formatCountdown,
  formatElapsed,
  formatLongDate,
  formatMinSec,
  formatLongDuration,
  addDays,
  addMonths,
  isoDate,
  monthKey,
  monthStart,
  monthEnd,
  monthShort,
  parseISO,
  inclusiveCalendarDays,
  workingDaysBetween,
} from "@/lib/dates";

describe("Date utilities", () => {
  const testDate = new Date("2024-01-15T09:30:00.000Z"); // 3:30 PM Dhaka

  describe("formatTime12", () => {
    it("formats 12-hour time in Dhaka (no leading zero on hour)", () => {
      expect(formatTime12(testDate.toISOString())).toBe("3:30 PM");
    });

    it("handles midnight", () => {
      expect(formatTime12("2024-01-15T00:00:00.000Z")).toBe("6:00 AM");
    });

    it("handles noon", () => {
      expect(formatTime12("2024-01-15T12:00:00.000Z")).toBe("6:00 PM");
    });

    it("returns — for invalid input", () => {
      expect(formatTime12(null)).toBe("—");
      expect(formatTime12("invalid")).toBe("—");
    });
  });

  describe("formatDate", () => {
    it("formats YYYY-MM-DD as DD Mon YYYY", () => {
      expect(formatDate("2024-01-15")).toBe("15 Jan 2024");
      expect(formatDate("2024-12-31")).toBe("31 Dec 2024");
    });

    it("returns — for null/undefined", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate(undefined)).toBe("—");
    });
  });

  describe("formatDuration", () => {
    it("formats minutes as Hh Mm (always shows minutes)", () => {
      expect(formatDuration(0)).toBe("0m");
      expect(formatDuration(30)).toBe("30m");
      expect(formatDuration(60)).toBe("1h 00m");
      expect(formatDuration(90)).toBe("1h 30m");
      expect(formatDuration(660)).toBe("11h 00m");
      expect(formatDuration(1500)).toBe("25h 00m");
    });
  });

  describe("formatCountdown", () => {
    it("formats seconds as MM:SS", () => {
      expect(formatCountdown(0)).toBe("00:00");
      expect(formatCountdown(30)).toBe("00:30");
      expect(formatCountdown(60)).toBe("01:00");
      expect(formatCountdown(90)).toBe("01:30");
      expect(formatCountdown(3600)).toBe("60:00");
    });

    it("shows + for negative (overtime)", () => {
      expect(formatCountdown(-60)).toBe("+01:00");
    });
  });

  describe("formatElapsed", () => {
    it("formats elapsed milliseconds as Hh Mm Ss", () => {
      expect(formatElapsed(0)).toBe("0m 00s");
      expect(formatElapsed(60000)).toBe("1m 00s");
      expect(formatElapsed(3600000)).toBe("1h 00m 00s");
      expect(formatElapsed(3660000)).toBe("1h 01m 00s");
    });
  });

  describe("formatLongDate", () => {
    it("formats verbose date in Dhaka: DD Mon YYYY Weekday", () => {
      const result = formatLongDate(testDate.getTime());
      expect(result).toContain("15");
      expect(result).toContain("Jan");
      expect(result).toContain("2024");
      expect(result).toContain("Monday");
    });
  });

  describe("formatMinSec", () => {
    it("formats minutes as Mm Ss", () => {
      expect(formatMinSec(0)).toBe("0m 00s");
      expect(formatMinSec(5)).toBe("5m 00s");
      expect(formatMinSec(90)).toBe("90m 00s");
    });
  });

  describe("formatLongDuration", () => {
    it("formats human-readable long form", () => {
      expect(formatLongDuration(0)).toBe("0 minutes");
      expect(formatLongDuration(60)).toBe("1 hour");
      expect(formatLongDuration(90)).toBe("1 hour 30 minutes");
      expect(formatLongDuration(3660)).toBe("61 hours");
    });
  });

  describe("Date arithmetic", () => {
    it("addDays returns Date object", () => {
      const d1 = addDays(new Date("2024-01-15"), 1);
      expect(d1).toBeInstanceOf(Date);
      expect(isoDate(d1)).toBe("2024-01-16");

      const d2 = addDays(new Date("2024-01-31"), 1);
      expect(isoDate(d2)).toBe("2024-02-01");

      const d3 = addDays(new Date("2024-01-15"), -1);
      expect(isoDate(d3)).toBe("2024-01-14");
    });

    it("addMonths returns Date object (JS Date behavior)", () => {
      const d1 = addMonths(new Date("2024-01-15"), 1);
      expect(d1).toBeInstanceOf(Date);
      expect(isoDate(d1)).toBe("2024-02-15");

      // JS Date: Jan 31 + 1 month = March 2 (Feb has 29 days max in leap year)
      const d2 = addMonths(new Date("2024-01-31"), 1);
      expect(isoDate(d2)).toBe("2024-03-02");

      const d3 = addMonths(new Date("2024-01-15"), -1);
      expect(isoDate(d3)).toBe("2023-12-15");
    });

    it("isoDate returns YYYY-MM-DD", () => {
      expect(isoDate(new Date("2024-01-15T12:00:00.000Z"))).toBe("2024-01-15");
    });
  });

  describe("Month utilities", () => {
    it("monthKey returns YYYY-MM from Date", () => {
      expect(monthKey(new Date("2024-01-15"))).toBe("2024-01");
      expect(monthKey(new Date("2024-12-31"))).toBe("2024-12");
    });

    it("monthStart/End return Date objects", () => {
      const start = monthStart("2024-02-15");
      expect(start).toBeInstanceOf(Date);
      expect(isoDate(start)).toBe("2024-02-01");

      const end = monthEnd("2024-02-15");
      expect(end).toBeInstanceOf(Date);
      expect(isoDate(end)).toBe("2024-02-29"); // leap year

      const end2 = monthEnd("2023-02-15");
      expect(isoDate(end2)).toBe("2023-02-28");
    });

    it("monthShort returns abbreviated month", () => {
      expect(monthShort("2024-01-15")).toBe("Jan");
      expect(monthShort("2024-12-15")).toBe("Dec");
    });
  });

  describe("parseISO", () => {
    it("parses ISO date strings as local dates", () => {
      const d = parseISO("2024-01-15");
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(15);
    });
  });

  describe("inclusiveCalendarDays (leave policy)", () => {
    it("same day = 1", () => { expect(inclusiveCalendarDays("2024-11-10", "2024-11-10")).toBe(1); });
    it("10-12 Nov = 3", () => { expect(inclusiveCalendarDays("2024-11-10", "2024-11-12")).toBe(3); });
    it("reversed = 0", () => { expect(inclusiveCalendarDays("2024-11-12", "2024-11-10")).toBe(0); });
    it("cross month/year", () => { expect(inclusiveCalendarDays("2024-12-30", "2025-01-02")).toBe(4); });
  });

  describe("workingDaysBetween (legacy)", () => {
    it("counts weekdays only (Fri/Sat weekend in Bangladesh)", () => {
      expect(workingDaysBetween("2024-01-15", "2024-01-19", [])).toBe(4);
    });
    it("excludes weekends (Fri/Sat)", () => {
      expect(workingDaysBetween("2024-01-15", "2024-01-22", [])).toBe(6);
    });
    it("excludes holidays", () => {
      const holidays = [{ date: "2024-01-16" }];
      expect(workingDaysBetween("2024-01-15", "2024-01-19", holidays)).toBe(3);
    });
    it("handles same day", () => {
      expect(workingDaysBetween("2024-01-15", "2024-01-15", [])).toBe(1);
    });
  });
});