"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, EmptyState, Input } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { adjustAdvance, coordinatedPayment, fetchAdvanceState, fetchPayrollSummary, giveAdvance, newIdempotencyKey } from "../lib/payroll-client";
import type { AdvanceAdjustmentItemDTO, AdvanceHistoryItemDTO, PayrollAmountMetric, PayrollPaymentStatus, PayrollStaffPayableRow, PayrollSummaryDTO } from "../lib/payroll-client-types";
import type { CoordinatedPayResponse } from "../lib/payroll-client-types-extra";
import { formatBDT, payRound } from "../lib/currency";
import { formatDate, formatDateTime } from "../lib/dates";
import { dhakaTodayKey } from "../lib/timeclock";
import { cn } from "../lib/utils";

type Tab = "daily" | "accounts" | "payments" | "advances";

type PaymentDialogState = {
  staffId: string;
  staffName: string;
  grossAmount: string;
  deductAdvance: boolean;
  deductionMode: "full" | "partial";
  deductionAmount: string;
  idempotencyKey: string;
  loading: boolean;
  loadError: string | null;
  authoritativeOutstandingEarned: number | null;
  authoritativeOutstandingAdvance: number | null;
  submitting: boolean;
  submitError: string | null;
  result: CoordinatedPayResponse | null;
};

type GiveAdvanceDialog = {
  staffId: string;
  staffName: string;
  amount: string;
  note: string;
  idempotencyKey: string;
  submitting: boolean;
  error: string | null;
  result: any | null;
};

type AdjustAdvanceDialog = {
  staffId: string;
  staffName: string;
  advanceLogId: string;
  payrollEarningId: string;
  amount: string;
  note: string;
  idempotencyKey: string;
  submitting: boolean;
  error: string | null;
  result: any | null;
  confirmed: boolean;
};

type AdvanceState = {
  loading: boolean;
  error: string | null;
  state: any | null;
  eligibleEarnings: any[];
  logs: AdvanceHistoryItemDTO[];
  adjustments: AdvanceAdjustmentItemDTO[];
  available: boolean;
  reason?: string;
};

function amountText(m: PayrollAmountMetric | null | undefined): string {
  if (!m) return "Unavailable";
  if (!m.available) return "Unavailable";
  return formatBDT(m.value);
}

function money(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? formatBDT(v) : "Unavailable";
}

function hours(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(2)} h` : "Unavailable";
}

function statusLabel(s: PayrollPaymentStatus): string {
  switch (s) {
    case "READY": return "Ready";
    case "PARTIAL": return "Partially paid";
    case "SETTLED": return "Fully paid";
    case "INCOMPLETE": return "Incomplete";
    case "WORKING": return "Working";
    case "NOT_READY": return "Not ready";
    default: return s;
  }
}

function statusTone(s: PayrollPaymentStatus): string {
  switch (s) {
    case "READY": return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25";
    case "PARTIAL": return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25";
    case "SETTLED": return "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/25";
    case "INCOMPLETE": return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25";
    case "WORKING": return "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25";
    default: return "bg-surface-muted text-muted-foreground ring-edge";
  }
}

function coordStatusLabel(s: CoordinatedPayResponse["status"] | null | undefined): string {
  if (!s) return "Unknown";
  if (s === "REPLAY") return "Replayed (idempotent)";
  if (s === "ADJUSTMENT_ONLY") return "Advance deduction only";
  if (s === "PARTIAL") return "Partial cash allocation";
  if (s === "FULL") return "Full cash allocation";
  return "No cash allocation";
}

function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function Pill({ children, tone = "slate" }: { children: any; tone?: "slate" | "blue" | "emerald" | "amber" | "rose" }) {
  const cls = tone === "blue" ? "bg-primary-soft text-primary ring-primary/20" : tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25" : tone === "amber" ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25" : tone === "rose" ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/25" : "bg-surface-muted text-muted-foreground ring-edge";
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", cls)}>{children}</span>;
}export function Payments() {
  const { data, navigate, staffById, refreshData, toast } = useApp();
  const today = dhakaTodayKey();

  const [tab, setTab] = useState<Tab>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [summary, setSummary] = useState<PayrollSummaryDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [advanceQuery, setAdvanceQuery] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  const [accountSummary, setAccountSummary] = useState<PayrollSummaryDTO | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [payDialog, setPayDialog] = useState<PaymentDialogState | null>(null);

  const [advanceState, setAdvanceState] = useState<AdvanceState>({ loading: false, error: null, state: null, eligibleEarnings: [], logs: [], adjustments: [], available: true });
  const [giveDialog, setGiveDialog] = useState<GiveAdvanceDialog | null>(null);
  const [adjustDialog, setAdjustDialog] = useState<AdjustAdvanceDialog | null>(null);

  const load = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = (await fetchPayrollSummary({ date, limit: 200, offset: 0 })) as PayrollSummaryDTO;
      setSummary(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Payroll summary could not be loaded.";
      setError(msg);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(selectedDate); }, [selectedDate, load]);

  const loadStaffAccount = useCallback(async (staffId: string) => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const res = (await fetchPayrollSummary({ staffId, limit: 200, offset: 0 })) as PayrollSummaryDTO;
      setAccountSummary(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Staff payroll account could not be loaded.";
      setAccountError(msg);
      setAccountSummary(null);
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedStaffId) { setAccountSummary(null); setAccountError(null); return; }
    void loadStaffAccount(selectedStaffId);
  }, [selectedStaffId, loadStaffAccount]);

  const loadAdvanceState = useCallback(async (staffId?: string) => {
    setAdvanceState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res: any = await fetchAdvanceState(staffId ? { staffId } : {});
      const logs = Array.isArray(res?.advanceLogs) ? res.advanceLogs : (Array.isArray(res?.logs) ? res.logs : []);
      const adjustments = Array.isArray(res?.adjustments) ? res.adjustments : [];
      setAdvanceState({ loading: false, error: null, state: res?.state ?? null, eligibleEarnings: Array.isArray(res?.eligibleEarnings) ? res.eligibleEarnings : [], logs, adjustments, available: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Advance state could not be loaded.";
      const sAdv = summary?.advances;
      setAdvanceState({ loading: false, error: msg, state: null, eligibleEarnings: [], logs: sAdv?.items ?? [], adjustments: sAdv?.adjustments ?? [], available: sAdv?.available ?? false, reason: sAdv?.reason });
    }
  }, [summary]);

  useEffect(() => {
    if (tab === "advances") void loadAdvanceState(selectedStaffId || undefined);
  }, [tab, selectedStaffId, loadAdvanceState]);

  const rows = summary?.staffPayables.rows ?? [];
  const q = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!q) return rows;
    return rows.filter((r) => [r.staffName, r.staffId, r.paymentStatus, r.earningStatus, r.workDate || ""].some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, q]);

  const dailyRows = useMemo(() => {
    const forDate = filteredRows.filter((r) => r.isToday || r.workDate === selectedDate);
    return forDate.length > 0 ? forDate : filteredRows;
  }, [filteredRows, selectedDate]);

  const staffAccounts = useMemo(() => {
    const map = new Map<string, { staffId: string; staffName: string; todayEarned: number; scopeEarned: number; scopeAllocated: number; scopeOutstanding: number; hasIncomplete: boolean; rows: PayrollStaffPayableRow[] }>();
    for (const r of rows) {
      const cur = map.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staffName, todayEarned: 0, scopeEarned: 0, scopeAllocated: 0, scopeOutstanding: 0, hasIncomplete: false, rows: [] };
      if (r.earningStatus === "CALCULATED" && typeof r.earnedAmount === "number") {
        cur.scopeEarned = payRound(cur.scopeEarned + r.earnedAmount);
        if (r.isToday || r.workDate === selectedDate) cur.todayEarned = payRound(cur.todayEarned + r.earnedAmount);
      }
      cur.scopeAllocated = payRound(cur.scopeAllocated + (r.previouslyAllocatedAmount || 0));
      cur.scopeOutstanding = payRound(cur.scopeOutstanding + (r.remainingOutstandingAmount || 0));
      if (r.earningStatus === "INCOMPLETE" || r.paymentStatus === "INCOMPLETE") cur.hasIncomplete = true;
      cur.rows.push(r);
      map.set(r.staffId, cur);
    }
    const list = Array.from(map.values());
    const aq = q;
    return (aq ? list.filter((s) => [s.staffName, s.staffId].some((v) => v.toLowerCase().includes(aq))) : list)
      .sort((a, b) => b.scopeOutstanding - a.scopeOutstanding || a.staffName.localeCompare(b.staffName));
  }, [rows, q, selectedDate]);

  const selectedAccount = useMemo(() => staffAccounts.find((s) => s.staffId === selectedStaffId) ?? null, [staffAccounts, selectedStaffId]);

  const history = useMemo(() => {
    const qq = historyQuery.trim().toLowerCase();
    const list = data.payments.slice().sort((a, b) => (b.paidAt || b.date || "").localeCompare(a.paidAt || a.date || ""));
    if (!qq) return list;
    return list.filter((p) => {
      const s = staffById(p.staffId);
      return [s?.fullName, s?.employeeId, p.staffId, p.date, p.id, p.batchId || "", p.status || "", p.periodLabel || ""].some((v) => String(v || "").toLowerCase().includes(qq));
    });
  }, [data.payments, historyQuery, staffById]);

  const notes = summary?.notes ?? [];

  const advanceLogs = useMemo(() => {
    const fromState = advanceState.logs || [];
    const fromSummary = summary?.advances?.items || [];
    const base = fromState.length > 0 ? fromState : fromSummary;
    const qq = advanceQuery.trim().toLowerCase();
    if (!qq) return base;
    return base.filter((l) => [l.staffId, l.staffName || "", l.type || "", l.note || "", l.id].some((v) => String(v).toLowerCase().includes(qq)));
  }, [advanceState.logs, summary, advanceQuery]);

  const advanceAdjustments = useMemo(() => {
    const fromState = advanceState.adjustments || [];
    const fromSummary = summary?.advances?.adjustments || [];
    const base = fromState.length > 0 ? fromState : fromSummary;
    const qq = advanceQuery.trim().toLowerCase();
    if (!qq) return base;
    return base.filter((a) => [a.staffId, a.staffName || "", a.note || "", a.advanceLogId, a.payrollEarningId, a.id, a.workDate || ""].some((v) => String(v).toLowerCase().includes(qq)));
  }, [advanceState.adjustments, summary, advanceQuery]);

  const totals = summary?.summary;
  const outstandingAdvMetric = totals?.outstandingAdvancesAmount ?? (summary?.staffAccounts?.length ? { available: true, value: payRound(summary.staffAccounts.reduce((s, a) => s + (a.outstandingAdvances?.available ? a.outstandingAdvances.value : 0), 0)) } as any : null);
  const todayCashMetric = totals?.todayCashPaymentsAmount ?? totals?.todayPaidAmount ?? null;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshData(),
      load(selectedDate),
      selectedStaffId ? loadStaffAccount(selectedStaffId) : Promise.resolve(),
      tab === "advances" || tab === "accounts" ? loadAdvanceState(selectedStaffId || undefined) : Promise.resolve(),
    ]);
  }, [load, loadAdvanceState, loadStaffAccount, refreshData, selectedDate, selectedStaffId, tab]);

  const openPaymentDialog = useCallback(async (staffId: string, staffName: string) => {
    const key = newIdempotencyKey("coord");
    setPayDialog({ staffId, staffName, grossAmount: "", deductAdvance: false, deductionMode: "full", deductionAmount: "", idempotencyKey: key, loading: true, loadError: null, authoritativeOutstandingEarned: null, authoritativeOutstandingAdvance: null, submitting: false, submitError: null, result: null });
    try {
      const [sum, adv] = await Promise.all([
        fetchPayrollSummary({ staffId, limit: 1, offset: 0 }) as Promise<PayrollSummaryDTO>,
        fetchAdvanceState({ staffId }).catch(() => null),
      ]);
      const m = sum.summary.totalOutstandingAmount;
      const advOutstanding = adv?.state?.outstandingAdvance;
      const advFromAccount = sum.staffAccounts?.find((a: any) => a.staffId === staffId)?.outstandingAdvances;
      const advVal = typeof advOutstanding === "number" && Number.isFinite(advOutstanding) ? advOutstanding : (advFromAccount?.available ? advFromAccount.value : null);
      setPayDialog((cur) => cur && cur.staffId === staffId && cur.idempotencyKey === key ? {
        ...cur,
        loading: false,
        authoritativeOutstandingEarned: m.available ? m.value : null,
        authoritativeOutstandingAdvance: advVal,
        loadError: m.available ? null : `Outstanding earned unavailable (${m.reason}).`,
        grossAmount: m.available && m.value > 0 ? String(payRound(m.value)) : cur.grossAmount,
      } : cur);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load authoritative balances.";
      setPayDialog((cur) => cur && cur.staffId === staffId && cur.idempotencyKey === key ? { ...cur, loading: false, loadError: msg } : cur);
    }
  }, []);

  const closePaymentDialog = useCallback(() => setPayDialog(null), []);

  const computeDeductionPreview = useCallback((d: PaymentDialogState): { gross: number | null; deduction: number | null; net: number | null; error: string | null } => {
    const gross = parseAmountInput(d.grossAmount);
    if (gross == null || gross <= 0) return { gross, deduction: 0, net: gross, error: null };
    if (!d.deductAdvance) return { gross, deduction: 0, net: gross, error: null };
    const outAdv = d.authoritativeOutstandingAdvance;
    const outEarned = d.authoritativeOutstandingEarned;
    let target = 0;
    if (d.deductionMode === "partial") {
      const req = parseAmountInput(d.deductionAmount);
      if (req == null || req <= 0) return { gross, deduction: null, net: null, error: "Enter a valid partial deduction amount." };
      target = req;
    } else {
      if (outAdv == null || outEarned == null) return { gross, deduction: null, net: null, error: null };
      target = Math.min(outAdv, outEarned, gross);
    }
    const caps = [target];
    if (outAdv != null) caps.push(outAdv);
    if (outEarned != null) caps.push(outEarned);
    caps.push(gross);
    const deduction = payRound(Math.max(0, Math.min(...caps)));
    const net = payRound(Math.max(0, gross - deduction));
    let error: string | null = null;
    if (d.deductionMode === "partial") {
      if (outAdv != null && target - outAdv > 0.000001) error = "Deduction exceeds outstanding advance.";
      else if (outEarned != null && target - outEarned > 0.000001) error = "Deduction exceeds eligible unpaid earnings.";
      else if (target - gross > 0.000001) error = "Deduction cannot exceed gross amount.";
    } else {
      if (outAdv != null && outAdv <= 0.000001) error = "No outstanding advance available for deduction.";
    }
    return { gross, deduction, net, error };
  }, []);

  const submitPayment = useCallback(async () => {
    if (!payDialog) return;
    const gross = parseAmountInput(payDialog.grossAmount);
    if (gross == null || gross <= 0) { setPayDialog({ ...payDialog, submitError: "Enter a valid gross amount greater than zero." }); return; }
    const preview = computeDeductionPreview(payDialog);
    if (preview.error) { setPayDialog({ ...payDialog, submitError: preview.error }); return; }
    let deductionAmount: number | undefined = undefined;
    if (payDialog.deductAdvance && payDialog.deductionMode === "partial") {
      const req = parseAmountInput(payDialog.deductionAmount);
      if (req == null || req <= 0) { setPayDialog({ ...payDialog, submitError: "Enter a valid partial deduction amount." }); return; }
      deductionAmount = payRound(req);
    }
    setPayDialog({ ...payDialog, submitting: true, submitError: null });
    try {
      const { data: res, ok } = await coordinatedPayment({
        staffId: payDialog.staffId,
        grossAmount: payRound(gross),
        deductAdvance: payDialog.deductAdvance,
        deductionMode: payDialog.deductAdvance ? payDialog.deductionMode : undefined,
        deductionAmount,
        idempotencyKey: payDialog.idempotencyKey,
        periodLabel: "Payroll allocation",
      });
      if (!ok) {
        setPayDialog((cur) => cur ? { ...cur, submitting: false, submitError: res.error || res.reason || "Payment request failed." } : cur);
        return;
      }
      setPayDialog((cur) => cur ? { ...cur, submitting: false, result: res } : cur);
      await refreshAll();
      const msg = res.skippedDuplicate || res.status === "REPLAY" ? "Duplicate request safely replayed." : res.status === "ADJUSTMENT_ONLY" ? "Advance deduction recorded (no cash payment)." : "Payment completed.";
      toast(msg, "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Payment request failed.";
      setPayDialog((cur) => cur ? { ...cur, submitting: false, submitError: msg } : cur);
    }
  }, [computeDeductionPreview, payDialog, refreshAll, toast]);

  const retryPaymentSameKey = useCallback(async () => { if (payDialog) await submitPayment(); }, [payDialog, submitPayment]);

  const openGiveAdvance = useCallback((staffId: string, staffName: string) => {
    setGiveDialog({ staffId, staffName, amount: "", note: "", idempotencyKey: newIdempotencyKey().replace(/^alloc:/, "adv:"), submitting: false, error: null, result: null });
  }, []);

  const submitGiveAdvance = useCallback(async () => {
    if (!giveDialog) return;
    const amount = parseAmountInput(giveDialog.amount);
    if (amount == null || amount <= 0) { setGiveDialog({ ...giveDialog, error: "Enter a valid advance amount greater than zero." }); return; }
    setGiveDialog({ ...giveDialog, submitting: true, error: null });
    try {
      const res = await giveAdvance({ staffId: giveDialog.staffId, amount: payRound(amount), note: giveDialog.note.trim() || undefined, idempotencyKey: giveDialog.idempotencyKey });
      if (!res.ok) { setGiveDialog((cur) => cur ? { ...cur, submitting: false, error: res.data?.error || "Advance could not be recorded." } : cur); return; }
      setGiveDialog((cur) => cur ? { ...cur, submitting: false, result: res.data } : cur);
      await Promise.all([refreshData(), load(selectedDate), selectedStaffId ? loadStaffAccount(selectedStaffId) : Promise.resolve(), loadAdvanceState(selectedStaffId || giveDialog.staffId)]);
      toast(res.data?.skippedDuplicate || res.data?.reason === "REPLAY" ? "Duplicate advance request safely replayed." : "Advance recorded.", "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Advance could not be recorded.";
      setGiveDialog((cur) => cur ? { ...cur, submitting: false, error: msg } : cur);
    }
  }, [giveDialog, load, loadAdvanceState, loadStaffAccount, refreshData, selectedDate, selectedStaffId, toast]);

  const openAdjustAdvance = useCallback((staffId: string, staffName: string) => {
    setAdjustDialog({ staffId, staffName, advanceLogId: "", payrollEarningId: "", amount: "", note: "", idempotencyKey: newIdempotencyKey().replace(/^alloc:/, "adj:"), submitting: false, error: null, result: null, confirmed: false });
    void loadAdvanceState(staffId);
  }, [loadAdvanceState]);

  const submitAdjustAdvance = useCallback(async () => {
    if (!adjustDialog) return;
    const amount = parseAmountInput(adjustDialog.amount);
    if (!adjustDialog.advanceLogId || !adjustDialog.payrollEarningId) { setAdjustDialog({ ...adjustDialog, error: "Select an advance and an eligible earning." }); return; }
    if (amount == null || amount <= 0) { setAdjustDialog({ ...adjustDialog, error: "Enter a valid adjustment amount greater than zero." }); return; }
    if (!adjustDialog.confirmed) { setAdjustDialog({ ...adjustDialog, error: "Explicit confirmation is required before manual adjustment." }); return; }
    setAdjustDialog({ ...adjustDialog, submitting: true, error: null });
    try {
      const res = await adjustAdvance({ staffId: adjustDialog.staffId, advanceLogId: adjustDialog.advanceLogId, payrollEarningId: adjustDialog.payrollEarningId, amount: payRound(amount), idempotencyKey: adjustDialog.idempotencyKey, note: adjustDialog.note.trim() || undefined });
      if (!res.ok) { setAdjustDialog((cur) => cur ? { ...cur, submitting: false, error: res.data?.error || "Advance adjustment failed." } : cur); return; }
      setAdjustDialog((cur) => cur ? { ...cur, submitting: false, result: res.data } : cur);
      await Promise.all([refreshData(), load(selectedDate), loadStaffAccount(adjustDialog.staffId), loadAdvanceState(adjustDialog.staffId)]);
      toast(res.data?.skippedDuplicate || res.data?.reason === "REPLAY" ? "Duplicate adjustment safely replayed." : "Advance adjustment recorded.", "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Advance adjustment failed.";
      setAdjustDialog((cur) => cur ? { ...cur, submitting: false, error: msg } : cur);
    }
  }, [adjustDialog, load, loadAdvanceState, loadStaffAccount, refreshData, selectedDate, toast]);

  const todayAdjMetric = totals?.todayAdvanceAdjustmentsAmount ?? null;

  const tabs: Array<[Tab, string, string]> = [
    ["daily", "Daily Payroll", "dashboard"],
    ["accounts", "Staff Accounts", "users2"],
    ["payments", "Payments & History", "receipt"],
    ["advances", "Advances & Adjustments", "wallet"],
  ];
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-6 animate-fade">
      <div className="rounded-2xl border border-edge bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-primary-deep to-primary-bright text-white shadow-sm"><Icon name="wallet" size={16} /></span>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Khan Pharmacy · Payroll</p>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Payroll Management</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Server-authoritative payroll. Earned salary, cash payments, advance adjustments, and outstanding balances tracked separately. Advances never auto-deducted.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-muted-foreground">Work date (Asia/Dhaka)
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value || today)} className="mt-1 block h-10 rounded-xl border border-edge bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </label>
            <Button size="md" variant="secondary" icon="refresh" onClick={() => void refreshAll()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="wallet" label="Today's Earned" value={amountText(totals?.todayEarnedAmount)} sub="Accrued earned salary (selected date)" tone="blue" />
        <MetricCard icon="check" label="Today's Cash Payments" value={amountText(todayCashMetric)} sub="Cash paid by payment date (Asia/Dhaka)" tone="emerald" />
        <MetricCard icon="clock" label="Total Outstanding Earned" value={amountText(totals?.totalOutstandingAmount)} sub="Server-authoritative outstanding earned salary" tone="amber" />
        <MetricCard icon="arrowLeft" label="Outstanding Advances" value={amountText(outstandingAdvMetric as any)} sub="Advances received minus adjustments (ledger-derived)" tone="rose" />
      </div>

      <Card className="p-2 sm:p-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map(([k, label, icon]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={cn("inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition", tab === k ? "bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-sm shadow-primary/25" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground")}>
                <Icon name={icon as any} size={16} /><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            {(tab === "daily" || tab === "accounts") && (
              <div className="relative w-full sm:w-72"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"><Icon name="search" size={15} /></span><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search staff / status…" className="pl-9" /></div>
            )}
            {tab === "payments" && (
              <div className="relative w-full sm:w-72"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"><Icon name="search" size={15} /></span><Input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Search staff, date, batch…" className="pl-9" /></div>
            )}
            {tab === "advances" && (
              <div className="relative w-full sm:w-72"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"><Icon name="search" size={15} /></span><Input value={advanceQuery} onChange={(e) => setAdvanceQuery(e.target.value)} placeholder="Search advances / adjustments…" className="pl-9" /></div>
            )}
          </div>
        </div>
      </Card>

      {error && <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"><div className="flex items-start gap-2"><Icon name="alert" size={16} className="mt-0.5" /><div><p className="font-semibold">Payroll summary unavailable</p><p>{error}</p></div></div></Card>}

      {tab === "daily" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoStrip title="Selected Date" value={formatDate(selectedDate)} sub="Daily earning/work context" icon="calendar" tone="blue" />
            <InfoStrip title="Manual Advance Adjustments (Today)" value={amountText(todayAdjMetric)} sub="Ledger-derived, separate from cash payments" icon="sliders" tone="emerald" />
          </div>

          <Card className="overflow-hidden">
            <SectionHead title={`Daily Payroll Detail — ${formatDate(selectedDate)}`} desc="Accrued earnings and payment status from server summary. Clock-out type/status and per-staff paid-today breakdown are shown as Unavailable where the current summary contract does not provide them. Legacy session settlement is not used by active Payroll UI." />
            {loading && !summary ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading payroll summary from server…</div>
            ) : dailyRows.length === 0 ? (
              <div className="p-8"><EmptyState icon="receipt" title="No payroll rows for this date" desc="Rows appear after successful clock-out and accrual." /></div>
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead><tr className="border-b border-edge bg-surface-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">
                      <th className="px-4 py-3">Staff</th><th className="px-4 py-3 text-right">Payable Hours</th><th className="px-4 py-3 text-right">Earned Salary</th><th className="px-4 py-3">Clock-out Type/Status</th><th className="px-4 py-3 text-right">Paid Today (Staff)</th><th className="px-4 py-3 text-right">Cash Allocated</th><th className="px-4 py-3 text-right">Advance Adjusted</th><th className="px-4 py-3 text-right">Current Outstanding</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th>
                    </tr></thead>
                    <tbody className="divide-y divide-edge">
                      {dailyRows.map((r) => {
                        const st = staffById(r.staffId);
                        const earned = r.earningStatus === "CALCULATED" ? money(r.earnedAmount) : "Unavailable";
                        return (
                          <tr key={r.staffId + "-" + (r.earningId || r.sessionId || r.workDate || "row")} className={cn("transition hover:bg-surface-muted/30", r.paymentStatus === "INCOMPLETE" && "bg-rose-50/30 dark:bg-rose-500/5")}>
                            <td className="px-4 py-3"><div className="flex items-center gap-3"><PhotoAvatar name={r.staffName} photoUrl={st?.photoUrl} size={34} /><div className="min-w-0"><p className="truncate font-semibold text-foreground">{r.staffName}</p><p className="text-xs text-faint-foreground">{r.staffId}{r.workDate ? " · " + formatDate(r.workDate) : ""}</p></div></div></td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{hours(r.payableHours)}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{earned}</td>
                            <td className="px-4 py-3 text-xs text-faint-foreground">Unavailable</td>
                            <td className="px-4 py-3 text-right tabular-nums text-faint-foreground">Unavailable</td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(r.previouslyAllocatedAmount)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(r.manualAdvanceAdjustedAmount ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{money(r.remainingOutstandingAmount)}</td>
                            <td className="px-4 py-3"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset", statusTone(r.paymentStatus))}>{statusLabel(r.paymentStatus)}</span></td>
                            <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1.5"><Button size="sm" variant="secondary" icon="wallet" onClick={() => void openPaymentDialog(r.staffId, r.staffName)}>Pay</Button></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 p-3 lg:hidden">
                  {dailyRows.map((r) => {
                    const st = staffById(r.staffId);
                    return (
                      <div key={r.staffId + "-" + (r.earningId || r.sessionId || r.workDate || "m")} className={cn("rounded-2xl border border-edge bg-surface p-4", r.paymentStatus === "INCOMPLETE" && "border-rose-200 dark:border-rose-500/30")}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3"><PhotoAvatar name={r.staffName} photoUrl={st?.photoUrl} size={38} /><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{r.staffName}</p><p className="text-xs text-faint-foreground">{r.staffId}{r.workDate ? " · " + formatDate(r.workDate) : ""}</p></div></div>
                          <span className={cn("shrink-0 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset", statusTone(r.paymentStatus))}>{statusLabel(r.paymentStatus)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <MiniStat label="Payable Hours" value={hours(r.payableHours)} />
                          <MiniStat label="Earned Salary" value={r.earningStatus === "CALCULATED" ? money(r.earnedAmount) : "Unavailable"} />
                          <MiniStat label="Cash Allocated" value={money(r.previouslyAllocatedAmount)} />
                          <MiniStat label="Advance Adjusted" value={money(r.manualAdvanceAdjustedAmount ?? 0)} />
                          <MiniStat label="Current Outstanding" value={money(r.remainingOutstandingAmount)} />
                          <MiniStat label="Clock-out / Paid Today" value="Unavailable" />
                        </div>
                        <div className="mt-3 flex justify-end"><Button size="sm" variant="secondary" icon="wallet" onClick={() => void openPaymentDialog(r.staffId, r.staffName)}>Pay</Button></div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {summary?.staffPayables.hasMore && <div className="border-t border-edge px-4 py-2.5 text-xs text-faint-foreground">Showing first {summary.staffPayables.rows.length} rows from server (more available). Authoritative staff balances in payment dialog/account detail use server totals.</div>}
          </Card>
        </div>
      )}

      {tab === "accounts" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <Card className="overflow-hidden">
            <SectionHead title="Staff Payroll Accounts" desc={`Loaded scope: selected date summary rows (first ${summary?.staffPayables.rows.length ?? 0}). Authoritative all-time outstanding is fetched per selected staff.`} />
            {staffAccounts.length === 0 ? (
              <div className="p-8"><EmptyState icon="users2" title="No staff accounts in current scope" desc="Change the selected date or refresh." /></div>
            ) : (
              <div className="max-h-[36rem] divide-y divide-edge overflow-auto">
                {staffAccounts.map((s) => {
                  const st = staffById(s.staffId);
                  const active = selectedStaffId === s.staffId;
                  return (
                    <button key={s.staffId} type="button" onClick={() => setSelectedStaffId(s.staffId)} className={cn("w-full px-4 py-3.5 text-left transition", active ? "bg-primary-soft/40" : "hover:bg-surface-muted/40")}>
                      <div className="flex items-center gap-3">
                        <PhotoAvatar name={s.staffName} photoUrl={st?.photoUrl} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{s.staffName}</p>
                          <p className="text-xs text-faint-foreground">{s.staffId} · Earned (selected date, scope): {formatBDT(s.todayEarned, false)}</p>
                        </div>
                        <div className="text-right text-xs"><p className="font-semibold text-amber-700 dark:text-amber-300">{formatBDT(s.scopeOutstanding, false)}</p><p className="text-faint-foreground">Outstanding (scope)</p></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            {!selectedAccount ? (
              <div className="p-10"><EmptyState icon="info" title="Select a staff account" desc="Authoritative earnings, outstanding salary, and advance state will be loaded from the server." /></div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="border-b border-edge px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-3"><PhotoAvatar name={selectedAccount.staffName} photoUrl={staffById(selectedAccount.staffId)?.photoUrl} size={46} /><div><p className="text-base font-semibold text-foreground">{selectedAccount.staffName}</p><p className="text-xs text-muted-foreground">{selectedAccount.staffId}</p></div></div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" icon="wallet" onClick={() => void openPaymentDialog(selectedAccount.staffId, selectedAccount.staffName)}>Pay Salary</Button>
                      <Button size="sm" variant="secondary" icon="plus" onClick={() => openGiveAdvance(selectedAccount.staffId, selectedAccount.staffName)}>Give Advance</Button>
                      <Button size="sm" variant="secondary" icon="sliders" onClick={() => openAdjustAdvance(selectedAccount.staffId, selectedAccount.staffName)}>Adjust Advance</Button>
                    </div>
                  </div>
                  {accountLoading && <p className="mt-3 text-xs text-muted-foreground">Loading authoritative staff balance…</p>}
                  {accountError && <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{accountError}</p>}
                  <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <MiniStat label="Earned (Selected Date, Scope)" value={formatBDT(selectedAccount.todayEarned)} />
                    <MiniStat label="Earned (Loaded Scope)" value={formatBDT(selectedAccount.scopeEarned)} />
                    <MiniStat label="Allocated Cash (Loaded Scope)" value={formatBDT(selectedAccount.scopeAllocated)} />
                    <MiniStat label="Outstanding Earned (Authoritative)" value={accountSummary ? amountText(accountSummary.summary.totalOutstandingAmount) : "Loading…"} />
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <MiniStat label="Outstanding Advances (Server)" value={amountText((accountSummary?.staffAccounts?.find((a:any)=>a.staffId===selectedAccount.staffId)?.outstandingAdvances) ?? (accountSummary?.summary as any)?.outstandingAdvancesAmount ?? outstandingAdvMetric as any)} />
                    <MiniStat label="Total Advances Received" value={amountText(accountSummary?.staffAccounts?.find((a:any)=>a.staffId===selectedAccount.staffId)?.totalAdvancesReceived ?? null)} />
                    <MiniStat label="Total Advances Adjusted" value={amountText(accountSummary?.staffAccounts?.find((a:any)=>a.staffId===selectedAccount.staffId)?.totalAdvancesAdjusted ?? null)} />
                  </div>
                  <p className="mt-2 text-[11px] text-faint-foreground">Loaded-scope values come from paginated selected-date rows. Authoritative all-time outstanding salary/advance balances are fetched from server. Full all-time earning timeline may be limited by summary contract; unavailable values shown as Unavailable.</p>
                </div>
                <div className="max-h-[26rem] overflow-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="sticky top-0 z-10 bg-surface"><tr className="border-b border-edge text-left text-[11px] font-semibold uppercase tracking-wide text-faint-foreground"><th className="px-4 py-2.5">Work Date</th><th className="px-4 py-2.5 text-right">Payable Hours</th><th className="px-4 py-2.5 text-right">Earned</th><th className="px-4 py-2.5 text-right">Cash Allocated</th><th className="px-4 py-2.5 text-right">Advance Adjusted</th><th className="px-4 py-2.5 text-right">Outstanding</th><th className="px-4 py-2.5">Status</th></tr></thead>
                    <tbody className="divide-y divide-edge">
                      {selectedAccount.rows.slice().sort((a,b)=>(b.workDate||"").localeCompare(a.workDate||"")).map((r) => (
                        <tr key={r.earningId || r.sessionId || (r.staffId + "-" + r.workDate)} className="hover:bg-surface-muted/30">
                          <td className="px-4 py-2.5 text-xs">{r.workDate ? formatDate(r.workDate) : "Unavailable"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{hours(r.payableHours)}</td>
                          <td className="px-4 py-2.5 text-right font-medium tabular-nums">{r.earningStatus === "CALCULATED" ? money(r.earnedAmount) : "Unavailable"}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{money(r.previouslyAllocatedAmount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{money(r.manualAdvanceAdjustedAmount ?? 0)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{money(r.remainingOutstandingAmount)}</td>
                          <td className="px-4 py-2.5"><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset", statusTone(r.paymentStatus))}>{statusLabel(r.paymentStatus)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "payments" && (
        <Card className="overflow-hidden">
          <SectionHead title="Payments & History" desc="Historical records preserved. New payments use coordinated server-authoritative processing." />
          {history.length === 0 ? (
            <div className="p-8"><EmptyState icon="receipt" title="No payment records" desc="Payments will appear here after allocation." /></div>
          ) : (
            <div className="divide-y divide-edge">
              {history.map((p) => {
                const s = staffById(p.staffId);
                return (
                  <div key={p.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                    <PhotoAvatar name={s?.fullName ?? p.staffId} photoUrl={s?.photoUrl} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-foreground">{s?.fullName ?? p.staffId}</p><StatusBadge status={p.status || "Paid"} /><Pill tone={p.sessionId ? "amber" : "blue"}>{p.sessionId ? "Legacy settlement" : "Allocation payment"}</Pill></div>
                      <p className="mt-0.5 text-xs text-faint-foreground">{formatDate(p.date)} · Paid {p.paidAt ? formatDateTime(p.paidAt) : formatDate(p.date)} · {p.periodLabel || "—"}{p.batchId ? " · Batch " + String(p.batchId).slice(0, 8) : ""}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <p className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatBDT(p.netPay)}</p>
                      <Button size="sm" variant="secondary" icon="receipt" onClick={() => navigate("payslip", { id: p.id })}>Receipt</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === "advances" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <InfoStrip title="Outstanding Advances" value={amountText(outstandingAdvMetric as any)} sub="Server/ledger-derived" icon="arrowLeft" tone="rose" />
            <InfoStrip title="Advance Logs (loaded)" value={String(advanceLogs.length)} sub={selectedStaffId ? `Filtered by ${selectedStaffId}` : "Current scope"} icon="file" tone="blue" />
            <InfoStrip title="Manual Adjustments (loaded)" value={String(advanceAdjustments.length)} sub="Append-only adjustment ledger" icon="sliders" tone="emerald" />
          </div>

          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Advance Actions (Manual, Explicit)</p>
                <p className="text-xs text-muted-foreground">Give advance and manual adjustment use existing server-authoritative APIs. Advances are never auto-deducted and never converted to earned salary. Adjustments require explicit confirmation and are idempotent/bounded by server rules.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={selectedStaffId || ""} onChange={(e) => setSelectedStaffId(e.target.value || null)} className="h-10 min-w-[220px] rounded-xl border border-edge bg-background px-3 text-sm text-foreground">
                  <option value="">Select staff (optional scope)</option>
                  {data.staff.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName} · {s.employeeId}</option>)}
                </select>
                <Button size="sm" variant="secondary" icon="plus" onClick={() => { const s = staffById(selectedStaffId || ""); if (!s) { toast("Select a staff account first.", "error"); return; } openGiveAdvance(s.employeeId, s.fullName); }} disabled={!selectedStaffId}>Give Advance</Button>
                <Button size="sm" variant="secondary" icon="sliders" onClick={() => { const s = staffById(selectedStaffId || ""); if (!s) { toast("Select a staff account first.", "error"); return; } openAdjustAdvance(s.employeeId, s.fullName); }} disabled={!selectedStaffId}>Adjust Advance</Button>
              </div>
            </div>
            {advanceState.loading && <p className="mt-3 text-xs text-muted-foreground">Loading advance state…</p>}
            {advanceState.error && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Advance detail: {advanceState.error}{advanceState.reason ? ` (${advanceState.reason})` : ""}</p>}
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <SectionHead title="Advances History" desc="Advance given/received records from existing advance state/summary." />
              {advanceLogs.length === 0 ? <div className="p-8"><EmptyState icon="wallet" title="No advance records" desc="Records will appear when advances are given or available in summary." /></div> : (
                <div className="max-h-[28rem] divide-y divide-edge overflow-auto">
                  {advanceLogs.map((l) => (
                    <div key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{l.staffName || l.staffId}</p><Pill tone={String(l.type).toUpperCase() === "GIVEN" ? "amber" : "blue"}>{l.type || "ADVANCE"}</Pill></div>
                        <p className="text-xs text-faint-foreground">{l.staffId} · {l.createdAt ? formatDateTime(l.createdAt) : "—"}{l.note ? ` · ${l.note}` : ""}{l.createdBy ? ` · by ${l.createdBy}` : ""}</p>
                      </div>
                      <div className="text-right"><p className="text-sm font-bold tabular-nums text-foreground">{money(l.amount)}</p><p className="text-[11px] text-faint-foreground">Balance after (snapshot): {l.balanceAfter != null ? money(l.balanceAfter as any) : "Unavailable"}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <SectionHead title="Adjustment History" desc="Manual, append-only advance adjustment ledger (explicit, idempotent, server-authoritative)." />
              {advanceAdjustments.length === 0 ? <div className="p-8"><EmptyState icon="sliders" title="No adjustment records" desc="Manual adjustments will appear here when recorded." /></div> : (
                <div className="max-h-[28rem] divide-y divide-edge overflow-auto">
                  {advanceAdjustments.map((a) => (
                    <div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{a.staffName || a.staffId}</p><Pill tone="emerald">Adjusted</Pill>{a.workDate && <Pill tone="slate">Work {formatDate(a.workDate)}</Pill>}</div>
                        <p className="text-xs text-faint-foreground">{a.staffId} · {a.adjustedAt ? formatDateTime(a.adjustedAt) : "—"}{a.adjustedBy ? ` · by ${a.adjustedBy}` : ""}{a.note ? ` · ${a.note}` : ""}</p>
                        <p className="text-[11px] text-faint-foreground">Advance: {a.advanceLogId} · Earning: {a.payrollEarningId}</p>
                      </div>
                      <div className="text-right"><p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(a.amount)}</p></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {payDialog && (() => {
        const preview = computeDeductionPreview(payDialog);
        const grossNum = parseAmountInput(payDialog.grossAmount);
        const partialNum = parseAmountInput(payDialog.deductionAmount);
        const canSubmit = !payDialog.loading && !payDialog.submitting && grossNum != null && grossNum > 0 && !preview.error && (!payDialog.deductAdvance || payDialog.deductionMode === "full" || (partialNum != null && partialNum > 0));
        return (
          <ModalShell title="Pay Salary" subtitle={`${payDialog.staffName} · ${payDialog.staffId}`} onClose={closePaymentDialog}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MiniStat label="Outstanding Earned (authoritative)" value={payDialog.loading ? "Loading…" : (payDialog.authoritativeOutstandingEarned != null ? formatBDT(payDialog.authoritativeOutstandingEarned) : "Unavailable")} />
                <MiniStat label="Outstanding Advance (authoritative)" value={payDialog.loading ? "Loading…" : (payDialog.authoritativeOutstandingAdvance != null ? formatBDT(payDialog.authoritativeOutstandingAdvance) : "Unavailable")} />
              </div>
              {payDialog.loadError && <Alert tone="amber">{payDialog.loadError}</Alert>}

              {!payDialog.result && (
                <div className="space-y-4">
                  <label className="block text-xs font-medium text-muted-foreground">Gross salary payment (BDT)
                    <Input type="text" inputMode="decimal" value={payDialog.grossAmount} onChange={(e) => setPayDialog((cur) => cur ? { ...cur, grossAmount: e.target.value, submitError: null } : cur)} placeholder="0.00" className="mt-1" />
                  </label>

                  <div className="rounded-xl border border-edge bg-surface-muted/20 p-3">
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={payDialog.deductAdvance} onChange={(e) => setPayDialog((cur) => cur ? { ...cur, deductAdvance: e.target.checked, submitError: null, deductionAmount: e.target.checked ? cur.deductionAmount : "" } : cur)} className="mt-0.5" />
                      <span><span className="font-medium">Deduct outstanding advance</span> <span className="text-muted-foreground">(optional, default off)</span></span>
                    </label>
                    {payDialog.deductAdvance && (
                      <div className="mt-3 space-y-3 border-t border-edge pt-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setPayDialog((cur) => cur ? { ...cur, deductionMode: "full", deductionAmount: "", submitError: null } : cur)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", payDialog.deductionMode === "full" ? "bg-primary-soft text-primary ring-primary/30" : "text-muted-foreground ring-edge hover:bg-surface-muted")}>Full outstanding</button>
                          <button type="button" onClick={() => setPayDialog((cur) => cur ? { ...cur, deductionMode: "partial", submitError: null } : cur)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", payDialog.deductionMode === "partial" ? "bg-primary-soft text-primary ring-primary/30" : "text-muted-foreground ring-edge hover:bg-surface-muted")}>Partial amount</button>
                        </div>
                        {payDialog.deductionMode === "partial" && (
                          <label className="block text-xs font-medium text-muted-foreground">Advance deduction amount (BDT)
                            <Input type="text" inputMode="decimal" value={payDialog.deductionAmount} onChange={(e) => setPayDialog((cur) => cur ? { ...cur, deductionAmount: e.target.value, submitError: null } : cur)} placeholder="0.00" className="mt-1" />
                          </label>
                        )}
                        <p className="text-[11px] text-faint-foreground">Server-validated against outstanding advance and eligible unpaid earnings. Processed in one transaction.</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-edge bg-surface p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Before confirmation (server-validated on submit)</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <MiniStat label="Gross salary payment" value={preview.gross != null && preview.gross > 0 ? formatBDT(preview.gross) : "—"} />
                      <MiniStat label="Advance deduction" value={preview.deduction != null ? formatBDT(preview.deduction) : "—"} />
                      <MiniStat label="Net cash payable" value={preview.net != null ? formatBDT(preview.net) : "—"} />
                      <MiniStat label="Remaining advance (est.)" value={(payDialog.deductAdvance && payDialog.authoritativeOutstandingAdvance != null && preview.deduction != null) ? formatBDT(payRound(Math.max(0, payDialog.authoritativeOutstandingAdvance - preview.deduction))) : (payDialog.authoritativeOutstandingAdvance != null ? formatBDT(payDialog.authoritativeOutstandingAdvance) : "Unavailable")} />
                      <MiniStat label="Remaining earned (est.)" value={(payDialog.authoritativeOutstandingEarned != null && preview.gross != null && preview.gross > 0) ? formatBDT(payRound(Math.max(0, payDialog.authoritativeOutstandingEarned - (preview.deduction ?? 0) - (preview.net ?? 0)))) : (payDialog.authoritativeOutstandingEarned != null ? formatBDT(payDialog.authoritativeOutstandingEarned) : "Unavailable")} />
                    </div>
                    <p className="mt-2 text-[11px] text-faint-foreground">Estimates use current balances; final values come from server response.</p>
                  </div>

                  {preview.error && <Alert tone="rose">{preview.error}</Alert>}
                  {payDialog.submitError && <Alert tone="rose">{payDialog.submitError}</Alert>}
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={closePaymentDialog} disabled={payDialog.submitting}>Cancel</Button>
                    <Button size="sm" variant="primary" icon="check" onClick={() => void submitPayment()} disabled={!canSubmit}>{payDialog.submitting ? "Processing…" : "Confirm Payment"}</Button>
                  </div>
                </div>
              )}

              {payDialog.result && (
                <div className="space-y-3">
                  <Alert tone={payDialog.result.ok ? "emerald" : "rose"}>
                    <p className="font-semibold">{payDialog.result.ok ? "Payment Result (server)" : "Payment Failed"}</p>
                    <p className="text-xs">{coordStatusLabel(payDialog.result.status)}{payDialog.result.reason ? ` · ${payDialog.result.reason}` : ""}{payDialog.result.error ? ` · ${payDialog.result.error}` : ""}</p>
                  </Alert>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <MiniStat label="Gross salary payment" value={formatBDT(payDialog.result.grossRequested)} />
                    <MiniStat label="Advance deduction" value={formatBDT(payDialog.result.deductionApplied)} />
                    <MiniStat label="Net cash payable/paid" value={formatBDT(payDialog.result.allocation?.actualAllocatedAmount ?? (payDialog.result.netCashRequested - (payDialog.result.allocation?.unfulfilledAmount ?? 0)))} />
                    <MiniStat label="Remaining advance" value={formatBDT(payDialog.result.remainingAdvance)} />
                    <MiniStat label="Remaining earned salary" value={formatBDT(payDialog.result.remainingEarned)} />
                    <MiniStat label="Payment ID" value={payDialog.result.paymentId || "None (adjustment-only)"} />
                  </div>
                  <div className="rounded-xl border border-edge bg-surface-muted/40 p-3 text-xs text-muted-foreground space-y-0.5">
                    <p>Duplicate replay: <span className="font-medium text-foreground">{payDialog.result.skippedDuplicate || payDialog.result.status === "REPLAY" ? "Yes" : "No"}</span></p>
                    <p>Adjustments: <span className="font-medium text-foreground">{payDialog.result.adjustments?.length ?? 0}</span></p>
                    <p>Cash allocations: <span className="font-medium text-foreground">{payDialog.result.allocation?.allocations?.length ?? 0}</span></p>
                    {!payDialog.result.paymentId && payDialog.result.deductionApplied > 0 && <p>Adjustment-only: no Payment/PaymentAllocation record created.</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {payDialog.result.ok && payDialog.result.paymentId && <Button size="sm" variant="secondary" icon="receipt" onClick={() => { const id = payDialog.result?.paymentId; closePaymentDialog(); if (id) navigate("payslip", { id }); }}>View Receipt</Button>}
                    {!payDialog.result.ok && <Button size="sm" variant="secondary" icon="refresh" onClick={() => void retryPaymentSameKey()} disabled={payDialog.submitting}>Retry (Same Key)</Button>}
                    <Button size="sm" variant="primary" onClick={closePaymentDialog}>Done</Button>
                  </div>
                </div>
              )}
            </div>
          </ModalShell>
        );
      })()}
      {giveDialog && (
        <ModalShell title="Give Advance" subtitle={`${giveDialog.staffName} · ${giveDialog.staffId}`} onClose={() => setGiveDialog(null)}>
          <div className="space-y-4">
            <Alert tone="blue">Advance is recorded separately from earned salary (server-authoritative). It is not auto-deducted and not converted to earnings. Idempotency key is attached to prevent duplicate creation on retry.</Alert>
            {!giveDialog.result ? (
              <>
                <label className="block text-xs font-medium text-muted-foreground">Amount (BDT ৳)<Input type="text" inputMode="decimal" value={giveDialog.amount} onChange={(e) => setGiveDialog((c) => c ? { ...c, amount: e.target.value, error: null } : c)} placeholder="0.00" className="mt-1" /></label>
                <label className="block text-xs font-medium text-muted-foreground">Note (optional)<Input type="text" value={giveDialog.note} onChange={(e) => setGiveDialog((c) => c ? { ...c, note: e.target.value } : c)} placeholder="Reason / reference" className="mt-1" /></label>
                <MiniStat label="Idempotency Key" value={giveDialog.idempotencyKey} />
                {giveDialog.error && <Alert tone="rose">{giveDialog.error}</Alert>}
                <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setGiveDialog(null)} disabled={giveDialog.submitting}>Cancel</Button><Button size="sm" variant="primary" icon="check" onClick={() => void submitGiveAdvance()} disabled={giveDialog.submitting}>{giveDialog.submitting ? "Saving…" : "Confirm & Give Advance"}</Button></div>
              </>
            ) : (
              <>
                <Alert tone="emerald"><p className="font-semibold">Advance Recorded</p><p className="text-xs">{giveDialog.result.skippedDuplicate || giveDialog.result.reason === "REPLAY" ? "Duplicate request safely replayed." : "New advance log created."}</p></Alert>
                <div className="grid grid-cols-2 gap-2"><MiniStat label="Amount" value={money(giveDialog.result.amount)} /><MiniStat label="Outstanding Advance" value={money(giveDialog.result.outstandingAdvance ?? giveDialog.result.balance)} /></div>
                <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => setGiveDialog(null)}>Done</Button></div>
              </>
            )}
          </div>
        </ModalShell>
      )}

      {adjustDialog && (
        <ModalShell title="Manual Advance Adjustment" subtitle={`${adjustDialog.staffName} · ${adjustDialog.staffId}`} onClose={() => setAdjustDialog(null)}>
          <div className="space-y-4">
            <Alert tone="blue">Manual adjustment only: reduces outstanding advance against a specific eligible accrued earning. Server enforces eligibility/bounds, idempotency, and concurrency safety. No automatic deduction.</Alert>
            {!adjustDialog.result ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-muted-foreground">Advance record
                    <select value={adjustDialog.advanceLogId} onChange={(e) => setAdjustDialog((c) => c ? { ...c, advanceLogId: e.target.value, error: null } : c)} className="mt-1 h-10 w-full rounded-xl border border-edge bg-background px-3 text-sm text-foreground">
                      <option value="">Select advance (GIVEN/outstanding)</option>
                      {(advanceState.logs.length ? advanceState.logs : (summary?.advances?.items || [])).filter((l:any)=>l.staffId===adjustDialog.staffId && String(l.type).toUpperCase()==="GIVEN").map((l:any) => <option key={l.id} value={l.id}>{formatBDT(l.amount)} · {l.createdAt ? formatDateTime(l.createdAt) : l.id}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">Eligible earning
                    <select value={adjustDialog.payrollEarningId} onChange={(e) => setAdjustDialog((c) => c ? { ...c, payrollEarningId: e.target.value, error: null } : c)} className="mt-1 h-10 w-full rounded-xl border border-edge bg-background px-3 text-sm text-foreground">
                      <option value="">Select eligible earning</option>
                      {(advanceState.eligibleEarnings || []).map((e:any) => <option key={e.id || e.payrollEarningId} value={e.id || e.payrollEarningId}>{(e.workDate ? formatDate(e.workDate) : (e.earningId || e.id || "Earning"))} · Remaining {money(e.remainingEligibleAmount ?? e.remainingOutstandingAmount ?? e.remainingAmount)}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-xs font-medium text-muted-foreground">Adjustment amount (BDT ৳)<Input type="text" inputMode="decimal" value={adjustDialog.amount} onChange={(e) => setAdjustDialog((c) => c ? { ...c, amount: e.target.value, error: null } : c)} placeholder="0.00" className="mt-1" /></label>
                <label className="block text-xs font-medium text-muted-foreground">Note (optional)<Input type="text" value={adjustDialog.note} onChange={(e) => setAdjustDialog((c) => c ? { ...c, note: e.target.value } : c)} placeholder="Reason / reference" className="mt-1" /></label>
                <MiniStat label="Idempotency Key" value={adjustDialog.idempotencyKey} />
                <label className="flex items-start gap-2 rounded-xl border border-edge bg-surface-muted/30 p-3 text-sm text-foreground"><input type="checkbox" checked={adjustDialog.confirmed} onChange={(e) => setAdjustDialog((c) => c ? { ...c, confirmed: e.target.checked, error: null } : c)} className="mt-0.5" /><span>I explicitly confirm this manual advance adjustment. I understand it is applied by server rules against the selected eligible earning and is not an automatic deduction.</span></label>
                {adjustDialog.error && <Alert tone="rose">{adjustDialog.error}</Alert>}
                <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setAdjustDialog(null)} disabled={adjustDialog.submitting}>Cancel</Button><Button size="sm" variant="primary" icon="check" onClick={() => void submitAdjustAdvance()} disabled={adjustDialog.submitting || !adjustDialog.confirmed}>{adjustDialog.submitting ? "Applying…" : "Confirm & Adjust"}</Button></div>
              </>
            ) : (
              <>
                <Alert tone="emerald"><p className="font-semibold">Adjustment Result</p><p className="text-xs">{adjustDialog.result.skippedDuplicate || adjustDialog.result.reason === "REPLAY" ? "Duplicate adjustment safely replayed." : "Manual adjustment recorded."}</p></Alert>
                <div className="grid grid-cols-2 gap-2"><MiniStat label="Adjusted Amount" value={money(adjustDialog.result.amount ?? adjustDialog.result.adjustedAmount)} /><MiniStat label="Outstanding Advance" value={money(adjustDialog.result.outstandingAdvance ?? adjustDialog.result.state?.outstandingAdvance)} /></div>
                <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => setAdjustDialog(null)}>Done</Button></div>
              </>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="border-b border-edge px-4 py-4 sm:px-5">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {desc && <p className="mt-1 text-xs leading-relaxed text-faint-foreground">{desc}</p>}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: "blue" | "emerald" | "amber" | "rose" }) {
  const iconCls = tone === "emerald" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : tone === "amber" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : tone === "rose" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-primary-soft text-primary";
  const barCls = tone === "emerald" ? "from-emerald-500/70 to-emerald-500/0" : tone === "amber" ? "from-amber-500/70 to-amber-500/0" : tone === "rose" ? "from-rose-500/70 to-rose-500/0" : "from-primary to-primary/0";
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r", barCls)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p>
          <p className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", iconCls)}><Icon name={icon} size={18} /></span>
      </div>
    </Card>
  );
}

function InfoStrip({ title, value, sub, icon, tone }: { title: string; value: string; sub: string; icon: any; tone: "blue" | "emerald" | "amber" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700 dark:text-emerald-300" : tone === "amber" ? "text-amber-700 dark:text-amber-300" : tone === "rose" ? "text-rose-700 dark:text-rose-300" : "text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3"><span className={cn("mt-0.5", cls)}><Icon name={icon} size={17} /></span><div><p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">{title}</p><p className="mt-0.5 text-base font-bold text-foreground">{value}</p><p className="text-xs text-muted-foreground">{sub}</p></div></div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-edge bg-surface-muted/30 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className="mt-1 break-all text-sm font-semibold text-foreground">{value}</p></div>;
}

function Alert({ tone, children }: { tone: "blue" | "emerald" | "amber" | "rose"; children: any }) {
  const cls = tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" : tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200";
  return <div className={cn("rounded-xl border px-3 py-2.5 text-sm", cls)}>{children}</div>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: any }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-edge bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3 sm:px-5">
          <div><p className="text-sm font-semibold text-foreground">{title}</p>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground" aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="max-h-[80vh] overflow-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
