"use client";

import { createContext, useContext, useCallback, useEffect, useRef, type ReactNode } from "react";
import type {
  Dataset, Employee, TimeSession, Payment, LeaveRequest, LeaveStatus, LeaveType,
  Role, Session, ConfigEntry, BreakType, ApprovalStatus, ApprovalRequest, Shift,
} from "@/types";
import { PageId, View, Toast, ClockInEvent, FormResult, FieldError } from "@/context/AppContext.types";

import { AuthProvider, useAuth } from "./AuthContext";
import { DataProvider, useData } from "./DataContext";
import { UIProvider, useUI } from "./UIContext";
import { TimeClockProvider, useTimeClock } from "./TimeClockContext";
import { PayrollProvider, usePayroll } from "./PayrollContext";
import { StaffProvider, useStaff } from "./StaffContext";
import { LeaveProvider, useLeave } from "./LeaveContext";
import { ConfigProvider, useConfig } from "./ConfigContext";
import { defaultViewForRole, isViewAllowedForRole, parseViewFromLocation, resolveInitialView } from "@/lib/app-routes";

export interface AppContextValue {
  // Data
  data: Dataset;
  // Auth
  session: Session | null;
  role: Role;
  hydrated: boolean;
  loginAdmin: (session: Session) => void;
  loginEmployee: (session: Session) => void;
  logout: () => void;
  canPerm: (p: string) => boolean;
  // UI
  view: View;
  navigate: (page: PageId, params?: Record<string, string>) => void;
  toasts: Toast[];
  toast: (message: string, type?: Toast["type"]) => void;
  dismissToast: (id: string) => void;
  // Time Clock
  clockIn: (staffId: string) => ClockInEvent;
  clockOut: (staffId: string) => { ok: boolean; earlyDepartureMin: number };
  startBreak: (staffId: string, type: BreakType) => void;
  endBreak: (staffId: string) => void;
  toggleExtraTime: (staffId: string) => void;
  startGoOut: (staffId: string, reason: string, estimatedMin: number) => void;
  endGoOut: (staffId: string) => void;
  todaySession: (staffId: string) => TimeSession | undefined;
  isOnLeaveToday: (staffId: string) => boolean;
  // Payroll
  paySessions: (sessionIds: string[]) => string | null;
  payCustomAdvance: (staffId: string, amount: number) => void;
  takeAdvance: (staffId: string, amount: number) => void;
  unpaidShifts: { sessionId: string; staffId: string; date: string; netPay: number }[];
  anyOnDuty: boolean;
  paymentFor: (id: string) => Payment | undefined;
  // Staff
  createStaff: (d: Partial<Employee>) => Promise<FormResult>;
  updateStaff: (id: string, d: Partial<Employee>) => Promise<FormResult>;
  deactivateStaff: (id: string) => void;
  assignCounter: (staffId: string, counter: number | null) => void;
  staffById: (id: string) => Employee | undefined;
  shiftById: (id: string) => Shift | undefined;
  // Leave
  submitLeave: (d: { staffId: string; leaveType: LeaveType; fromDate: string; toDate: string; reason: string }) => Promise<FormResult>;
  decideLeave: (id: string, status: LeaveStatus, comment?: string) => Promise<FormResult>;
  cancelOwnLeave: (id: string) => Promise<FormResult>;
  pendingApprovals: ApprovalRequest[];
  resolveApproval: (id: string, status: ApprovalStatus, note?: string) => void;
  leaveLoading: boolean;
  leaveError: string | null;
  // Config
  updateConfig: (key: string, value: string) => void;
  // Data management
  resetData: () => void;
  refreshData: () => Promise<boolean>;
  exportData: () => void;
  importData: (jsonText: string) => boolean;
}

const AppCtx = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <UIProvider>
          <TimeClockProvider>
            <PayrollProvider>
              <StaffProvider>
                <LeaveProvider>
                  <ConfigProvider>
                    <AppProviderInner>{children}</AppProviderInner>
                  </ConfigProvider>
                </LeaveProvider>
              </StaffProvider>
            </PayrollProvider>
          </TimeClockProvider>
        </UIProvider>
      </DataProvider>
    </AuthProvider>
  );
}

function AppProviderInner({ children }: { children: ReactNode }) {
  // Combine all context values
  const auth = useAuth();
  const data = useData();
  const ui = useUI();
  const timeClock = useTimeClock();
  const payroll = usePayroll();
  const staff = useStaff();
  const leave = useLeave();
  const config = useConfig();

  const initializedForSession = useRef<string | null>(null);

  // Resolve and enforce role-appropriate view from URL/history.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!auth.hydrated) return;
    if (!auth.session) {
      initializedForSession.current = null;
      return;
    }
    const sessionKey = `${auth.session.role}:${auth.session.staffId ?? auth.session.name}`;
    const parsed = parseViewFromLocation(window.location) as View | null;
    if (initializedForSession.current !== sessionKey) {
      const initial = resolveInitialView(auth.role, window.location) as View;
      ui.setView(initial, { replace: true });
      initializedForSession.current = sessionKey;
      return;
    }
    // On subsequent changes (popstate/URL edits), enforce access; keep valid requested route.
    if (!parsed || !isViewAllowedForRole(auth.role, parsed as any)) {
      ui.setView(defaultViewForRole(auth.role) as View, { replace: true });
    } else if (parsed.page !== ui.view.page || JSON.stringify(parsed.params || null) !== JSON.stringify(ui.view.params || null)) {
      ui.setView(parsed, { replace: true, syncUrl: false });
    }
  }, [auth.hydrated, auth.session, auth.role, ui]);

  // Bridge loginEmployee to use data from DataContext (used for local state sync if needed)
  const loginEmployee = useCallback((session: Session) => {
    if (!session.staffId) { ui.toast("Account found but record unreadable. Please reset demo data in Settings.", "error"); return; }
    const s = data.data.staff.find((e) => e.employeeId === session.staffId || e.username.toLowerCase() === session.staffId!.toLowerCase());
    if (!s) { ui.toast("Account found but record unreadable. Please reset demo data in Settings.", "error"); return; }
    auth.loginEmployee(session);
  }, [data.data.staff, auth, ui]);

  const value: AppContextValue = {
    // Data
    data: data.data,
    // Auth
    session: auth.session,
    role: auth.role,
    hydrated: auth.hydrated && data.hydrated,
    loginAdmin: auth.loginAdmin,
    loginEmployee,
    logout: auth.logout,
    canPerm: (p: string) => auth.canPerm(p as any),
    // UI
    view: ui.view,
    navigate: ui.navigate,
    toasts: ui.toasts,
    toast: ui.toast,
    dismissToast: ui.dismissToast,
    // Time Clock
    clockIn: timeClock.clockIn,
    clockOut: timeClock.clockOut,
    startBreak: timeClock.startBreak,
    endBreak: timeClock.endBreak,
    toggleExtraTime: timeClock.toggleExtraTime,
    startGoOut: timeClock.startGoOut,
    endGoOut: timeClock.endGoOut,
    todaySession: timeClock.todaySession,
    isOnLeaveToday: timeClock.isOnLeaveToday,
    // Payroll
    paySessions: payroll.paySessions,
    payCustomAdvance: payroll.payCustomAdvance,
    takeAdvance: payroll.takeAdvance,
    unpaidShifts: payroll.unpaidShifts,
    anyOnDuty: payroll.anyOnDuty,
    paymentFor: (id: string) => data.data.payments.find(p => p.id === id),
    // Staff
    createStaff: staff.createStaff,
    updateStaff: staff.updateStaff,
    deactivateStaff: staff.deactivateStaff,
    assignCounter: staff.assignCounter,
    staffById: staff.staffById,
    shiftById: staff.shiftById,
    // Leave
    submitLeave: leave.submitLeave,
    decideLeave: leave.decideLeave,
    cancelOwnLeave: leave.cancelOwnLeave,
    pendingApprovals: leave.pendingApprovals,
    resolveApproval: leave.resolveApproval,
    leaveLoading: leave.leaveLoading,
    leaveError: leave.leaveError,
    // Config
    updateConfig: config.updateConfig,
    // Data management
    resetData: data.resetData,
    refreshData: data.refreshData,
    exportData: data.exportData,
    importData: data.importData,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}

export type { PageId, View, Toast, FormResult, ClockInEvent, ConfigEntry, FieldError, ApprovalRequest, Shift };
