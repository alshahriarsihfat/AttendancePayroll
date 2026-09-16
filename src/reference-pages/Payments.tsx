import { useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Select, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { HeroBand } from "../components/HeroBand";
import { Icon } from "../components/icons";
import { Modal } from "../components/Modal";
import { Field, Input } from "../components/ui";
import { computeSession, dhakaTodayKey } from "../lib/timeclock";
import { formatBDT, formatNumber, payRound } from "../lib/currency";
import { formatDate, formatDuration, formatTime12, addDays, isoDate, monthKey, parseISO } from "../lib/dates";
import { configValue } from "../lib/config";
import { cn } from "../lib/utils";
import type { Employee, TimeSession } from "../types";

type RangeKey = "today" | "yesterday" | "7d" | "thisMonth" | "all" | "custom";

// ============================================================================
// Payments â€” strictly DAY-WISE & CLOCK-OUT dependent.
//   1. Quick Summary        2. Outstanding Dues (per day / per staff)
//   3. Settlement (one day â†’ one payout; several days â†’ one transaction)
//   4. History Ledger (grouped by settlement batch)
// Payouts are silent (no auto-print); slips/receipts are printed on demand.
// ============================================================================

export function Payments() {
  const { data, navigate, paySessions, takeAdvance, canPerm, staffById, todaySession, isOnLeaveToday } = useApp();
  const canPay = canPerm("pay.staff");

  const [range, setRange] = useState<RangeKey>("thisMonth");
  const [payFrom, setPayFrom] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payForStaff, setPayForStaff] = useState<string | null>(null);
  const [advanceFor, setAdvanceFor] = useState<string | null>(null);
  const [advanceAmt, setAdvanceAmt] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const paymentLock = useRef(false);

  // Settlement-modal selection — declared unconditionally at the top so the
  // hook order stays stable whether or not the modal is open (Rules of Hooks).
  // Reset to the staff's full day list every time the modal opens.
  const [selIds, setSelIds] = useState<string[]>([]);
  const [selAll, setSelAll] = useState(true);

  const todayKey = dhakaTodayKey();
  const yesterdayKey = isoDate(addDays(parseISO(todayKey), -1));
  const weekAgoKey = isoDate(addDays(parseISO(todayKey), -6));
  const monthPrefix = monthKey(parseISO(todayKey));

  // ---- 1. Quick Summary ----
  const paidToday = useMemo(
    () => payRound(data.payments.filter((p) => p.date === todayKey).reduce((s, p) => s + p.netPay, 0)),
    [data.payments, todayKey]
  );

  // ---- Day-wise outstanding dues ----
  // A shift becomes payable (a real due) ONLY after the staff member clocks
  // out. Unpaid previous days keep rolling as pending dues until settled.
  const paidIds = new Set(data.payments.map((p) => p.sessionId));
  const dueRows = useMemo(() => {
    return data.sessions
      .filter((s): s is TimeSession & { timeOut: string } => Boolean(s.timeOut) && !paidIds.has(s.id))
      .map((s) => {
        const st = data.staff.find((e) => e.employeeId === s.staffId);
        if (!st) return null;
        const calc = computeSession(s, st, data.config, new Date(s.timeOut).getTime());
        if (calc.grossMin <= 0) return null;
        return { session: s, staff: st, calc };
      })
      .filter((x): x is { session: TimeSession & { timeOut: string }; staff: Employee; calc: ReturnType<typeof computeSession> } => x !== null)
      .sort((a, b) => b.session.date.localeCompare(a.session.date));
  }, [data.sessions, data.staff, data.config]);

  const dueTotal = useMemo(() => payRound(dueRows.reduce((s, d) => s + d.calc.netPay, 0)), [dueRows]);

  // ---- Group dues per staff (for day-wise / multi-day settlement) ----
  const dueByStaff = useMemo(() => {
    const map = new Map<string, typeof dueRows>();
    for (const row of dueRows) {
      const arr = map.get(row.staff.employeeId) ?? [];
      arr.push(row);
      map.set(row.staff.employeeId, arr);
    }
    return Array.from(map.entries())
      .map(([staffId, rows]) => ({ staff: rows[0].staff, rows: rows.slice().sort((a, b) => a.session.date.localeCompare(b.session.date)) }))
      .sort((a, b) => {
        const aOpen = a.rows.some((r) => !r.session.completed && !r.session.timeOut);
        const bOpen = b.rows.some((r) => !r.session.completed && !r.session.timeOut);
        return Number(Boolean(aOpen)) - Number(Boolean(bOpen));
      });
  }, [dueRows]);

  const onDutyCount = data.sessions.filter((s) => s.date === todayKey && !s.timeOut).length;

  // ---- Every active staff member for GIVING AN ADVANCE (any time) ----
  // Unlike settlement, advances are NOT clock-out locked: a supervisor can give
  // one while the member is on duty, on break, before clocking out, or after.
  const advanceStaffRows = useMemo(() => {
    return data.staff
      .filter((s) => s.isActive)
      .map((s) => {
        const sess = todaySession(s.employeeId);
        const status: "on" | "done" | "off" | "leave" = isOnLeaveToday(s.employeeId)
          ? "leave"
          : sess?.timeOut ? "done"
          : sess ? "on"
          : "off";
        return { staff: s, status };
      })
      .sort((a, b) => {
        const order = { on: 0, leave: 1, done: 2, off: 3 } as const;
        return order[a.status] - order[b.status] || a.staff.fullName.localeCompare(b.staff.fullName);
      });
  }, [data.staff, todaySession, isOnLeaveToday]);

  // ---- 3. History Ledger ----
  const ledger = useMemo(() => {
    const matches = (d: string) => {
      if (range === "all") return true;
      if (range === "today") return d === todayKey;
      if (range === "yesterday") return d === yesterdayKey;
      if (range === "7d") return d >= weekAgoKey && d <= todayKey;
      if (range === "thisMonth") return d.startsWith(monthPrefix);
      return (!payFrom || d >= payFrom) && (!payTo || d <= payTo);
    };
    return data.payments.filter((p) => matches(p.date)).slice().sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }, [data.payments, range, payFrom, payTo, todayKey, yesterdayKey, weekAgoKey, monthPrefix]);

  // Batch entries: group by (staffId + batchId if present).
  const historyBatches = useMemo(() => {
    const groups = new Map<string, typeof ledger>();
    for (const p of ledger) {
      if (!canPay && p.staffId && !(data.staff.find((s) => s.employeeId === p.staffId)?.isActive)) continue;
      const key = p.batchId ? `${p.batchId}` : `${p.staffId}|${p.paidAt}|${p.id}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .map(([key, rows]) => ({
        key,
        paidAt: rows[0].paidAt,
        netTotal: payRound(rows.reduce((s, p) => s + p.netPay, 0)),
        rows: rows.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }, [ledger, data.staff, canPay]);
return (
    <div className="space-y-5 animate-fade">

      {/* ============ 0. OVERVIEW HERO ============ */}
      <HeroBand
        eyebrow="Pay & Advance"
        title="Pay"
        subtitle="Settle staff pay day-by-day (a single payout covers one day), or accumulate several unpaid days and settle them together in one transaction. Advances can be given to any staff at any time — even while on duty or before clocking out."
        icon="handCoin"
        stats={[
          { label: "Paid Today", value: formatBDT(paidToday), icon: "check" },
          { label: "Pending Dues", value: formatBDT(dueTotal), icon: "clock" },
          { label: "Unpaid Days", value: dueRows.length, icon: "receipt" },
        ]}
        right={
          <div className="flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Settlement: clock-out locked
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Advance: any time
            </span>
          </div>
        }
      />

      {/* ============ 2. OUTSTANDING DUES (day-wise) ============ */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Outstanding Dues</p>
          <span className="text-xs text-faint-foreground">
            {dueByStaff.length} staff · {dueRows.length} day{dueRows.length === 1 ? "" : "s"}
            {onDutyCount > 0 && <span className="ml-2 text-amber-600">· {onDutyCount} on duty (locked)</span>}
          </span>
        </div>

        {dueByStaff.length === 0 ? (
          <EmptyState icon="clock" title="No pending dues" desc="Days accrue here once the staff member clocks out, and stay until paid." />
        ) : (
          <div className="divide-y divide-edge">
            {dueByStaff.map(({ staff, rows }) => {
              const totalDue = payRound(rows.reduce((s, r) => s + r.calc.netPay, 0));
              return (
                <div key={staff.employeeId} className="px-4 py-3.5">
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{staff.fullName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {rows.length} unpaid day{rows.length === 1 ? "" : "s"} · {formatDuration(rows.reduce((s, r) => s + r.calc.grossMin, 0))}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums text-amber-600">{formatBDT(totalDue)}</p>
                      </div>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button size="sm" variant="secondary" icon="handCoin" onClick={() => { setAdvanceFor(staff.employeeId); setAdvanceAmt(""); }}>
                        Advance
                      </Button>
                      {canPay && (
                        <Button size="sm" variant="success" icon="check" className="flex-1 sm:flex-none"
                          onClick={() => {
                            setSelIds(rows.map((r) => r.session.id));
                            setSelAll(true);
                            setPayForStaff(staff.employeeId);
                          }}>
                          Settle
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Per-day breakdown â€” the accumulated pending due list */}
                  <div className="mt-3 overflow-hidden rounded-lg border border-edge">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-edge">
                        {rows.map(({ session, calc }) => (
                          <tr key={session.id} className="hover:bg-surface-muted/50">
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-faint-foreground">{formatDate(session.date)}</td>
                            <td className="px-3 py-2 text-xs text-faint-foreground">
                              {formatTime12(session.timeIn)} → {session.timeOut ? formatTime12(session.timeOut) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-muted-foreground">{formatDuration(calc.grossMin)}</td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatBDT(calc.netPay, false)}</td>
                            {canPay && (
                              <td className="px-3 py-2 text-right">
                                <button type="button" onClick={() => {
                                  setSelIds(rows.map((r) => r.session.id));
                                  setSelAll(true);
                                  setPayForStaff(staff.employeeId);
                                }} className="text-xs font-semibold text-primary hover:underline">
                                  Pay
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
{/* ============ 2b. GIVE ADVANCE — ANY TIME (not clock-out locked) ============ */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Give Advance · All Active Staff</p>
          <span className="text-xs font-medium text-emerald-600">Available any time — on duty, on break, before clock-out, or after</span>
        </div>
        {advanceStaffRows.length === 0 ? (
          <EmptyState icon="users2" title="No active staff" desc="Add staff in Staff Management to give advances." />
        ) : (
          <div className="divide-y divide-edge">
            {advanceStaffRows.map(({ staff, status }) => {
              const advance = staff.advance ?? 0;
              const pill =
                status === "leave" ? { label: "On leave", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
                : status === "on" ? { label: "On duty", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
                : status === "done" ? { label: "Clocked out", cls: "bg-surface-muted text-muted-foreground ring-edge" }
                : { label: "Off", cls: "bg-surface-muted text-faint-foreground ring-edge" };
              return (
                <div key={staff.employeeId} className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{staff.fullName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {staff.employeeId} · {staff.jobTitle}
                      </p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset", pill.cls)}>
                      {pill.label}
                    </span>
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">Outstanding advance</p>
                      <p className="text-sm font-bold tabular-nums text-amber-600">{formatBDT(advance)}</p>
                    </div>
                    <Button size="sm" variant="secondary" icon="handCoin" className="shrink-0"
                      onClick={() => { setAdvanceFor(staff.employeeId); setAdvanceAmt(""); }}>
                      Advance
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
{/* ============ 3. HISTORY LEDGER (grouped by settlement) ============ */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">History</p>
            <p className="mt-0.5 text-[11px] text-faint-foreground">Each row shows the shift day the payment covers.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {range === "custom" && (
              <>
                <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="h-9 rounded-lg border border-edge bg-surface px-2 text-sm" />
                <span className="text-xs text-faint-foreground">to</span>
                <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} className="h-9 rounded-lg border border-edge bg-surface px-2 text-sm" />
              </>
            )}
            <Select className="w-auto text-sm" value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 Days</option>
              <option value="thisMonth">This Month</option>
              <option value="all">All</option>
              <option value="custom">Custom…</option>
            </Select>
          </div>
        </div>

        {historyBatches.length === 0 ? (
          <EmptyState icon="receipt" title="No records" desc="Payments will appear here." />
        ) : (
          <div className="divide-y divide-edge">
            {historyBatches.map((batch) => {
              const p0 = batch.rows[0];
              const s = staffById(p0.staffId);
              const isBatch = batch.rows.length > 1 || Boolean(p0.batchId);
              return (
                <div key={batch.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{s?.fullName ?? p0.staffId}</p>
                    <p className="truncate text-xs text-faint-foreground">
                      {p0.sessionId === "" || p0.id.startsWith("ADV")
                        ? `Advance · ${formatDate(p0.date)}`
                        : isBatch
                          ? `Shift days · ${batch.rows.map((p) => formatDate(p.date)).join(", ")} · ${batch.rows.length} days`
                          : `Shift day · ${formatDate(p0.date)}`}
                      {isBatch && <span className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-bold text-faint-foreground">BATCH</span>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums text-emerald-600">{formatBDT(batch.netTotal)}</p>
                    <p className="text-[11px] text-faint-foreground">{formatDuration(batch.rows.reduce((s, p) => s + p.workedMin, 0))}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon="receipt" className="shrink-0"
                    onClick={() => navigate("payslip", { id: batch.rows[0].id })} title="View & Print">
                    <span className="hidden sm:inline">View &amp; Print</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
{/* ============ SETTLEMENT MODAL ============ */}
      {payForStaff && (() => {
        const grp = dueByStaff.find((g) => g.staff.employeeId === payForStaff);
        if (!grp) return null;
        const allIds = grp.rows.map((r) => r.session.id);
        const totOf = (ids: string[]) => payRound(ids.reduce((s, id) => s + (grp.rows.find((r) => r.session.id === id)?.calc.netPay ?? 0), 0));
        return (
          <Modal open onClose={() => setPayForStaff(null)} size="md" title="Settle Payment"
            subtitle={`${grp.staff.fullName} · ${grp.staff.employeeId}`} icon="handCoin"
            footer={<>
              <Button variant="ghost" onClick={() => setPayForStaff(null)}>Cancel</Button>
              <Button variant="success" icon="check" disabled={paymentSubmitting || selIds.length === 0}
                onClick={() => {
                  if (paymentLock.current) return;
                  paymentLock.current = true;
                  setPaymentSubmitting(true);
                  paySessions(selIds);
                  setPayForStaff(null);
                  window.setTimeout(() => { paymentLock.current = false; setPaymentSubmitting(false); }, 750);
                }}>{paymentSubmitting ? "Processing..." : `Confirm ${selIds.length} day${selIds.length === 1 ? "" : "s"}`}</Button>
            </>}>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-edge" checked={selAll}
                  onChange={(e) => { setSelAll(e.target.checked); setSelIds(e.target.checked ? allIds : []); }} />
                Select all days
              </label>

              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-edge p-2">
                {grp.rows.map(({ session, calc }) => {
                  const checked = selIds.includes(session.id);
                  return (
                    <label key={session.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${checked ? "bg-surface-muted" : "hover:bg-surface-muted/50"}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-edge" checked={checked}
                          onChange={(e) => {
                            setSelIds((prev) => {
                              const next = e.target.checked ? [...prev, session.id] : prev.filter((id) => id !== session.id);
                              setSelAll(next.length === allIds.length);
                              return next;
                            });
                          }} />
                        <span className="truncate font-medium text-foreground">{formatDate(session.date)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-faint-foreground">{formatDuration(calc.grossMin)}</span>
                        <span className="w-24 text-right font-semibold tabular-nums text-foreground">{formatBDT(calc.netPay, false)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-emerald-700 px-4 py-3 text-white">
                <span className="text-sm font-semibold">Total for {selIds.length} day{selIds.length === 1 ? "" : "s"}</span>
                <span className="text-2xl font-bold tabular-nums">{formatBDT(totOf(selIds))}</span>
              </div>
            </div>
          </Modal>
        );
      })()}
{/* ============ TAKE ADVANCE MODAL ============ */}
      {advanceFor && (
        <Modal open onClose={() => setAdvanceFor(null)} size="md" title="Give Advance"
          subtitle={staffById(advanceFor)?.fullName} icon="handCoin"
          footer={<>
            <Button variant="ghost" onClick={() => setAdvanceFor(null)}>Cancel</Button>
            <Button variant="success" icon="check" disabled={!Number(advanceAmt)}
              onClick={() => { takeAdvance(advanceFor, Number(advanceAmt)); setAdvanceFor(null); }}>Log Advance</Button>
          </>}>
          <Field label="Advance Amount (৳)" hint="Automatically deducted from the next payout.">
            <Input type="number" value={advanceAmt} onChange={(e) => setAdvanceAmt(e.target.value)} placeholder="e.g. 500" />
          </Field>
          <p className="mt-3 text-center text-xs text-faint-foreground">
            Current outstanding advance: ৳{formatNumber(staffById(advanceFor)?.advance ?? 0, 2)}
          </p>
        </Modal>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className="font-semibold tabular-nums text-foreground">{value}</span></div>;
}
