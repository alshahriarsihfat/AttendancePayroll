import { Card, Button } from "./ui";
import { Icon } from "./icons";
import { formatBDT, payRound } from "../lib/currency";
import { formatDate, formatDateTime } from "../lib/dates";
import type { AllocationReceiptContext } from "../lib/payroll-client-types";

export function AllocationReceiptView({ ctx, onBack, onClose }: { ctx: AllocationReceiptContext; onBack?: () => void; onClose?: () => void }) {
  const r = ctx.response;
  const isPartial = r.allocationStatus === "PARTIAL";
  const isReplay = r.allocationStatus === "REPLAY" || r.skippedDuplicate;
  const statusLabel = r.allocationStatus === "FULL" ? "সম্পূর্ণ পরিশোধ (Full)" : r.allocationStatus === "PARTIAL" ? "আংশিক পরিশোধ (Partial)" : r.allocationStatus === "REPLAY" ? "পুনরায় প্রদর্শিত (Replay)" : r.allocationStatus;
  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex gap-2">{onBack && <Button variant="ghost" icon="chevronLeft" onClick={onBack}>Back</Button>}</div>
        <div className="flex gap-2">
          <Button variant="secondary" icon="print" onClick={() => window.print()}>Print Receipt</Button>
          {onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl bg-white text-slate-900 shadow-xl print:shadow-none print:max-w-none" id="allocation-receipt-print">
        <header className="flex items-start justify-between gap-6 border-b-4 border-primary px-8 pb-5 pt-7">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Allocation Payment Receipt</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Salary Payment (Allocation)</h1>
            <p className="mt-1 text-sm text-slate-600">{ctx.staffName} · {ctx.staffId}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-slate-900">Receipt/Payment ID</p>
            <p className="font-mono text-xs text-slate-700 break-all">{r.paymentId ?? "—"}</p>
            <p className="mt-2 text-xs text-slate-500">Payment date/time</p>
            <p className="font-medium">{ctx.paidAt ? formatDateTime(ctx.paidAt) : "—"}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-0 border-b border-slate-200 sm:grid-cols-4">
          <Tile label="Requested" value={formatBDT(r.requestedAmount)} />
          <Tile label="Actual Paid" value={formatBDT(r.actualAllocatedAmount)} highlight />
          <Tile label="Unfulfilled" value={formatBDT(r.unfulfilledAmount)} warn={r.unfulfilledAmount > 0} />
          <Tile label="Remaining Outstanding" value={formatBDT(r.remainingOutstanding)} />
        </section>
        <section className="px-8 py-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${r.allocationStatus === "FULL" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : r.allocationStatus === "PARTIAL" ? "bg-amber-50 text-amber-700 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>{statusLabel}</span>
            {isReplay && <span className="text-xs text-slate-500">Same idempotency key — original result (no duplicate transaction).</span>}
          </div>
          {ctx.workDateLabel && <p className="text-sm text-slate-700"><span className="font-semibold">Work date/period:</span> {ctx.workDateLabel}</p>}
          {isPartial && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Partial allocation:</b> Requested {formatBDT(r.requestedAmount)}, actually paid {formatBDT(r.actualAllocatedAmount)}. Unfulfilled {formatBDT(r.unfulfilledAmount)} is <b>not</b> an advance and was not paid.</div>}
          {r.reason && <p className="text-xs text-slate-500">Server note: {r.reason}</p>}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Allocated earnings (oldest-first, server authoritative)</div>
            {r.allocations.length === 0 ? <p className="px-4 py-4 text-sm text-slate-500">No allocation rows.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400"><th className="px-4 py-2">Payroll Earning ID</th><th className="px-4 py-2">Allocation ID</th><th className="px-4 py-2 text-right">Allocated Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{r.allocations.map(a => (
                  <tr key={a.id}><td className="px-4 py-2 font-mono text-xs text-slate-700">{a.payrollEarningId}</td><td className="px-4 py-2 font-mono text-xs text-slate-500">{a.id}</td><td className="px-4 py-2 text-right font-semibold tabular-nums text-emerald-800">{formatBDT(a.amount)}</td></tr>
                ))}</tbody>
                <tfoot><tr className="border-t-2 border-slate-300"><td colSpan={2} className="px-4 py-2 font-bold">Total allocated</td><td className="px-4 py-2 text-right font-bold tabular-nums text-emerald-800">{formatBDT(payRound(r.allocations.reduce((s,a)=>s+a.amount,0)))}</td></tr></tfoot>
              </table>
            )}
          </div>
        </section>
        <footer className="border-t border-slate-200 px-8 py-4 text-[10px] leading-relaxed text-slate-500">
          Allocation receipt generated from server-authoritative payment allocation result. This is not a legacy session-bound payslip. Idempotency key: <span className="font-mono">{ctx.idempotencyKey}</span>
        </footer>
      </div>
      <style>{`@media print { body * { visibility: hidden !important; } #allocation-receipt-print, #allocation-receipt-print * { visibility: visible !important; } #allocation-receipt-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </div>
  );
}

function Tile({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="px-5 py-4 text-center border-r last:border-r-0 border-slate-200">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${highlight ? "text-emerald-700" : warn ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
