import { useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { formatBDT, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDateTime, formatDuration, formatLongDate, formatTime12 } from "../lib/dates";
import { configValue } from "../lib/config";
import { cn } from "../lib/utils";
import type { Payment } from "../types";

// Official supplied Khan Pharmacy logo. Prefer same-origin asset for reliable browser/print rendering;
// fall back to supplied Google Drive thumbnail if the local asset is unavailable.
const LOGO_SOURCES = [
  "/khan-pharmacy-logo-supplied.png",
  "https://drive.google.com/thumbnail?id=184zPptdHJ3lIu6cpvgNUb4XxmcgLmwci&sz=w512",
];

export function PayslipView() {
  const { data, view, navigate, paymentFor } = useApp();
  const id = view.params?.id ?? "";
  const p = paymentFor(id);
  const staff = p ? data.staff.find((s) => s.employeeId === p.staffId) : undefined;
  const [logoIndex, setLogoIndex] = useState(0);

  if (!p || !staff) {
    return (
      <Card className="p-10">
        <EmptyState icon="receipt" title="Payslip not found" desc="The requested payment record could not be found." action={<Button onClick={() => navigate("payments")}>Back to Payroll</Button>} />
      </Card>
    );
  }

  const rows: Payment[] = (p.batchId ? data.payments.filter((x) => x.batchId === p.batchId) : [p])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const primary = rows[0];
  const isMulti = rows.length > 1;
  const grossEarnedTotal = payRound(rows.reduce((s, r) => s + r.grossPay, 0));
  const overtimeTotal = payRound(rows.reduce((s, r) => s + r.overtimePay, 0));
  const grossWithOtTotal = payRound(rows.reduce((s, r) => s + r.grossPay + r.overtimePay, 0));
  const overBreakDedTotal = payRound(rows.reduce((s, r) => s + r.overBreakDeduction, 0));
  const advanceAdjTotal = payRound(rows.reduce((s, r) => s + (r.advanceAdjusted || 0), 0));
  const netTotal = payRound(rows.reduce((s, r) => s + r.netPay, 0));
  const workedTotal = rows.reduce((s, r) => s + r.workedMin, 0);
  const breakTotal = rows.reduce((s, r) => s + r.breakMin, 0);
  const overBreakMinTotal = rows.reduce((s, r) => s + r.overBreakMin, 0);
  const overtimeMinTotal = rows.reduce((s, r) => s + r.overtimeMin, 0);

  const org = {
    name: configValue(data.config, "ORG_NAME", "Khan Pharmacy"),
    address: configValue(data.config, "ORG_ADDRESS", ""),
    phone: configValue(data.config, "ORG_PHONE", ""),
    email: configValue(data.config, "ORG_EMAIL", ""),
    license: configValue(data.config, "ORG_LICENSE", ""),
    footer: configValue(data.config, "PAYSPLIT_FOOTER", ""),
  };

  const status = (primary.status || "Paid").toString();
  const isPaid = status.toLowerCase() === "paid";
  const logoSrc = logoIndex < LOGO_SOURCES.length ? LOGO_SOURCES[logoIndex] : null;

  return (
    <div className="space-y-4 animate-fade pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden pl-no-print">
        <button onClick={() => navigate("payments")} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground">
          <Icon name="chevronLeft" size={16} /> Back to Payroll
        </button>
        <Button variant="secondary" icon="print" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      <div className="mx-auto w-full max-w-[210mm]">
        <div className="pl-document rounded-lg border border-slate-200 bg-white text-slate-900 print:rounded-none print:border-slate-300 print:shadow-none">
          {/* Header */}
          <header className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={`${org.name} logo`}
                    width={56}
                    height={56}
                    className="block h-14 w-14 shrink-0 object-contain"
                    onError={() => setLogoIndex((i) => i + 1)}
                    referrerPolicy="no-referrer"
                    loading="eager"
                    decoding="async"
                  />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center border border-slate-200 text-sm font-semibold tracking-wide text-[#1d4ed8]" aria-label={org.name}>KP</span>
                )}
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight tracking-tight text-slate-900">{org.name}</p>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#1d4ed8]">Pharmacy &amp; Payroll</p>
                  {org.address && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">{org.address}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                    {org.phone && <span>Tel: {org.phone}</span>}
                    {org.email && <span>{org.email}</span>}
                    {org.license && <span>License: {org.license}</span>}
                  </div>
                </div>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{isMulti ? "Settlement Receipt" : "Payroll Slip"}</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Payslip</h1>
                <p className="mt-2 text-sm text-slate-700">Status: <span className={cn("font-medium", isPaid ? "text-slate-900" : "text-[#b91c1c]")}>{status}</span></p>
              </div>
            </div>
          </header>

          {/* Employee / Payment info */}
          <section className="grid grid-cols-1 gap-0 border-b border-slate-200 md:grid-cols-2">
            <div className="border-b border-slate-200 p-5 sm:p-6 md:border-b-0 md:border-r md:border-slate-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Employee</p>
              <div className="mt-3 flex items-start gap-3">
                <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={40} ring={false} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{staff.fullName}</p>
                  <p className="mt-0.5 text-xs text-slate-600">{staff.jobTitle || "—"}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <InfoRow label="Employee ID" value={staff.employeeId} />
                    <InfoRow label="Department" value={staff.department || "—"} />
                    {staff.section && <InfoRow label="Section" value={staff.section} />}
                    {staff.counter != null && <InfoRow label="Counter" value={String(staff.counter)} />}
                    {staff.phone && <InfoRow label="Phone" value={staff.phone} />}
                  </dl>
                </div>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Payment / Period</p>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                <InfoRow label="Pay period" value={isMulti ? `${rows.length} day(s) settlement` : (primary.periodLabel || formatDate(primary.date))} />
                <InfoRow label="Earning / work date(s)" value={isMulti ? `${formatDate(rows[0].date)} – ${formatDate(rows[rows.length - 1].date)}` : formatDate(primary.date)} />
                <InfoRow label="Paid at" value={primary.paidAt ? formatDateTime(primary.paidAt) : formatDate(primary.date)} />
                <InfoRow label="Issued" value={formatLongDate(primary.paidAt || primary.date)} />
                <div className="sm:col-span-2"><InfoRow label="Payment ID" value={primary.id} mono /></div>
                <InfoRow label="Paid by" value={primary.paidBy || "—"} />
                {primary.batchId && <div className="sm:col-span-2"><InfoRow label="Batch reference" value={primary.batchId} mono /></div>}
                {primary.sessionId && <div className="sm:col-span-2"><InfoRow label="Session reference" value={primary.sessionId} mono /></div>}
              </dl>
            </div>
          </section>

          {/* Key figures */}
          <section className="grid grid-cols-2 border-b border-slate-200 sm:grid-cols-4">
            <KeyFigure label="Duty hours" value={formatNumber(rows.reduce((s, r) => s + r.dutyHours, 0), 2)} />
            <KeyFigure label="Worked time" value={formatDuration(workedTotal)} />
            <KeyFigure label="Overtime" value={overtimeMinTotal > 0 ? formatDuration(overtimeMinTotal) : "—"} />
            <KeyFigure label="Net payable" value={formatBDT(netTotal)} emphasize />
          </section>

          {/* Day-wise coverage */}
          <section className="border-b border-slate-200 px-5 py-5 sm:px-8">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">{isMulti ? `Covered days (${rows.length})` : "Coverage / day detail"}</h2>
              <span className="text-[11px] text-slate-500">As recorded on payment</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-2 font-semibold">Date</th>
                    <th className="py-2 pr-2 font-semibold">Clock in–out</th>
                    <th className="py-2 pr-2 text-right font-semibold">Duty</th>
                    <th className="py-2 pr-2 text-right font-semibold">Worked</th>
                    <th className="py-2 pr-2 text-right font-semibold">Gross</th>
                    <th className="py-2 pr-2 text-right font-semibold">OT pay</th>
                    <th className="py-2 pr-2 text-right font-semibold">Deduction</th>
                    <th className="py-2 pr-2 text-right font-semibold">Advance adj.</th>
                    <th className="py-2 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const sess = data.sessions.find((s) => s.id === r.sessionId);
                    const ded = payRound(r.overBreakDeduction || 0);
                    const adv = payRound(r.advanceAdjusted || 0);
                    return (
                      <tr key={r.id} className="text-slate-700">
                        <td className="py-2 pr-2 font-medium text-slate-900">{formatDate(r.date)}</td>
                        <td className="py-2 pr-2 whitespace-nowrap text-slate-600">{sess ? `${formatTime12(sess.timeIn)} – ${sess.timeOut ? formatTime12(sess.timeOut) : "—"}` : (r.periodLabel || "—")}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatNumber(r.dutyHours, 2)} h</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatDuration(r.workedMin)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatBDT(r.grossPay, false)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{r.overtimePay > 0 ? formatBDT(r.overtimePay, false) : "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{ded > 0 ? `−${formatBDT(ded, false)}` : "—"}</td>
                        <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{adv > 0 ? `−${formatBDT(adv, false)}` : "—"}</td>
                        <td className="py-2 text-right font-medium tabular-nums text-slate-900">{formatBDT(r.netPay)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {isMulti && (
                  <tfoot>
                    <tr className="border-t border-slate-300 font-medium text-slate-900">
                      <td className="py-2 pr-2" colSpan={2}>Total</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatNumber(rows.reduce((s, r) => s + r.dutyHours, 0), 2)} h</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatDuration(workedTotal)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatBDT(grossEarnedTotal)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{overtimeTotal > 0 ? formatBDT(overtimeTotal, false) : "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{overBreakDedTotal > 0 ? `−${formatBDT(overBreakDedTotal, false)}` : "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{advanceAdjTotal > 0 ? `−${formatBDT(advanceAdjTotal, false)}` : "—"}</td>
                      <td className="py-2 text-right tabular-nums">{formatBDT(netTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* Earnings / deductions / net */}
          <section className="grid grid-cols-1 gap-0 border-b border-slate-200 lg:grid-cols-[1fr_1fr_0.9fr]">
            <div className="border-b border-slate-200 p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">Earnings</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Gross pay (earned)" value={formatBDT(grossEarnedTotal)} />
                <Row label="Approved overtime pay" value={overtimeTotal > 0 ? formatBDT(overtimeTotal) : "—"} />
                <div className="my-2 border-t border-slate-200" />
                <Row label="Gross + overtime" value={formatBDT(grossWithOtTotal)} strong />
              </dl>
              <div className="mt-3 space-y-0.5 text-[11px] text-slate-500">
                <p>Worked: {formatDuration(workedTotal)} · Break: {formatDuration(breakTotal)}</p>
                {overBreakMinTotal > 0 && <p>Over-break: {formatDuration(overBreakMinTotal)}</p>}
                {overtimeMinTotal > 0 && <p>Overtime (recorded): {overtimeMinTotal} min</p>}
                {primary.hourlyRate != null && <p>Hourly rate (recorded): {formatBDT(primary.hourlyRate, false)}</p>}
              </div>
            </div>
            <div className="border-b border-slate-200 p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">Deductions / adjustments</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Existing deductions" value={overBreakDedTotal > 0 ? `−${formatBDT(overBreakDedTotal)}` : "—"} />
                <Row label="Manual advance adjustment" value={advanceAdjTotal > 0 ? `−${formatBDT(advanceAdjTotal)}` : "—"} />
                <div className="my-2 border-t border-slate-200" />
                <Row label="Total deductions/adjustments" value={(overBreakDedTotal + advanceAdjTotal) > 0 ? `−${formatBDT(payRound(overBreakDedTotal + advanceAdjTotal))}` : "—"} strong />
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Only values recorded on this payment are shown.</p>
            </div>
            <div className="p-5 sm:p-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">Net payable</h2>
              <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{formatBDT(netTotal)}</p>
              <p className="mt-1 text-xs text-slate-600">Final amount {isMulti ? "(transaction total)" : ""}</p>
              <dl className="mt-4 space-y-1.5 text-xs">
                <InfoRow label="Status" value={status} />
                <InfoRow label="Paid by" value={primary.paidBy || "—"} />
                <InfoRow label="Payment date" value={primary.paidAt ? formatDateTime(primary.paidAt) : formatDate(primary.date)} />
                <div className="pt-1"><InfoRow label="Reference" value={primary.id} mono /></div>
                {primary.batchId && <InfoRow label="Batch" value={primary.batchId} mono />}
              </dl>
            </div>
          </section>

          {/* Footer */}
          <footer className="px-5 py-5 sm:px-8">
            <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-xs font-medium text-slate-700">{org.name}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  {org.footer || "This is a computer-generated payslip and does not require a signature."}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Values are taken from the existing payment record and available related data. Totals reflect this transaction as recorded.
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <div className="h-8 w-40 border-b border-slate-300 sm:ml-auto" />
                <p className="mt-1 text-[10px] text-slate-500">Authorised signature</p>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 text-slate-900", mono ? "break-all font-mono text-[11px] text-slate-700" : "text-xs")}>{value}</dd>
    </div>
  );
}

function KeyFigure({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="border-b border-r border-slate-200 p-4 last:border-r-0 sm:border-b-0 sm:[&:nth-child(2)]:border-r sm:[&:nth-child(4)]:border-r-0 [&:nth-child(2n)]:border-r sm:[&:nth-child(2n)]:border-r">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 text-base font-semibold tabular-nums sm:text-lg", emphasize ? "text-[#1d4ed8]" : "text-slate-900")}>{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={cn("text-slate-600", strong && "font-medium text-slate-800")}>{label}</dt>
      <dd className={cn("text-right tabular-nums text-slate-900", strong ? "font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}
