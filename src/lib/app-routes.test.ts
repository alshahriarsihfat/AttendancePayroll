import { describe, expect, it } from "vitest";
import {
  defaultViewForRole,
  isViewAllowedForRole,
  parseViewFromLocation,
  resolveInitialView,
  sanitizeReturnTo,
  viewToSearch,
} from "./app-routes";

describe("app-routes", () => {
  it("defaults: supervisor to attendance, admin to dashboard, staff to terminal", () => {
    expect(defaultViewForRole("SUPERVISOR")).toEqual({ page: "attendance" });
    expect(defaultViewForRole("ADMIN")).toEqual({ page: "dashboard" });
    expect(defaultViewForRole("STAFF")).toEqual({ page: "terminal" });
  });

  it("preserves valid non-attendance authenticated routes on reload/direct resolve", () => {
    expect(resolveInitialView("SUPERVISOR", { search: "?view=payments" })).toEqual({ page: "payments" });
    expect(resolveInitialView("SUPERVISOR", { search: "?view=leave" })).toEqual({ page: "leave" });
    expect(resolveInitialView("ADMIN", { search: "?view=settings" })).toEqual({ page: "settings" });
  });

  it("supervisor initial login without requested route lands on attendance", () => {
    expect(resolveInitialView("SUPERVISOR", { search: "" })).toEqual({ page: "attendance" });
  });

  it("falls back for invalid or unauthorized routes", () => {
    expect(resolveInitialView("SUPERVISOR", { search: "?view=settings" })).toEqual({ page: "attendance" });
    expect(resolveInitialView("SUPERVISOR", { search: "?view=dashboard" })).toEqual({ page: "attendance" });
    expect(resolveInitialView("STAFF", { search: "?view=payments" })).toEqual({ page: "terminal" });
    expect(resolveInitialView("ADMIN", { search: "?view=notreal" as any })).toEqual({ page: "dashboard" });
  });

  it("parses and serializes view params (e.g. payslip)", () => {
    const v = parseViewFromLocation({ search: "?view=payslip&id=PAY123" });
    expect(v).toEqual({ page: "payslip", params: { id: "PAY123" } });
    expect(viewToSearch({ page: "payslip", params: { id: "PAY123" } })).toBe("/?view=payslip&id=PAY123");
    expect(viewToSearch({ page: "attendance" })).toBe("/?view=attendance");
  });

  it("rejects payslip without id for role-guarded resolution", () => {
    expect(isViewAllowedForRole("ADMIN", { page: "payslip" } as any)).toBe(false);
    expect(resolveInitialView("ADMIN", { search: "?view=payslip" })).toEqual({ page: "dashboard" });
  });

  it("sanitizes returnTo: allows internal app paths, rejects external/open redirects", () => {
    expect(sanitizeReturnTo("/?view=payments")).toBe("/?view=payments");
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("https://evil.example/?view=payments")).toBeNull();
    expect(sanitizeReturnTo("//evil.example/path")).toBeNull();
    expect(sanitizeReturnTo("/\\evil")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)" as any)).toBeNull();
  });

  it("sanitizeReturnTo only permits same-origin root app paths", () => {
    expect(sanitizeReturnTo("/login")).toBeNull();
    expect(sanitizeReturnTo("/foo")).toBeNull();
    expect(sanitizeReturnTo("/api/state")).toBeNull();
  });
});
