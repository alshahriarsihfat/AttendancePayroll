import { useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Select, Input, Field, Textarea, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { HeroBand } from "../components/HeroBand";
import { StatusBadge } from "../components/StatusBadge";
import { Icon } from "../components/icons";
import { Modal } from "../components/Modal";
import { formatDate, workingDaysBetween } from "../lib/dates";
import type { LeaveStatus, LeaveType } from "../types";

const TYPES: LeaveType[] = ["Annual", "Sick", "Casual", "Maternity", "Paternity", "Unpaid"];
const FILTERS: { key: LeaveStatus | "All"; label: string }[] = [
  { key: "All", label: "All" }, { key: "Pending", label: "Pending" }, { key: "Approved", label: "Approved" }, { key: "Rejected", label: "Rejected" },
];

export function Leave() {
  const { data, role, canPerm, decideLeave, session } = useApp();
  const canApprove = canPerm("manage.leave");
  const [filter, setFilter] = useState<LeaveStatus | "All">("All");
  const [modal, setModal] = useState(false);
  const [noteFor, setNoteFor] = useState<{ id: string; status: "Approved" | "Rejected" } | null>(null);
  const [noteText, setNoteText] = useState("");
  const noteSubmitting = useRef(false);

  const myId = role === "STAFF" ? session?.staffId : undefined;
  const leaveStats = useMemo(() => ({
    pending: data.leaveRequests.filter((r) => r.status === "Pending").length,
    approved: data.leaveRequests.filter((r) => r.status === "Approved").length,
    rejected: data.leaveRequests.filter((r) => r.status === "Rejected").length,
  }), [data.leaveRequests]);

  const requests = useMemo(() => {
    return data.leaveRequests
      .filter((r) => (myId ? r.staffId === myId : true))
      .filter((r) => filter === "All" || r.status === filter)
      .sort((a, b) => (b.approvedAt ?? b.recordId).localeCompare(a.approvedAt ?? a.recordId));
  }, [data.leaveRequests, filter, myId]);

  return (
    <div className="space-y-5 animate-fade">
      <HeroBand
        eyebrow="Leave Management"
        title="Leave Requests"
        subtitle="Approve, reject or track leave for every staff member, with balances always in view."
        icon="calendar"
        stats={[
          { label: "Pending", value: leaveStats.pending, icon: "clock" },
          { label: "Approved", value: leaveStats.approved, icon: "check" },
          { label: "Rejected", value: leaveStats.rejected, icon: "x" },
        ]}
        right={
          <button onClick={() => setModal(true)} className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary-deep to-primary-bright px-4 py-2 text-sm font-bold text-white shadow-md shadow-primary/30 transition hover:from-primary hover:to-primary-bright">
            <Icon name="plus" size={16} /> New Request
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-2">
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${filter === f.key ? "rounded-full bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-md shadow-primary/25" : "text-muted-foreground hover:bg-surface-muted"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </Card>

          {requests.length === 0 ? <Card className="p-10"><EmptyState icon="calendar" title="No leave requests" /></Card> : (
            <div className="space-y-3">
              {requests.map((r) => {
                const s = data.staff.find((x) => x.employeeId === r.staffId);
                return (
                  <Card key={r.recordId} className="p-4">
                    <div className="flex items-start gap-3">
                      <PhotoAvatar name={s?.fullName ?? "?"} photoUrl={s?.photoUrl} size={42} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">{s?.fullName}</p>
                          <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{r.leaveType}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{formatDate(r.fromDate)} → {formatDate(r.toDate)} · <span className="font-medium text-foreground">{r.days} day{r.days === 1 ? "" : "s"}</span></p>
                        {r.reason && <p className="mt-1 text-sm text-muted-foreground">“{r.reason}”</p>}
                        {r.comment && (
                          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                            <Icon name="info" size={13} className="mt-0.5 shrink-0 text-faint-foreground" />
                            <span><b>Reviewer note:</b> {r.comment}</span>
                          </p>
                        )}
                      </div>
                      {canApprove && r.status === "Pending" && (
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button size="sm" variant="success" icon="check" onClick={() => { setNoteFor({ id: r.recordId, status: "Approved" }); setNoteText(""); }}>Approve</Button>
                          <Button size="sm" variant="secondary" icon="x" onClick={() => { setNoteFor({ id: r.recordId, status: "Rejected" }); setNoteText(""); }}>Reject</Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary shadow-sm shadow-primary/20"><Icon name="calendar" size={18} /></span>
              <div><p className="text-sm font-semibold text-foreground">Request Leave</p><p className="text-xs text-faint-foreground">Submit for approval</p></div>
            </div>
            <Button className="mt-4 w-full" icon="plus" onClick={() => setModal(true)}>New Request</Button>
          </Card>

          {myId && <MyBalances staffId={myId} />}
        </div>
      </div>

      {modal && <RequestModal onClose={() => setModal(false)} />}

      {/* Reviewer note modal (optional feedback on approve/reject) */}
      {noteFor && (
        <Modal open onClose={() => setNoteFor(null)} size="md"
          title={noteFor.status === "Approved" ? "Approve Leave" : "Reject Leave"}
          subtitle="Add an optional reviewer note for the staff member" icon="calendar"
          footer={<>
            <Button variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button variant={noteFor.status === "Approved" ? "success" : "secondary"} icon={noteFor.status === "Approved" ? "check" : "x"} disabled={noteSubmitting.current}
              onClick={() => {
                if (noteSubmitting.current) return;
                noteSubmitting.current = true;
                decideLeave(noteFor.id, noteFor.status, noteText.trim() || undefined);
                setNoteFor(null);
                window.setTimeout(() => { noteSubmitting.current = false; }, 750);
              }}>
              {noteFor.status === "Approved" ? "Approve" : "Reject"}
            </Button>
          </>}>
          <Field label="Reviewer Note / Feedback" hint="Visible to the staff member on their dashboard.">
            <Textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Approved — please hand over pending tasks before leave." />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function MyBalances({ staffId }: { staffId: string }) {
  const { data } = useApp();
  const bal = data.leaveBalances.filter((b) => b.staffId === staffId);
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-foreground">My Leave Balance</p>
      <div className="mt-4 space-y-4">
        {bal.length === 0 ? <p className="text-sm text-faint-foreground">No balances.</p> : bal.map((b) => {
          const rem = b.entitledDays - b.usedDays;
          return (
            <div key={b.leaveType}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{b.leaveType}</span>
                <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-emerald-600">{rem}</span> / {b.entitledDays}d left</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-emerald-400" style={{ width: `${Math.min(100, (rem / b.entitledDays) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const { data, session, submitLeave } = useApp();
  const [staffId, setStaffId] = useState(session?.staffId ?? data.staff[0]?.employeeId ?? "");
  const [leaveType, setLeaveType] = useState<LeaveType>("Annual");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const days = fromDate && toDate ? workingDaysBetween(fromDate, toDate, data.holidays) : 0;
  const bal = data.leaveBalances.find((b) => b.staffId === staffId && b.leaveType === leaveType);
  const remaining = bal ? bal.entitledDays - bal.usedDays : 0;

  const submit = () => {
    const res = submitLeave({ staffId, leaveType, fromDate, toDate, reason });
    if (!res.ok) { const m: Record<string, string> = {}; res.errors?.forEach((e) => (m[e.field] = e.message)); setErrors(m); }
    else onClose();
  };

  return (
    <Modal open onClose={onClose} title="Request Leave" icon="calendar"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="send" onClick={submit}>Submit</Button></>}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required error={errors.fromDate}><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
          <Field label="To" required error={errors.toDate}><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
        </div>
        <Field label="Reason" required={leaveType === "Sick"} error={errors.reason}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief reason…" />
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-surface-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">Working days</span><span className="font-semibold tabular-nums text-foreground">{days} day{days === 1 ? "" : "s"}</span>
        </div>
        {bal && <p className="text-xs text-faint-foreground">{leaveType} balance: {remaining} day{remaining === 1 ? "" : "s"} remaining.</p>}
      </div>
    </Modal>
  );
}
