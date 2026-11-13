import { useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Select, Input, Field, Textarea, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { HeroBand } from "../components/HeroBand";
import { StatusBadge } from "../components/StatusBadge";
import { Icon } from "../components/icons";
import { Modal, ConfirmDialog } from "../components/Modal";
import { formatDate, inclusiveCalendarDays } from "../lib/dates";
import { cn } from "../lib/utils";
import type { LeaveRequest, LeaveStatus, LeaveType } from "../types";

const TYPES: LeaveType[] = ["Annual", "Sick", "Casual", "Maternity", "Paternity", "Unpaid", "Earned"];
const FILTERS: { key: LeaveStatus | "All"; label: string }[] = [
  { key: "All", label: "All" }, { key: "Pending", label: "Pending" }, { key: "Approved", label: "Approved" }, { key: "Rejected", label: "Rejected" }, { key: "Cancelled", label: "Cancelled" },
];
type SortKey = "recent" | "from" | "days" | "staff";

export function Leave() {
  const { data, role, canPerm, decideLeave, cancelOwnLeave, session, leaveLoading, leaveError, staffById } = useApp();
  const canApprove = canPerm("manage.leave");
  const myId = role === "STAFF" ? session?.staffId : undefined;

  const [filter, setFilter] = useState<LeaveStatus | "All">("All");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LeaveType | "All">("All");
  const [sort, setSort] = useState<SortKey>("recent");
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; status: "Approved" | "Rejected" } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [cancelFor, setCancelFor] = useState<LeaveRequest | null>(null);
  const noteSubmitting = useRef(false);

  const scoped = useMemo(() => data.leaveRequests.filter((r) => (myId ? r.staffId === myId : true)), [data.leaveRequests, myId]);
  const leaveStats = useMemo(() => ({
    total: scoped.length,
    pending: scoped.filter((r) => r.status === "Pending").length,
    approved: scoped.filter((r) => r.status === "Approved").length,
    rejected: scoped.filter((r) => r.status === "Rejected").length,
  }), [scoped]);

  const requests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((r) => filter === "All" || r.status === filter)
      .filter((r) => typeFilter === "All" || r.leaveType === typeFilter)
      .filter((r) => {
        if (!q) return true;
        const s = staffById(r.staffId);
        return [s?.fullName, s?.employeeId, r.staffId, r.leaveType, r.reason, r.status, r.fromDate, r.toDate].some((v) => (v || "").toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sort === "from") return b.fromDate.localeCompare(a.fromDate);
        if (sort === "days") return b.days - a.days;
        if (sort === "staff") return (staffById(a.staffId)?.fullName || "").localeCompare(staffById(b.staffId)?.fullName || "");
        return (b.approvedAt ?? b.fromDate ?? b.recordId ?? "").localeCompare(a.approvedAt ?? a.fromDate ?? a.recordId ?? "");
      });
  }, [scoped, filter, typeFilter, query, sort, staffById]);

  return (
    <div className="space-y-5 animate-fade">
      <HeroBand
        eyebrow="Leave Management"
        title="Requests & Approvals"
        subtitle="Track leave requests, review balances, and approve or reject with clear audit-friendly feedback. Days use inclusive calendar days (server-authoritative)."
        icon="calendar"
        stats={[
          { label: "Pending", value: leaveStats.pending, icon: "clock" },
          { label: "Approved", value: leaveStats.approved, icon: "check" },
          { label: "Rejected", value: leaveStats.rejected, icon: "x" },
          { label: "Total", value: leaveStats.total, icon: "list" },
        ]}
        right={
          <button onClick={() => setModal(true)} className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary-deep to-primary-bright px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-primary/30 transition hover:from-primary hover:to-primary-bright">
            <Icon name="plus" size={16} /> New Request
          </button>
        }
      />

      {leaveError && <Card className="border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 ring-rose-200 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{leaveError}</Card>}
      {leaveLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" />Updating leave…</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"><Icon name="search" size={16} /></span>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search staff, type, reason, status…" className="pl-9" />
                </div>
                <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as LeaveType | "All")} className="sm:w-44">
                  <option value="All">All types</option>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sm:w-44">
                  <option value="recent">Sort: Recent</option>
                  <option value="from">Sort: From date</option>
                  <option value="days">Sort: Days</option>
                  {!myId && <option value="staff">Sort: Staff</option>}
                </Select>
              </div>
              <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", filter === f.key ? "bg-surface text-foreground shadow-sm ring-1 ring-edge" : "text-muted-foreground hover:text-foreground")}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:hidden">
            <MiniStat label="Pending" value={leaveStats.pending} tone="amber" />
            <MiniStat label="Approved" value={leaveStats.approved} tone="emerald" />
            <MiniStat label="Rejected" value={leaveStats.rejected} tone="rose" />
            <MiniStat label="Total" value={leaveStats.total} tone="primary" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{canApprove ? "Request History" : "My Requests"}</p>
              <span className="text-xs text-faint-foreground">{requests.length} shown</span>
            </div>
            {requests.length === 0 ? (
              <div className="p-10"><EmptyState icon="calendar" title="No leave requests" desc="Adjust filters or create a new request." action={<Button variant="secondary" icon="plus" onClick={() => setModal(true)}>New Request</Button>} /></div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge bg-surface-muted/50 text-left text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">
                        {!myId && <th className="px-4 py-2.5">Staff</th>}
                        <th className="px-4 py-2.5">Type</th>
                        <th className="px-4 py-2.5">Dates</th>
                        <th className="px-4 py-2.5 text-right">Days</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {requests.map((r) => {
                        const s = staffById(r.staffId);
                        return (
                          <tr key={r.recordId} className="hover:bg-surface-muted/40">
                            {!myId && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={32} />
                                  <div className="min-w-0"><p className="truncate font-medium text-foreground">{s?.fullName ?? r.staffId}</p><p className="text-xs text-faint-foreground">{r.staffId}</p></div>
                                </div>
                              </td>
                            )}
                            <td className="px-4 py-3"><span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground">{r.leaveType}</span></td>
                            <td className="px-4 py-3 text-muted-foreground"><span className="whitespace-nowrap">{formatDate(r.fromDate)} → {formatDate(r.toDate)}</span></td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{r.days}</td>
                            <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="ghost" icon="info" onClick={() => setSelected(r)}>Details</Button>
                                {canApprove && r.status === "Pending" && <>
                                  <Button size="sm" variant="success" icon="check" onClick={() => { setNoteFor({ id: r.recordId, status: "Approved" }); setNoteText(""); }}>Approve</Button>
                                  <Button size="sm" variant="secondary" icon="x" onClick={() => { setNoteFor({ id: r.recordId, status: "Rejected" }); setNoteText(""); }}>Reject</Button>
                                </>}
                                {!canApprove && myId && r.staffId === myId && r.status === "Pending" && (
                                  <Button size="sm" variant="secondary" icon="x" onClick={() => setCancelFor(r)}>Cancel</Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-edge md:hidden">
                  {requests.map((r) => {
                    const s = staffById(r.staffId);
                    return (
                      <button key={r.recordId} type="button" className="w-full p-4 text-left hover:bg-surface-muted/40" onClick={() => setSelected(r)}>
                        <div className="flex items-start gap-3">
                          <PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {!myId && <p className="font-semibold text-foreground">{s?.fullName ?? r.staffId}</p>}
                              <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{r.leaveType}</span>
                              <StatusBadge status={r.status} />
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{formatDate(r.fromDate)} → {formatDate(r.toDate)} · <span className="font-medium text-foreground">{r.days} day{r.days === 1 ? "" : "s"}</span></p>
                            {r.reason && <p className="mt-1 truncate text-xs text-faint-foreground">“{r.reason}â€</p>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary shadow-sm shadow-primary/20"><Icon name="calendar" size={18} /></span>
              <div><p className="text-sm font-semibold text-foreground">New Leave Request</p><p className="text-xs text-faint-foreground">Submit for approval</p></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Days are calculated as inclusive calendar days and saved by the authoritative leave API.</p>
            <Button className="mt-4 w-full" icon="plus" onClick={() => setModal(true)}>Create Request</Button>
          </Card>

          {canApprove && (
            <Card className="p-5">
              <p className="text-sm font-semibold text-foreground">Approval Workspace</p>
              <p className="mt-1 text-xs text-muted-foreground">Pending requests that need a decision.</p>
              <div className="mt-4 space-y-2">
                {scoped.filter((r) => r.status === "Pending").slice(0, 5).map((r) => {
                  const s = staffById(r.staffId);
                  return (
                    <button key={r.recordId} type="button" className="w-full rounded-xl border border-edge bg-surface-muted/40 p-3 text-left transition hover:bg-surface-muted" onClick={() => setSelected(r)}>
                      <div className="flex items-center gap-2"><PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={28} /><p className="truncate text-sm font-medium text-foreground">{s?.fullName ?? r.staffId}</p></div>
                      <p className="mt-1 text-xs text-muted-foreground">{r.leaveType} · {r.days} day{r.days === 1 ? "" : "s"}</p>
                    </button>
                  );
                })}
                {scoped.filter((r) => r.status === "Pending").length === 0 && <p className="text-sm text-faint-foreground">No pending approvals.</p>}
              </div>
            </Card>
          )}

          {myId && <MyBalances staffId={myId} />}
        </div>
      </div>

      {modal && <RequestModal onClose={() => setModal(false)} />}

      {selected && (
        <LeaveDetailsModal
          request={selected}
          staff={staffById(selected.staffId)}
          canApprove={canApprove}
          isOwnPending={!!myId && selected.staffId === myId && selected.status === "Pending"}
          onClose={() => setSelected(null)}
          onApprove={() => { setNoteFor({ id: selected.recordId, status: "Approved" }); setNoteText(""); setSelected(null); }}
          onReject={() => { setNoteFor({ id: selected.recordId, status: "Rejected" }); setNoteText(""); setSelected(null); }}
          onCancel={() => { setCancelFor(selected); setSelected(null); }}
        />
      )}

      {noteFor && (
        <Modal open onClose={() => setNoteFor(null)} size="md"
          title={noteFor.status === "Approved" ? "Approve Leave" : "Reject Leave"}
          subtitle="Add an optional reviewer note for the staff member" icon="calendar"
          footer={<>
            <Button variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button variant={noteFor.status === "Approved" ? "success" : "secondary"} icon={noteFor.status === "Approved" ? "check" : "x"} disabled={noteSubmitting.current || leaveLoading}
              onClick={async () => {
                if (noteSubmitting.current) return;
                noteSubmitting.current = true;
                await decideLeave(noteFor.id, noteFor.status, noteText.trim() || undefined);
                setNoteFor(null);
                noteSubmitting.current = false;
              }}>
              {noteFor.status === "Approved" ? "Approve" : "Reject"}
            </Button>
          </>}>
          <Field label="Reviewer Note / Feedback" hint="Visible to the staff member. Optional but recommended for rejections.">
            <Textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={noteFor.status === "Rejected" ? "Explain why this request was rejected…" : "Add a short note for the staff member…"} />
          </Field>
        </Modal>
      )}

      <ConfirmDialog
        open={!!cancelFor}
        onClose={() => setCancelFor(null)}
        onConfirm={() => { if (cancelFor) void cancelOwnLeave(cancelFor.recordId); setCancelFor(null); }}
        title="Cancel leave request?"
        message={cancelFor ? `${cancelFor.leaveType} leave (${formatDate(cancelFor.fromDate)} → ${formatDate(cancelFor.toDate)}) will be cancelled.` : ""}
        confirmLabel="Cancel Request"
        icon="x"
      />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "emerald" | "rose" | "primary" }) {
  const cls = tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-primary";
  return (
    <Card className="p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className={cn("mt-1 text-xl font-bold tabular-nums", cls)}>{value}</p></Card>
  );
}

function LeaveDetailsModal({ request, staff, canApprove, isOwnPending, onClose, onApprove, onReject, onCancel }: {
  request: LeaveRequest; staff: any; canApprove: boolean; isOwnPending: boolean; onClose: () => void; onApprove: () => void; onReject: () => void; onCancel: () => void;
}) {
  return (
    <Modal open onClose={onClose} size="lg" title="Leave Request Details" subtitle={staff?.fullName ?? request.staffId} icon="calendar"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {canApprove && request.status === "Pending" && <>
          <Button variant="secondary" icon="x" onClick={onReject}>Reject</Button>
          <Button variant="success" icon="check" onClick={onApprove}>Approve</Button>
        </>}
        {isOwnPending && <Button variant="secondary" icon="x" onClick={onCancel}>Cancel Request</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface-muted/40 p-4">
          <PhotoAvatar name={staff?.fullName ?? "?"} photoUrl={staff?.photoUrl} size={48} />
          <div className="min-w-0 flex-1"><p className="font-semibold text-foreground">{staff?.fullName ?? request.staffId}</p><p className="text-sm text-muted-foreground">{staff?.jobTitle || "Staff"} · {request.staffId}</p></div>
          <StatusBadge status={request.status} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Detail label="Type" value={request.leaveType} />
          <Detail label="Days" value={`${request.days} day${request.days === 1 ? "" : "s"}`} />
          <Detail label="From" value={formatDate(request.fromDate)} />
          <Detail label="To" value={formatDate(request.toDate)} />
        </div>
        <div className="rounded-xl border border-edge p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Reason</p>
          <p className="mt-1 text-sm text-foreground">{request.reason || "—"}</p>
        </div>
        {request.comment && (
          <div className="rounded-xl border border-edge bg-surface-muted/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Reviewer note</p>
            <p className="mt-1 text-sm text-foreground">{request.comment}</p>
          </div>
        )}
        <p className="text-xs text-faint-foreground">Days are inclusive calendar days and stored server-side.</p>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-edge bg-surface p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">{label}</p><p className="mt-1 text-sm font-semibold text-foreground">{value}</p></div>;
}

function MyBalances({ staffId }: { staffId: string }) {
  const { data } = useApp();
  const bal = data.leaveBalances.filter((b) => b.staffId === staffId);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-foreground">My Leave Balance</p><Icon name="calendar" size={16} className="text-faint-foreground" /></div>
      <div className="mt-4 space-y-4">
        {bal.length === 0 ? <p className="text-sm text-faint-foreground">No balances.</p> : bal.map((b) => {
          const rem = b.entitledDays - b.usedDays;
          const pct = b.entitledDays ? Math.min(100, (rem / b.entitledDays) * 100) : 0;
          return (
            <div key={b.leaveType}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.leaveType}</span>
                <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-emerald-600">{rem}</span> / {b.entitledDays}d left</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-emerald-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const { data, session, submitLeave, leaveLoading, staffById } = useApp();
  const [staffId, setStaffId] = useState(session?.staffId ?? data.staff[0]?.employeeId ?? "");
  const [leaveType, setLeaveType] = useState<LeaveType>("Annual");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const days = fromDate && toDate ? inclusiveCalendarDays(fromDate, toDate) : 0;
  const bal = data.leaveBalances.find((b) => b.staffId === staffId && b.leaveType === leaveType);
  const remaining = bal ? bal.entitledDays - bal.usedDays : 0;
  const staff = staffById(staffId);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const res = await submitLeave({ staffId, leaveType, fromDate, toDate, reason });
    if (!res.ok) { const m: Record<string, string> = {}; res.errors?.forEach((e) => (m[e.field] = e.message)); setErrors(m); }
    else onClose();
    setSubmitting(false);
  };

  return (
    <Modal open onClose={onClose} size="lg" title="New Leave Request" subtitle="Server-calculated inclusive calendar days" icon="calendar"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="send" onClick={() => void submit()} disabled={submitting || leaveLoading}>Submit Request</Button></>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-4">
          <Field label="Staff">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {data.staff.filter((s) => s.isActive).map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Leave Type" error={errors.leaveType}>
            <Select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="From" required error={errors.fromDate}><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
            <Field label="To" required error={errors.toDate || errors.dates}><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
          </div>
          <Field label="Reason" required error={errors.reason}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief reason for this leave request…" />
          </Field>
          {errors.global && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{errors.global}</p>}
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-edge bg-surface-muted/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Preview</p>
            <p className="mt-2 text-sm font-semibold text-foreground">{staff?.fullName || "Selected staff"}</p>
            <p className="text-xs text-muted-foreground">{leaveType} leave</p>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-edge">
              <span className="text-muted-foreground">Calendar days</span>
              <span className="font-bold tabular-nums text-foreground">{days}</span>
            </div>
            <p className="mt-2 text-xs text-faint-foreground">Inclusive of both dates. Final value is saved by `/api/leave`.</p>
          </div>
          {bal && (
            <div className="rounded-xl border border-edge p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint-foreground">Balance</p>
              <p className="mt-2 text-sm text-foreground"><span className="font-semibold text-emerald-600">{remaining}</span> day{remaining === 1 ? "" : "s"} remaining</p>
              <p className="text-xs text-faint-foreground">{leaveType} · {bal.usedDays}/{bal.entitledDays} used</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

