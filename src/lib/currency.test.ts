import { describe, it, expect } from "vitest";
import {
  formatBDT,
  formatBDTCompact,
  formatNumber,
  payRound,
  parseMoney,
} from "@/lib/currency";

describe("Currency utilities", () => {
  describe("payRound", () => {
    it("rounds to 2 decimals by default", () => {
      expect(payRound(100.1234)).toBe(100.12);
      expect(payRound(100.125)).toBe(100.13);
      expect(payRound(100.1249)).toBe(100.12);
    });

    it("handles negative numbers (EPSILUM rounds toward zero)", () => {
      expect(payRound(-50.555)).toBe(-50.55);
      expect(payRound(-100.125)).toBe(-100.12);
    });

    it("handles zero", () => {
      expect(payRound(0)).toBe(0);
    });

    it("supports custom decimals", () => {
      expect(payRound(100.1234, 3)).toBe(100.123);
      expect(payRound(100.1234, 0)).toBe(100);
    });

    it("handles floating point edge cases", () => {
      expect(payRound(0.1 + 0.2)).toBe(0.3);
    });

    it("returns 0 for non-finite", () => {
      expect(payRound(NaN)).toBe(0);
      expect(payRound(Infinity)).toBe(0);
    });
  });

  describe("formatBDT", () => {
    it("formats positive numbers with ৳ symbol (US locale)", () => {
      expect(formatBDT(1000)).toBe("৳1,000.00");
      expect(formatBDT(1234567.89)).toBe("৳1,234,567.89");
    });

    it("formats without symbol when withSymbol=false", () => {
      expect(formatBDT(1000, false)).toBe("1,000.00");
    });

    it("handles zero", () => {
      expect(formatBDT(0)).toBe("৳0.00");
    });

    it("handles negative", () => {
      expect(formatBDT(-500)).toBe("৳-500.00");
    });
  });

  describe("formatBDTCompact", () => {
    it("shows K for thousands (1 decimal)", () => {
      expect(formatBDTCompact(1500)).toBe("৳1.5K");
      expect(formatBDTCompact(9999)).toBe("৳10K");
    });

    it("shows L for lakhs (100K) with 2 decimals and space", () => {
      expect(formatBDTCompact(150000)).toBe("৳1.5 L");
      expect(formatBDTCompact(999999)).toBe("৳10 L");
    });

    it("shows Cr for crores (10M) with 2 decimals and space", () => {
      expect(formatBDTCompact(15000000)).toBe("৳1.5 Cr");
    });

    it("shows full format for < 1000", () => {
      expect(formatBDTCompact(500)).toBe("৳500.00");
      expect(formatBDTCompact(999)).toBe("৳999.00");
    });

    it("handles negative with prefix", () => {
      expect(formatBDTCompact(-1500)).toBe("-৳1.5K");
    });
  });

  describe("formatNumber", () => {
    it("formats with commas (US locale)", () => {
      expect(formatNumber(1000)).toBe("1,000");
      expect(formatNumber(1234567)).toBe("1,234,567");
    });

    it("respects decimal places", () => {
      expect(formatNumber(1000.5, 1)).toBe("1,000.5");
      expect(formatNumber(1000.555, 2)).toBe("1,000.56");
    });
  });

  describe("parseMoney", () => {
    it("parses formatted strings", () => {
      expect(parseMoney("৳1,000.00")).toBe(1000);
      expect(parseMoney("1,234,567.89")).toBe(1234567.89);
    });

    it("handles plain numbers", () => {
      expect(parseMoney("1000")).toBe(1000);
    });

    it("handles negative", () => {
      expect(parseMoney("-500")).toBe(-500);
    });
  });
});