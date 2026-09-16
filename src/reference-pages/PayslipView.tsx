import { useApp } from "../context/AppContext";
import { Card, Button, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { formatBDT, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDateTime, formatDuration, formatLongDate, formatTime12 } from "../lib/dates";
import { configValue } from "../lib/config";
import type { Payment } from "../types";

// ============================================================================
// Payslip / Settlement Receipt â€” modern, print-optimised (A4). Pharmacy
// letterhead details are admin-editable in Settings (ORG_ADDRESS / PHONE /
// EMAIL / LICENSE).
//
// A single Payment row shows one day; a multi-day settlement (rows sharing a
// batchId) is itemized date-by-date with its own hours & money per day, then
// a batch total â€” exactly the days/hours covered by that one transaction.
// ============================================================================

export function PayslipView() {
  const { data, view, navigate, paymentFor } = useApp();
  const id = view.params?.id ?? "";
  const p = paymentFor(id);
  const staff = p ? data.staff.find((s) => s.employeeId === p.staffId) : undefined;

  if (!p || !staff) {
    return (
      <Card className="p-10">
        <EmptyState icon="receipt" title="Payslip not found" action={<Button onClick={() => navigate("payments")}>Back</Button>} />
      </Card>
    );
  }

  // ---- resolve this settlement's day-wise rows ----
  // If the Payment belongs to a batch, every row of that batch is included;
  // a legacy/pre-batch Payment renders on its own.
  const rows: Payment[] = (p.batchId
    ? data.payments.filter((x) => x.batchId === p.batchId)
    : [p])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const primary = rows[0];
  const grossTotal = payRound(rows.reduce((s, r) => s + r.grossPay + r.overtimePay, 0));
  const dedTotal = payRound(rows.reduce((s, r) => s + r.overBreakDeduction, 0));
  const netTotal = payRound(rows.reduce((s, r) => s + r.netPay, 0));
  const workedTotal = rows.reduce((s, r) => s + r.workedMin, 0);
  const isMulti = rows.length > 1;

  // Admin-editable letterhead details.
  const org = {
    name: configValue(data.config, "ORG_NAME", "Khan Pharmacy"),
    address: configValue(data.config, "ORG_ADDRESS", ""),
    phone: configValue(data.config, "ORG_PHONE", ""),
    email: configValue(data.config, "ORG_EMAIL", ""),
    license: configValue(data.config, "ORG_LICENSE", ""),
    footer: configValue(data.config, "PAYSPLIT_FOOTER", ""),
  };

  return (
    <div className="space-y-5 animate-fade">
      {/* Screen-only toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate("payments")} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <Icon name="chevronLeft" size={16} /> Payments
        </button>
        <Button variant="secondary" icon="print" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      {/* ============ PRINT DOCUMENT ============ */}
      <div className="pl-document mx-auto w-full max-w-3xl bg-white text-slate-900 shadow-xl">

        {/* Letterhead */}
        <header className="flex items-start justify-between gap-6 border-b-4 border-primary px-8 pb-5 pt-7">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
              <Icon name="pill" size={30} />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-slate-900">{org.name}</h1>
              {org.address && <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{org.address}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
                {org.phone && <span>Tel: {org.phone}</span>}
                {org.email && <span>{org.email}</span>}
                {org.license && <span>Lic: {org.license}</span>}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {isMulti ? "Settlement Receipt" : "Payslip"}
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{formatDateTime(primary.paidAt)}</p>
            <p className="mt-1 text-[10px] text-slate-500">Issued · {formatLongDate(primary.paidAt)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-400">
              {primary.id}{isMulti && primary.batchId ? ` · ${primary.batchId.slice(0, 8).toUpperCase()}` : ""}
            </p>
          </div>
        </header>
{/* Employee strip */}
        <section className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-8 py-4">
          <div className="flex items-center gap-3">
            <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={46} ring={false} />
            <div className="min-w-0">
              <p className="text-base font-bold leading-tight text-slate-900">{staff.fullName}</p>
              <p className="text-xs text-slate-600">{staff.jobTitle} · {staff.department}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                ID {staff.employeeId}
                {staff.counter ? ` · Counter ${staff.counter}` : ""}
                {staff.section ? ` · ${staff.section}` : ""}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {isMulti ? "Days Covered" : "Pay Period"}
            </p>
            <p className="text-sm font-bold">{isMulti ? `${rows.length} days` : primary.periodLabel}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {isMulti
                ? `${formatDate(rows[0].date)} → ${formatDate(rows[rows.length - 1].date)}`
                : (() => {
                    const sess = data.sessions.find((s) => s.id === primary.sessionId);
                    return sess ? `${formatTime12(sess.timeIn)} → ${sess.timeOut ? formatTime12(sess.timeOut) : "—"}` : "—";
                  })()}
            </p>
          </div>
        </section>

        {/* Summary tiles â€” 2Ã—2 on mobile, 4-across on desktop */}
        <section className="grid grid-cols-2 divide-slate-200 border-b border-slate-200 sm:grid-cols-4 sm:divide-x">
          <Tile label="Duty Hours" value={formatNumber(primary.dutyHours, 1)} />
          <Tile label="Worked" value={formatDuration(workedTotal)} />
          <Tile label="Break" value={formatDuration(rows.reduce((s, r) => s + r.breakMin, 0))} />
          <Tile label="Net Paid" value={formatBDT(netTotal, false)} />
        </section>

        {/* ============ DAY-WISE ITEMISED COVERAGE ============ */}
        <section className="px-8 pt-5">
          <h2 className="border-b border-primary/40 pb-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            {isMulti ? `Days Covered by This Transaction (${rows.length})` : "Day Covered"}
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2">Date</th>
                <th className="py-1.5 pr-2">Clock In → Out</th>
                <th className="py-1.5 pr-2 text-right">Worked</th>
                <th className="py-1.5 pr-2 text-right">Gross</th>
                <th className="py-1.5 pr-2 text-right">Ded.</th>
                <th className="py-1.5 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sess = data.sessions.find((s) => s.id === r.sessionId);
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 font-medium text-slate-900">{formatDate(r.date)}</td>
                    <td className="py-2 pr-2 whitespace-nowrap text-slate-600">
                      {sess ? `${formatTime12(sess.timeIn)} → ${sess.timeOut ? formatTime12(sess.timeOut) : "—"}` : r.periodLabel}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{formatDuration(r.workedMin)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{formatBDT(r.grossPay + r.overtimePay, false)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{r.overBreakDeduction > 0 ? `−${formatBDT(r.overBreakDeduction, false)}` : "—"}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-emerald-800">{formatBDT(r.netPay)}</td>
                  </tr>
                );
              })}
              {isMulti && (
                <tr className="border-t-2 border-primary/40">
                  <td className="py-2 pr-2 font-bold text-slate-900">Batch Total</td>
                  <td className="py-2 pr-2" />
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums text-slate-900">{formatDuration(workedTotal)}</td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums text-slate-900">{formatBDT(grossTotal)}</td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums text-slate-900">{dedTotal > 0 ? `−${formatBDT(dedTotal, false)}` : "—"}</td>
                  <td className="py-2 text-right font-bold tabular-nums text-emerald-800">{formatBDT(netTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
{/* Net pay banner */}
        <section className="mx-8 mb-6 mt-6 flex items-center justify-between rounded-xl bg-emerald-700 px-6 py-4 text-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100">
              {isMulti ? "Total Settled" : "Net Pay"}
            </p>
            <p className="text-[10px] text-emerald-200">
              Payable to {staff.fullName} · Paid by {primary.paidBy}
              {isMulti && primary.batchId ? ` · Ref ${primary.batchId.slice(0, 8).toUpperCase()}` : ""}
            </p>
          </div>
          <p className="text-4xl font-extrabold tabular-nums tracking-tight">{formatBDT(netTotal)}</p>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-200 px-8 py-4">
          <p className="text-[10px] leading-relaxed text-slate-500">
            {org.footer || "This is a computer-generated payslip and does not require a signature."}
            {" "}Paid meal (30m) and rest (15m) allowances are provided free; time beyond the 45-minute combined
            ceiling is deducted at the prorated basic rate. Time worked past the scheduled shift end is paid as
            overtime at 1.25× the basic rate. Each date above is a separate day-wise payment; the net total is the
            amount paid out in this single transaction.
          </p>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-[9px] text-slate-400">Generated by {org.name} Staff &amp; Pay System</p>
            <div className="text-center">
              <div className="h-8 w-40 border-b border-slate-300" />
              <p className="mt-1 text-[9px] text-slate-400">Authorised Signature</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 py-4 text-center">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}