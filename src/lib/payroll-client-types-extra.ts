import type { AllocatePaymentResponse } from "@/lib/payroll-client-types";

export type CoordinatedAdjustmentRowDTO = {
  adjustmentId: string;
  advanceLogId: string;
  payrollEarningId: string;
  amount: number;
  skippedDuplicate: boolean;
};

export type CoordinatedPayResponse = {
  ok: boolean;
  staffId: string;
  idempotencyKey: string;
  grossRequested: number;
  deductAdvance: boolean;
  deductionRequested: number;
  deductionApplied: number;
  netCashRequested: number;
  paymentId: string | null;
  allocation: {
    requestedAmount: number;
    actualAllocatedAmount: number;
    unfulfilledAmount: number;
    remainingOutstanding: number;
    allocationStatus: AllocatePaymentResponse["allocationStatus"];
    allocations: AllocatePaymentResponse["allocations"];
    reason?: string;
  } | null;
  adjustments: CoordinatedAdjustmentRowDTO[];
  remainingAdvance: number;
  remainingEarned: number;
  skippedDuplicate: boolean;
  status: "FULL" | "PARTIAL" | "ADJUSTMENT_ONLY" | "NONE" | "REPLAY";
  reason?: string | null;
  error?: string;
  issues?: unknown;
};
