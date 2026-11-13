import type { AllocatePaymentResponse } from "@/lib/payroll-client-types";
import type { CoordinatedPayResponse } from "@/lib/payroll-client-types-extra";

export function newIdempotencyKey(prefix = "alloc") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchPayrollSummary(params: { date?: string; staffId?: string; limit?: number; offset?: number }) {
  const sp = new URLSearchParams();
  if (params.date) sp.set("date", params.date);
  if (params.staffId) sp.set("staffId", params.staffId);
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  const res = await fetch(`/api/payroll/summary${qs ? `?${qs}` : ""}`, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let msg = "Payroll summary could not be loaded.";
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch {}
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function allocatePayment(payload: {
  staffId: string; amount: number; idempotencyKey: string;
  periodLabel?: string; note?: string; paidAt?: string;
}): Promise<{ ok: boolean; status: number; data: AllocatePaymentResponse }> {
  const res = await fetch("/api/payments/allocate", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: AllocatePaymentResponse;
  try { data = await res.json(); } catch { data = { ok: false, paymentId: null, staffId: payload.staffId, requestedAmount: payload.amount, actualAllocatedAmount: 0, unfulfilledAmount: payload.amount, remainingOutstanding: 0, allocationStatus: "NONE", allocations: [], skippedDuplicate: false, reason: null, error: "Invalid server response" }; }
  return { ok: res.ok, status: res.status, data };
}

export async function coordinatedPayment(payload: {
  staffId: string; grossAmount: number; deductAdvance: boolean;
  deductionMode?: "full" | "partial"; deductionAmount?: number;
  idempotencyKey: string; periodLabel?: string; note?: string; paidAt?: string;
}): Promise<{ ok: boolean; status: number; data: CoordinatedPayResponse }> {
  const res = await fetch("/api/payments/coordinated", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: CoordinatedPayResponse;
  try { data = await res.json(); } catch { data = { ok: false, staffId: payload.staffId, idempotencyKey: payload.idempotencyKey, grossRequested: payload.grossAmount, deductAdvance: !!payload.deductAdvance, deductionRequested: payload.deductionAmount ?? 0, deductionApplied: 0, netCashRequested: payload.grossAmount, paymentId: null, allocation: null, adjustments: [], remainingAdvance: 0, remainingEarned: 0, skippedDuplicate: false, status: "NONE", error: "Invalid server response" }; }
  return { ok: res.ok, status: res.status, data };
}

export async function fetchAdvanceState(params: { staffId?: string }) {
  const sp = new URLSearchParams();
  if (params.staffId) sp.set("staffId", params.staffId);
  const qs = sp.toString();
  const res = await fetch(`/api/advance${qs ? `?${qs}` : ""}`, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let msg = "Advance state could not be loaded.";
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch {}
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function giveAdvance(payload: { staffId: string; amount: number; note?: string; idempotencyKey?: string }) {
  const res = await fetch("/api/advance", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = { error: "Invalid server response" }; }
  return { ok: res.ok, status: res.status, data };
}

export async function adjustAdvance(payload: { staffId: string; advanceLogId: string; payrollEarningId: string; amount: number; idempotencyKey: string; note?: string }) {
  const res = await fetch("/api/advance/adjust", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = { error: "Invalid server response" }; }
  return { ok: res.ok, status: res.status, data };
}
