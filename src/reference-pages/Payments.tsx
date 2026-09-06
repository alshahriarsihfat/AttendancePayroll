import { useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Select, Input, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { Modal } from "../components/Modal";
import { Field } from "../components/ui";
import { computeSession } from "../lib/timeclock";
import { formatBDT, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDuration } from "../lib/dates";
import type { Employee } from "../types";

type RangeKey = "all" | "7d" | "thisMonth";

// ============================================================================
// Payments — deliberately simple. Three sections only:
//   1. Quick Summary   2. Active Staff List   3. History Ledger
// Payouts are silent (no auto-print); slips are printed on demand.
// ============================================================================

export function Payments() {
  const { data, navigate, paySession, takeAdvance, canPerm, staffById } = useApp();
  const canPay = canPerm("pay.staff");

  const [range, setRange] = useState<RangeKey>("thisMonth");
  const [payFor, setPayFor] = useState<string | null>(null);   // sessionId
  const [advanceFor, setAdvanceFor] = useState<string | null>(null);
  const [advanceAmt, setAdvanceAmt] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const paymentLock = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  // ---- 1. Quick Summary (today only) ----
  const paidToday = useMemo(
    () => payRound(data.payments.filter((p) => (p.paidAt ?? p.date).slice(0, 10) === today).reduce((s, p) => s + p.netPay, 0)),
    [data.payments, today]
  );
  const dueToday = useMemo(() => {
    const paidIds = new Set(data.payments.map((p) => p.sessionId));
    return payRound(
      data.sessions
        .filter((s) => s.timeOut && !paidIds.has(s.id) && s.date === today)
        .reduce((sum, s) => {
          const st = data.staff.find((e) => e.employeeId === s.staffId);
          return st ? sum + computeSession(s, st, data.config, new Date(s.timeOut!).getTime()).netPay : sum;
        }, 0)
    );
  }, [data.sessions, data.payments, data.staff, data.config, today]);

  // ---- 2. Active Staff List (payable and advance-eligible) ----
  const payable = useMemo(() => {
    const paidIds = new Set(data.payments.map((p) => p.sessionId));
    return data.staff
      .filter((s) => s.isActive)
      .map((s) => {
        const sess = data.sessions.find((x) => x.staffId === s.employeeId && x.date === today);
        const isPaid = sess ? paidIds.has(sess.id) : false;
        const calc = sess ? computeSession(sess, s, data.config, new Date(sess.timeOut ?? Date.now()).getTime()) : null;
        return { staff: s, sess, calc, isPaid };
      })
      .sort((a, b) => Number(a.isPaid) - Number(b.isPaid));
  }, [data.staff, data.sessions, data.payments, data.config, today]);

  // ---- 3. History Ledger ----
  const ledger = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const minDate = range === "7d" ? weekStart : range === "thisMonth" ? monthStart : "0000-01-01";
    return data.payments
      .filter((p) => (p.paidAt ?? p.date).slice(0, 10) >= minDate)
      .sort((a, b) => (b.paidAt ?? b.date).localeCompare(a.paidAt ?? a.date));
  }, [data.payments, range]);

  return (
    <div className="space-y-5 animate-fade">

      {/* ============ 1. QUICK SUMMARY (stacks on mobile so ৳ never wraps) ============ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Paid Today</p>
          <p className="mt-1 truncate text-2xl font-bold tabular-nums text-emerald-600">{formatBDT(paidToday)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Pending Today</p>
          <p className="mt-1 truncate text-2xl font-bold tabular-nums text-amber-600">{formatBDT(dueToday)}</p>
        </Card>
      </div>

      {/* ============ 2. ACTIVE STAFF LIST ============ */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Today's Staff</p>
          <span className="text-xs text-slate-400">{payable.filter((row) => row.sess?.timeOut).length} clocked out</span>
        </div>

        {payable.length === 0 ? (
          <EmptyState icon="clock" title="No completed shifts yet" desc="Staff appear here once they clock out." />
        ) : (
          <div className="divide-y divide-slate-100">
            {payable.map(({ staff, sess, calc, isPaid }) => (
              <StaffRow
                key={staff.employeeId}
                staff={staff}
                workedMin={calc?.grossMin ?? 0}
                earned={calc?.netPay ?? 0}
                isPaid={isPaid}
                canPay={canPay}
                onPay={() => sess?.timeOut && setPayFor(sess.id)}
                onAdvance={() => { setAdvanceFor(staff.employeeId); setAdvanceAmt(""); }}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ============ 3. HISTORY LEDGER ============ */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">History</p>
          <Select className="w-auto text-sm" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
            <option value="all">All</option>
            <option value="7d">Last 7 Days</option>
            <option value="thisMonth">This Month</option>
          </Select>
        </div>

        {ledger.length === 0 ? (
          <EmptyState icon="receipt" title="No records" desc="Payments will appear here." />
        ) : (
          <div className="divide-y divide-slate-100">
            {ledger.map((p) => {
              const s = staffById(p.staffId);
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{s?.fullName ?? p.staffId}</p>
                    <p className="truncate text-xs text-slate-400">
                      {formatDate(p.paidAt ?? p.date)} · {p.periodLabel}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums text-emerald-600">{formatBDT(p.netPay)}</p>
                    <p className="text-[11px] text-slate-400">{formatDuration(p.workedMin)}</p>
                  </div>
                  {/* On-demand print — never automatic */}
                  <Button size="sm" variant="ghost" icon="receipt" className="shrink-0" onClick={() => navigate("payslip", { id: p.id })} title="View & Print">
                    <span className="hidden sm:inline">View &amp; Print</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ============ PAY MODAL (silent — no auto print) ============ */}
      {payFor && (() => {
        const st = staffById(payFor);
        const sess = data.sessions.find((x) => x.staffId === payFor && x.date === today);
        if (!st || !sess) return null;
        const calc = computeSession(sess, st, data.config, new Date(sess.timeOut ?? Date.now()).getTime());
        const advanceAdj = payRound(Math.min(st.advance ?? 0, calc.netPay));
        const finalPayable = payRound(calc.netPay - advanceAdj);
        return (
          <Modal open onClose={() => setPayFor(null)} size="md" title="Process Payment"
            subtitle={`${st.fullName} · ${st.employeeId}`} icon="handCoin"
            footer={<>
              <Button variant="ghost" onClick={() => setPayFor(null)}>Cancel</Button>
              <Button variant="success" icon="check" disabled={paymentSubmitting}
                onClick={() => {
                  if (paymentLock.current) return;
                  paymentLock.current = true;
                  setPaymentSubmitting(true);
                  paySession(sess.id);
                  setPayFor(null);
                  window.setTimeout(() => { paymentLock.current = false; setPaymentSubmitting(false); }, 750);
                }}>{paymentSubmitting ? "Processing..." : "Confirm Payment"}</Button>
            </>}>
            <div className="space-y-3">
              <Line label="Worked" value={formatDuration(calc.grossMin)} />
              <Line label="Gross Earnings" value={formatBDT(calc.grossPay)} />
              {calc.overBreakDeduction > 0 && <Line label="Over-break Deduction" value={`−${formatBDT(calc.overBreakDeduction)}`} />}
              {calc.overtimePay > 0 && <Line label="Overtime" value={`+${formatBDT(calc.overtimePay)}`} />}
              <Line label="Net Earned" value={formatBDT(calc.netPay)} />

              {/* Advance auto-adjustment */}
              {advanceAdj > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
                  <span className="font-medium text-amber-700">Advance Taken (অগ্রিম)</span>
                  <span className="font-bold tabular-nums text-amber-700">−{formatBDT(advanceAdj)}</span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl bg-emerald-700 px-4 py-3 text-white">
                <span className="text-sm font-semibold">Final Payable</span>
                <span className="text-2xl font-bold tabular-nums">{formatBDT(finalPayable)}</span>
              </div>
              {advanceAdj > 0 && (
                <p className="text-center text-xs text-slate-400">
                  Remaining advance balance after this payment: ৳{formatNumber(payRound((st.advance ?? 0) - advanceAdj), 2)}
                </p>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* ============ TAKE ADVANCE MODAL ============ */}
      {advanceFor && (
        <Modal open onClose={() => setAdvanceFor(null)} size="md" title="Give Advance (অগ্রিম)"
          subtitle={staffById(advanceFor)?.fullName} icon="handCoin"
          footer={<>
            <Button variant="ghost" onClick={() => setAdvanceFor(null)}>Cancel</Button>
            <Button variant="success" icon="check" disabled={!Number(advanceAmt)}
              onClick={() => { takeAdvance(advanceFor, Number(advanceAmt)); setAdvanceFor(null); }}>Log Advance</Button>
          </>}>
          <Field label="Advance Amount (৳)" hint="Automatically deducted from the next payout.">
            <Input type="number" value={advanceAmt} onChange={(e) => setAdvanceAmt(e.target.value)} placeholder="e.g. 500" />
          </Field>
          <p className="mt-3 text-center text-xs text-slate-400">
            Current outstanding advance: ৳{formatNumber(staffById(advanceFor)?.advance ?? 0, 2)}
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Responsive staff row: stacks vertically on mobile, row on ≥sm ---------- */
function StaffRow({ staff, workedMin, earned, isPaid, canPay, onPay, onAdvance }: {
  staff: Employee; workedMin: number; earned: number; isPaid: boolean;
  canPay: boolean; onPay: () => void; onAdvance: () => void;
}) {
  return (
    // Mobile: column stack (details on top, buttons full-width below).
    // Desktop: single row, vertically centred.
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
      {/* --- Profile details block --- */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{staff.fullName}</p>
            {isPaid && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">PAID</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex shrink-0 items-center gap-1"><Icon name="clock" size={12} />{formatDuration(workedMin)}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-emerald-600">{formatBDT(earned)}</span>
            {(staff.advance ?? 0) > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 text-amber-600">
                <Icon name="alert" size={12} />Advance: {formatBDT(staff.advance ?? 0, false)}
              </span>
            )}
            {(staff.arrears ?? 0) > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 text-rose-600">Due: {formatBDT(staff.arrears ?? 0, false)}</span>
            )}
          </div>
        </div>
      </div>

      {/* --- Action buttons: full-width row on mobile, auto-width on desktop --- */}
      {canPay && (
        <div className="flex w-full gap-2 sm:mt-0 sm:w-auto">
          <Button size="sm" variant="secondary" icon="handCoin" onClick={onAdvance} className="flex-1 sm:flex-none">Advance</Button>
          {!isPaid && workedMin > 0 && <Button size="sm" variant="success" icon="check" onClick={onPay} className="flex-1 sm:flex-none">Pay Now</Button>}
        </div>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-sm"><span className="text-slate-500">{label}</span><span className="font-semibold tabular-nums text-slate-900">{value}</span></div>;
}
