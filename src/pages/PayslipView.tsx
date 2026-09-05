import { useApp } from "../context/AppContext";
import { Card, Button, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { formatBDT, formatNumber } from "../lib/currency";
import { formatDate, formatDuration, formatLongDate, formatTime12 } from "../lib/dates";
import { configValue } from "../lib/config";

// ============================================================================
// Payslip — modern, print-optimised (A4). Pharmacy letterhead details are
// admin-editable in Settings (ORG_ADDRESS / PHONE / EMAIL / LICENSE).
// ============================================================================

export function PayslipView() {
  const { data, view, navigate, paymentFor } = useApp();
  const id = view.params?.id ?? "";
  const p = paymentFor(id);
  const staff = p ? data.staff.find((s) => s.employeeId === p.staffId) : undefined;
  const sess = p ? data.sessions.find((s) => s.id === p.sessionId) : undefined;

  if (!p || !staff) {
    return (
      <Card className="p-10">
        <EmptyState icon="receipt" title="Payslip not found" action={<Button onClick={() => navigate("payments")}>Back</Button>} />
      </Card>
    );
  }

  // Admin-editable letterhead details.
  const org = {
    name: configValue(data.config, "ORG_NAME", "Khan Pharmacy"),
    address: configValue(data.config, "ORG_ADDRESS", ""),
    phone: configValue(data.config, "ORG_PHONE", ""),
    email: configValue(data.config, "ORG_EMAIL", ""),
    license: configValue(data.config, "ORG_LICENSE", ""),
    footer: configValue(data.config, "PAYSPLIT_FOOTER", ""),
  };
  const over = p.overBreakDeduction;

  const earnings = [
    { label: `Duty Pay (${formatNumber(p.workedMin / 60, 1)} hrs)`, value: p.grossPay },
    ...(p.overtimeMin > 0 ? [{ label: `Overtime (${formatDuration(p.overtimeMin)} × 1.25)`, value: p.overtimePay }] : []),
  ];
  const deductions = [
    ...(over > 0 ? [{ label: `Over-break (${formatDuration(p.overBreakMin)})`, value: over }] : []),
  ];

  return (
    <div className="space-y-5 animate-fade">
      {/* Screen-only toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate("payments")} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <Icon name="chevronLeft" size={16} /> Payments
        </button>
        <Button variant="secondary" icon="print" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      {/* ============ PRINT DOCUMENT ============ */}
      <div className="pl-document mx-auto w-full max-w-3xl bg-white text-slate-900 shadow-xl">

        {/* Letterhead */}
        <header className="flex items-start justify-between gap-6 border-b-4 border-emerald-700 px-8 pb-5 pt-7">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white">
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
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Payslip</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{formatDate(p.date)}</p>
            <p className="mt-1 text-[10px] text-slate-500">{formatLongDate(p.date)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-400">{p.id}</p>
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
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Pay Period</p>
            <p className="text-sm font-bold">{p.periodLabel}</p>
            {sess && (
              <p className="mt-0.5 text-[10px] text-slate-500">
                {formatTime12(sess.timeIn)} → {sess.timeOut ? formatTime12(sess.timeOut) : "—"}
              </p>
            )}
          </div>
        </section>

        {/* Summary tiles — 2×2 on mobile, 4-across on desktop */}
        <section className="grid grid-cols-2 divide-slate-200 border-b border-slate-200 sm:grid-cols-4 sm:divide-x">
          <Tile label="Duty Hours" value={formatNumber(p.dutyHours, 1)} />
          <Tile label="Worked" value={formatDuration(p.workedMin)} />
          <Tile label="Break" value={formatDuration(p.breakMin)} />
          <Tile label="Rate / hr" value={`৳${formatNumber(p.hourlyRate, 2)}`} />
        </section>

        {/* Earnings & deductions — stack on mobile */}
        <section className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 sm:gap-8 sm:px-8">
          <div>
            <h2 className="mb-2 border-b border-emerald-200 pb-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">Earnings</h2>
            <table className="w-full text-sm">
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.label} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-600">{e.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{formatBDT(e.value)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-emerald-300">
                  <td className="py-2 font-bold text-slate-900">Gross Earnings</td>
                  <td className="py-2 text-right font-bold tabular-nums text-emerald-800">{formatBDT(p.grossPay + p.overtimePay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-2 border-b border-rose-200 pb-1 text-[11px] font-bold uppercase tracking-wider text-rose-700">Deductions</h2>
            <table className="w-full text-sm">
              <tbody>
                {deductions.length === 0 && (
                  <tr><td className="py-2 text-slate-400" colSpan={2}>No deductions</td></tr>
                )}
                {deductions.map((d) => (
                  <tr key={d.label} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-600">{d.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-rose-700">−{formatBDT(d.value)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-rose-300">
                  <td className="py-2 font-bold text-slate-900">Total Deductions</td>
                  <td className="py-2 text-right font-bold tabular-nums text-rose-700">−{formatBDT(over)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Net pay banner */}
        <section className="mx-8 mb-6 flex items-center justify-between rounded-xl bg-emerald-700 px-6 py-4 text-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100">Net Pay</p>
            <p className="text-[10px] text-emerald-200">Payable to {staff.fullName} · Paid by {p.paidBy}</p>
          </div>
          <p className="text-4xl font-extrabold tabular-nums tracking-tight">{formatBDT(p.netPay)}</p>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-200 px-8 py-4">
          <p className="text-[10px] leading-relaxed text-slate-500">
            {org.footer || "This is a computer-generated payslip and does not require a signature."}
            {" "}Paid meal (30m) and rest (15m) allowances are provided free; time beyond the 45-minute combined
            ceiling is deducted at the prorated basic rate. Time worked past the scheduled shift end is paid as
            overtime at 1.25× the basic rate.
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
