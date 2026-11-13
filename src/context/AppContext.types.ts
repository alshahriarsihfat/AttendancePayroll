export type PageId =
  | "dashboard" | "staff" | "payments" | "attendance" | "settings"
  | "leave" | "payslip" | "guide" | "terminal" | "profile" | "stafftime" | "monitor";

export interface View { page: PageId; params?: Record<string, string>; }
export interface Toast { id: string; message: string; type: "success" | "error" | "info"; }
export interface FormResult { ok: boolean; errors?: FieldError[]; }
export interface ClockInEvent { ok: boolean; lateMin: number; isLate: boolean; }

export interface FieldError { field: string; message: string; }

export interface ConfigEntry {
  key: string;
  value: string;
  description: string;
  category: string;
}