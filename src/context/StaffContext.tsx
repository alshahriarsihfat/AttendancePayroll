"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import type { Employee, Shift, Dataset } from "@/types";
import type { FormResult } from "./AppContext.types";
import { useData } from "./DataContext";
import { useAuth } from "./AuthContext";
import { useUI } from "./UIContext";
import {
  DEFAULT_DEPARTMENT,
  isStaffInputError,
  normalizeDepartment,
  normalizeEndDate,
  normalizeJoinDate,
  toDateKey,
} from "@/lib/staff-input";

interface StaffContextValue {
  createStaff: (d: Partial<Employee>) => Promise<FormResult>;
  updateStaff: (id: string, d: Partial<Employee>) => Promise<FormResult>;
  deactivateStaff: (id: string) => void;
  assignCounter: (staffId: string, counter: number | null) => void;
  staffById: (id: string) => Employee | undefined;
  shiftById: (id: string) => Shift | undefined;
  staff: Employee[];
  shifts: Shift[];
}

const StaffCtx = createContext<StaffContextValue | null>(null);

export function StaffProvider({ children }: { children: ReactNode }) {
  const { data, updateDataset } = useData();
  const { canPerm } = useAuth();
  const { toast } = useUI();

  const staff = useMemo(() => data.staff.filter(s => s.isActive), [data.staff]);
  const shifts = data.shifts;

  const createStaff = useCallback(async (d: Partial<Employee>) => {
    if (!canPerm("manage.staff" as any)) return { ok: false, errors: [{ field: "global", message: "No permission" }] };
    const fullName = String(d.fullName ?? "").trim();
    const username = String(d.username ?? "").trim().toLowerCase();
    const phone = String(d.phone ?? "").trim();
    const employeeId = String(d.employeeId ?? "").trim().toUpperCase();
    const role = (d.role as Employee["role"]) ?? "STAFF";
    const errors: { field: string; message: string }[] = [];
    if (!fullName) errors.push({ field: "fullName", message: "Full name required" });
    if (!username) errors.push({ field: "username", message: "Username required" });
    else if (!/^[a-z0-9_]{3,20}$/.test(username)) errors.push({ field: "username", message: "3-20 chars: a-z, 0-9, _" });
    else if (data.staff.some(s => s.username.toLowerCase() === username)) errors.push({ field: "username", message: "Username taken" });
    if (employeeId && data.staff.some(s => s.employeeId === employeeId)) errors.push({ field: "employeeId", message: "Employee ID taken" });

    // Department is optional; join date blank/whitespace/null ⇒ today. An invalid
    // non-empty date is rejected here, before any request is made.
    const department = normalizeDepartment(d.department);
    let joinDate: Date = new Date();
    try {
      joinDate = normalizeJoinDate(d.joinDate);
    } catch (error) {
      if (isStaffInputError(error)) errors.push({ field: error.field, message: error.message });
      else errors.push({ field: "joinDate", message: "Join date is required (YYYY-MM-DD)." });
    }
    if (errors.length) return { ok: false, errors };

    const payload = {
      employeeId: employeeId || `KP${Date.now().toString(36).toUpperCase()}`,
      username,
      password: String(d.password ?? ""),
      fullName,
      phone,
      email: d.email ?? "",
      department,
      jobTitle: d.jobTitle ?? "Pharmacist",
      section: d.section ?? "Main",
      counter: d.counter ?? null,
      role,
      salaryType: d.salaryType ?? "Daily",
      // Legacy DB columns preserved but not active earning inputs (2C.6.2).
      baseSalary: d.baseSalary ?? 0,
      dailyRate: d.dailyRate ?? 0,
      hourlyRate: d.hourlyRate ?? 0,
      dailyDutyHours: d.dailyDutyHours ?? null,
      workingDaysPerWeek: d.workingDaysPerWeek ?? null,
      shiftStart: d.shiftStart ?? "09:00 AM",
      shiftEnd: d.shiftEnd ?? "08:00 PM",
      mealBreakMin: d.mealBreakMin ?? 30,
      restMin: d.restMin ?? 15,
      photoUrl: d.photoUrl ?? "",
      status: d.status ?? "Active",
      isActive: d.isActive ?? true,
      arrears: d.arrears ?? 0,
      advance: d.advance ?? 0,
      joinDate: toDateKey(joinDate),
      endDate: d.endDate ?? null,
    };

    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let message = "Staff create failed.";
        let field: string | undefined;
        try {
          const p = await response.json() as { error?: string; field?: string };
          if (p?.error) message = p.error;
          if (p?.field) field = p.field;
        } catch { /* ignore */ }
        toast(message, "error");
        if (field) return { ok: false, errors: [{ field, message }] };
        return { ok: false, errors: [{ field: "global", message }] };
      }
      const created = await response.json();
      const newEmployee: Employee = {
        recordId: created.id ?? crypto.randomUUID(),
        employeeId: created.employeeId ?? payload.employeeId,
        username: created.username ?? username,
        password: "",
        fullName: created.fullName ?? fullName,
        phone: created.phone ?? phone,
        email: created.email ?? "",
        department: created.department ?? payload.department,
        jobTitle: created.jobTitle ?? payload.jobTitle,
        section: created.section ?? payload.section,
        counter: created.counter ?? null,
        joinDate: created.joinDate ? new Date(created.joinDate).toISOString().slice(0, 10) : payload.joinDate,
        endDate: null,
        role,
        salaryType: (created.salaryType ?? payload.salaryType) as Employee["salaryType"],
        baseSalary: created.baseSalary ?? payload.baseSalary,
        dailyRate: created.dailyRate ?? payload.dailyRate,
        hourlyRate: created.hourlyRate ?? payload.hourlyRate,
        dailyDutyHours: created.dailyDutyHours ?? payload.dailyDutyHours ?? undefined,
        workingDaysPerWeek: created.workingDaysPerWeek ?? payload.workingDaysPerWeek ?? undefined,
        shiftStart: created.shiftStart ?? payload.shiftStart,
        shiftEnd: created.shiftEnd ?? payload.shiftEnd,
        mealBreakMin: created.mealBreakMin ?? payload.mealBreakMin,
        restMin: created.restMin ?? payload.restMin,
        photoUrl: created.photoUrl ?? "",
        status: "Active",
        isActive: true,
        arrears: created.arrears ?? 0,
        advance: created.advance ?? 0,
      };
      updateDataset(prev => ({ ...prev, staff: [...prev.staff, newEmployee] }));
      toast("Staff created", "success");
      return { ok: true };
    } catch {
      toast("Staff create failed.", "error");
      return { ok: false, errors: [{ field: "global", message: "Network error" }] };
    }
  }, [canPerm, data.staff, shifts, updateDataset, toast]);

  const updateStaff = useCallback(async (id: string, d: Partial<Employee>) => {
    if (!canPerm("manage.staff" as any)) return { ok: false, errors: [{ field: "global", message: "No permission" }] };
    const idx = data.staff.findIndex(s => s.recordId === id || s.employeeId === id);
    if (idx === -1) return { ok: false, errors: [{ field: "global", message: "Staff not found" }] };
    const current = data.staff[idx];
    const username = (d.username ?? current.username).trim().toLowerCase();
    const employeeId = (d.employeeId ?? current.employeeId).trim().toUpperCase();
    const errors: { field: string; message: string }[] = [];
    if (d.fullName !== undefined && !String(d.fullName).trim()) errors.push({ field: "fullName", message: "Full name required" });
    if (d.username !== undefined) {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) errors.push({ field: "username", message: "3-20 chars: a-z, 0-9, _" });
      else if (data.staff.some(s => (s.recordId !== id && s.employeeId !== id) && s.username.toLowerCase() === username)) errors.push({ field: "username", message: "Username taken" });
    }
    if (d.employeeId !== undefined && employeeId && data.staff.some(s => (s.recordId !== id && s.employeeId !== id) && s.employeeId === employeeId)) errors.push({ field: "employeeId", message: "Employee ID taken" });
    // Normalize the same optional/blank-tolerant rules used on create, so an
    // untouched join-date field never sends an empty or invalid value.
    if (d.department !== undefined) d = { ...d, department: normalizeDepartment(d.department) };
    if (d.joinDate !== undefined) {
      try {
        d = { ...d, joinDate: toDateKey(normalizeJoinDate(d.joinDate)) };
      } catch (error) {
        if (isStaffInputError(error)) errors.push({ field: error.field, message: error.message });
        else errors.push({ field: "joinDate", message: "Join date must be a valid date (YYYY-MM-DD)." });
      }
    }
    if (d.endDate !== undefined) {
      try {
        const endDate = normalizeEndDate(d.endDate);
        d = { ...d, endDate: endDate ? toDateKey(endDate) : null };
      } catch (error) {
        if (isStaffInputError(error)) errors.push({ field: error.field, message: error.message });
        else errors.push({ field: "endDate", message: "End date must be a valid date (YYYY-MM-DD)." });
      }
    }
    if (errors.length) return { ok: false, errors };

    const payload: Record<string, unknown> = { employeeId: current.employeeId };
    for (const [key, value] of Object.entries(d)) {
      if (value === undefined) continue;
      if (key === "employeeId") payload.employeeId = String(value).trim().toUpperCase();
      else payload[key] = value;
    }
    // ensure employeeId present for server lookup
    payload.employeeId = employeeId;

    try {
      const response = await fetch("/api/staff", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let message = "Staff update failed.";
        let field: string | undefined;
        try {
          const p = await response.json() as { error?: string; field?: string };
          if (p?.error) message = p.error;
          if (p?.field) field = p.field;
        } catch { /* ignore */ }
        toast(message, "error");
        if (field) return { ok: false, errors: [{ field, message }] };
        return { ok: false, errors: [{ field: "global", message }] };
      }
      const updatedServer = await response.json();
      const updated = { ...current, ...d, username, employeeId };
      // reconcile a few server-normalized fields
      if (updatedServer?.employeeId) updated.employeeId = updatedServer.employeeId;
      if (updatedServer?.username) updated.username = updatedServer.username;
      updateDataset(prev => ({ ...prev, staff: prev.staff.map(s => (s.recordId === id || s.employeeId === id) ? updated : s) }));
      toast("Staff updated", "success");
      return { ok: true };
    } catch {
      toast("Staff update failed.", "error");
      return { ok: false, errors: [{ field: "global", message: "Network error" }] };
    }
  }, [canPerm, data.staff, updateDataset, toast]);

  const deactivateStaff = useCallback((id: string) => {
    if (!canPerm("manage.staff" as any)) return;
    updateDataset(prev => ({ ...prev, staff: prev.staff.map(s => (s.recordId === id || s.employeeId === id) ? { ...s, isActive: false, status: "Terminated" } : s) }));
    toast("Staff deactivated", "info");
  }, [canPerm, updateDataset, toast]);

  const assignCounter = useCallback((staffId: string, counter: number | null) => {
    if (!canPerm("manage.staff" as any)) return;
    updateDataset(prev => ({
      ...prev,
      staff: prev.staff.map(s => s.employeeId === staffId ? { ...s, counter } : s),
    }));
  }, [canPerm, updateDataset]);

  const staffById = useCallback((id: string) => data.staff.find(s => s.recordId === id || s.employeeId === id), [data.staff]);
  const shiftById = useCallback((id: string) => shifts.find(s => s.id === id), [shifts]);

  return (
    <StaffCtx.Provider value={{ createStaff, updateStaff, deactivateStaff, assignCounter, staffById, shiftById, staff, shifts }}>
      {children}
    </StaffCtx.Provider>
  );
}

export function useStaff() {
  const v = useContext(StaffCtx);
  if (!v) throw new Error("useStaff must be used within StaffProvider");
  return v;
}