export type PayrollUnavailableMetric = { available: false; reason: string };
export type PayrollAmountMetric = { available: true; value: number } | PayrollUnavailableMetric;
export type PayrollCountMetric = { available: true; value: number } | PayrollUnavailableMetric;

export type PayrollPaymentStatus = "READY" | "PARTIAL" | "SETTLED" | "INCOMPLETE" | "WORKING" | "NOT_READY";

export interface PayrollStaffPayableRow {
  staffId: string;
  staffName: string;
  workDate: string | null;
  earningPeriod: { start: string | null; end: string | null; kind: string | null };
  payableHours: number | null;
  earnedAmount: number | null;
  previouslyAllocatedAmount: number;
  manualAdvanceAdjustedAmount?: number;
  remainingOutstandingAmount: number;
  earningStatus: "CALCULATED" | "INCOMPLETE" | "NONE";
  paymentStatus: PayrollPaymentStatus;
  paymentPermitted: boolean;
  earningId: string | null;
  sessionId: string | null;
  isToday: boolean;
  isHistoricalOutstanding: boolean;
  legacySettled: boolean;
}

export interface StaffAccountSummaryDTO {
  staffId: string;
  staffName: string;
  selectedDateEarnedSalary: PayrollAmountMetric;
  selectedDateCashPayments: PayrollAmountMetric;
  selectedDateAdvanceAdjustments: PayrollAmountMetric;
  selectedDateRemainingPayable: PayrollAmountMetric;
  allTimeEarnedSalary: PayrollAmountMetric;
  allTimeCashPayments: PayrollAmountMetric;
  allTimeAdvanceAdjustments: PayrollAmountMetric;
  currentOutstandingEarnedSalary: PayrollAmountMetric;
  totalAdvancesReceived: PayrollAmountMetric;
  totalAdvancesAdjusted: PayrollAmountMetric;
  outstandingAdvances: PayrollAmountMetric;
  currentAdvanceBalance?: PayrollAmountMetric;
}

export interface AdvanceHistoryItemDTO {
  id: string;
  staffId: string;
  staffName?: string | null;
  type: string;
  amount: number;
  balanceAfter?: number | null;
  note?: string | null;
  createdAt: string;
  createdBy?: string | null;
  paymentId?: string | null;
}

export interface AdvanceAdjustmentItemDTO {
  id: string;
  staffId: string;
  staffName?: string | null;
  advanceLogId: string;
  payrollEarningId: string;
  workDate?: string | null;
  amount: number;
  note?: string | null;
  adjustedAt: string;
  adjustedBy?: string | null;
  idempotencyKey: string;
}

export interface PayrollSummaryDTO {
  date: string;
  timezone: "Asia/Dhaka";
  generatedAt: string;
  summary: {
    todayEarnedAmount: PayrollAmountMetric;
    todayCashPaymentsAmount?: PayrollAmountMetric;
    todayAdvanceAdjustmentsAmount?: PayrollAmountMetric;
    todayAvailableAmount: PayrollAmountMetric;
    todayAvailableFromOlderOutstandingAmount: PayrollAmountMetric;
    todayPaidAmount: PayrollAmountMetric;
    todayPaidTowardTodayEarningsAmount: PayrollAmountMetric;
    todayPaidTowardOlderEarningsAmount: PayrollAmountMetric;
    totalOutstandingAmount: PayrollAmountMetric;
    outstandingAdvancesAmount?: PayrollAmountMetric;
    clockedOutCount: PayrollCountMetric;
    stillWorkingCount: PayrollCountMetric;
    earningReadyCount: PayrollCountMetric;
    incompleteEarningCount: PayrollCountMetric;
    partiallyPaidCount: PayrollCountMetric;
    fullyPaidCount: PayrollCountMetric;
  };
  staffPayables: {
    rows: PayrollStaffPayableRow[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  staffAccounts?: StaffAccountSummaryDTO[];
  advances?: { available: boolean; reason?: string; items: AdvanceHistoryItemDTO[]; adjustments: AdvanceAdjustmentItemDTO[] };
  notes: string[];
}

export type AllocationStatus = "FULL" | "PARTIAL" | "NONE" | "REPLAY";

export interface AllocationRowDTO {
  id: string;
  payrollEarningId: string;
  amount: number;
  idempotencyKey?: string | null;
}

export interface AllocatePaymentResponse {
  ok: boolean;
  paymentId: string | null;
  staffId: string;
  requestedAmount: number;
  actualAllocatedAmount: number;
  unfulfilledAmount: number;
  remainingOutstanding: number;
  allocationStatus: AllocationStatus;
  allocations: AllocationRowDTO[];
  skippedDuplicate: boolean;
  reason: string | null;
  error?: string;
  issues?: unknown;
}

export interface AllocationReceiptContext {
  staffId: string;
  staffName: string;
  response: AllocatePaymentResponse;
  workDateLabel?: string | null;
  earningPeriods?: string[];
  paidAt?: string;
  idempotencyKey: string;
}

export function formatPayrollAmountMetric(m: PayrollAmountMetric, unavailableLabel = "তথ্য নেই"): string | null {
  return m.available ? null : unavailableLabel;
}

export function statusLabelBn(s: PayrollPaymentStatus): string {
  switch (s) {
    case "READY": return "পেমেন্ট করা যাবে";
    case "PARTIAL": return "আংশিক পরিশোধ";
    case "SETTLED": return "সম্পূর্ণ পরিশোধ";
    case "INCOMPLETE": return "হিসাব অসম্পূর্ণ";
    case "WORKING": return "এখনো ডিউটিতে";
    case "NOT_READY": return "বেতন প্রস্তুত হয়নি";
    default: return s;
  }
}
