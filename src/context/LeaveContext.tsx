"use client";

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Dataset, LeaveRequest, LeaveType, LeaveStatus, ApprovalRequest, ApprovalStatus, ApprovalType } from "@/types";
import { useData } from "./DataContext";
import { useAuth } from "./AuthContext";
import { useUI } from "./UIContext";
import type { FormResult } from "./AppContext.types";
import { inclusiveCalendarDays } from "@/lib/dates";

interface LeaveContextValue {
  submitLeave: (d: { staffId: string; leaveType: LeaveType; fromDate: string; toDate: string; reason: string }) => Promise<FormResult>;
  decideLeave: (id: string, status: LeaveStatus, comment?: string) => Promise<FormResult>;
  cancelOwnLeave: (id: string) => Promise<FormResult>;
  pendingApprovals: ApprovalRequest[];
  resolveApproval: (id: string, status: ApprovalStatus, note?: string) => void;
  leaveRequests: LeaveRequest[];
  leaveBalances: Record<string, Record<LeaveType, { used: number; total: number }>>;
  leaveLoading: boolean;
  leaveError: string | null;
}

const LeaveCtx = createContext<LeaveContextValue | null>(null);

const LEAVE_DEFAULTS: Record<LeaveType, number> = {
  Annual: 6,
  Sick: 3,
  Earned: 0,
  Casual: 3,
  Maternity: 90,
  Paternity: 14,
  Unpaid: 0,
};

export function LeaveProvider({ children }: { children: ReactNode }) {
  const { data, updateDataset, refreshData } = useData();
  const { session, canPerm } = useAuth();
  const { toast } = useUI();
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const leaveRequests = data.leaveRequests;
  const pendingApprovals = data.approvalRequests;

  const submitLeave = useCallback(async (d: { staffId: string; leaveType: LeaveType; fromDate: string; toDate: string; reason: string }): Promise<FormResult> => {
    const { staffId, leaveType, fromDate, toDate, reason } = d;
    const errors: { field: string; message: string }[] = [];
    if (!staffId) errors.push({ field: "staffId", message: "Staff required" });
    if (!leaveType) errors.push({ field: "leaveType", message: "Leave type required" });
    if (!fromDate || !toDate) errors.push({ field: "dates", message: "From and to dates required" });
    else if (new Date(fromDate) > new Date(toDate)) errors.push({ field: "dates", message: "From date must be before to date" });
    if (!reason?.trim()) errors.push({ field: "reason", message: "Reason required" });
    if (errors.length) return { ok: false, errors };

    const recordId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `LR-${Date.now()}`;
    setLeaveLoading(true); setLeaveError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, staffId, leaveType, fromDate, toDate, days: inclusiveCalendarDays(fromDate, toDate), reason: reason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json as any)?.error || "Leave request failed";
        setLeaveError(msg); toast(msg, "error");
        return { ok: false, errors: [{ field: "global", message: msg }] };
      }
      await refreshData();
      toast("Leave request submitted", "success");
      return { ok: true };
    } catch {
      const msg = "Network error submitting leave";
      setLeaveError(msg); toast(msg, "error");
      return { ok: false, errors: [{ field: "global", message: msg }] };
    } finally { setLeaveLoading(false); }
  }, [refreshData, toast]);

  const decideLeave = useCallback(async (id: string, status: LeaveStatus, comment?: string): Promise<FormResult> => {
    if (!canPerm("manage.leave" as any)) return { ok: false, errors: [{ field: "global", message: "No permission" }] };
    if (status !== "Approved" && status !== "Rejected") return { ok: false, errors: [{ field: "global", message: "Invalid decision" }] };
    setLeaveLoading(true); setLeaveError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: id, status, comment: comment?.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json as any)?.error || "Leave decision failed";
        setLeaveError(msg); toast(msg, "error");
        return { ok: false, errors: [{ field: "global", message: msg }] };
      }
      await refreshData();
      toast(`Leave ${status.toLowerCase()}`, "success");
      return { ok: true };
    } catch {
      const msg = "Network error updating leave";
      setLeaveError(msg); toast(msg, "error");
      return { ok: false, errors: [{ field: "global", message: msg }] };
    } finally { setLeaveLoading(false); }
  }, [canPerm, refreshData, toast]);

  const cancelOwnLeave = useCallback(async (id: string): Promise<FormResult> => {
    setLeaveLoading(true); setLeaveError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: id, status: "Cancelled" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json as any)?.error || "Cancel failed";
        setLeaveError(msg); toast(msg, "error");
        return { ok: false, errors: [{ field: "global", message: msg }] };
      }
      await refreshData();
      toast("Leave cancelled", "success");
      return { ok: true };
    } catch {
      const msg = "Network error cancelling leave";
      setLeaveError(msg); toast(msg, "error");
      return { ok: false, errors: [{ field: "global", message: msg }] };
    } finally { setLeaveLoading(false); }
  }, [refreshData, toast]);

  const resolveApproval = useCallback((id: string, status: ApprovalStatus, note?: string) => {
    if (!canPerm("manage.leave" as any)) return;
    const idx = data.approvalRequests.findIndex(r => r.id === id);
    if (idx === -1) return;
    const req = data.approvalRequests[idx];
    const updated: ApprovalRequest = { ...req, status, resolvedBy: session?.staffId, resolvedAt: new Date().toISOString(), managerNote: note };
    updateDataset(prev => ({ ...prev, approvalRequests: prev.approvalRequests.map(r => r.id === id ? updated : r) }));
    toast(`Approval ${status}`, "success");
  }, [canPerm, data.approvalRequests, session, updateDataset, toast]);

  const leaveBalances = useMemo(() => {
    const balances: Record<string, Record<LeaveType, { used: number; total: number }>> = {};
    (Object.keys(LEAVE_DEFAULTS) as LeaveType[]).forEach(type => {
      data.staff.filter(s => s.isActive).forEach(s => {
        if (!balances[s.employeeId]) balances[s.employeeId] = {} as Record<LeaveType, { used: number; total: number }>;
        balances[s.employeeId][type] = { used: 0, total: LEAVE_DEFAULTS[type] };
      });
    });
    data.leaveRequests.filter(r => r.status === "Approved").forEach(r => {
      if (balances[r.staffId]?.[r.leaveType]) balances[r.staffId][r.leaveType].used += r.days;
    });
    return balances;
  }, [data.staff, data.leaveRequests]);

  return (
    <LeaveCtx.Provider value={{ submitLeave, decideLeave, cancelOwnLeave, pendingApprovals, resolveApproval, leaveRequests, leaveBalances, leaveLoading, leaveError }}>
      {children}
    </LeaveCtx.Provider>
  );
}

export function useLeave() {
  const v = useContext(LeaveCtx);
  if (!v) throw new Error("useLeave must be used within LeaveProvider");
  return v;
}