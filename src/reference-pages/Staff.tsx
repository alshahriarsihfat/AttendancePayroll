// ============================================================================
// Staff Management — modern card grid.
// Every staff member renders as a premium profile card with quick actions:
//   · View  → StaffDetailModal (attendance, payments & leave history)
//   · Edit  → StaffFormModal
//   · Clock → full ClockTerminal for that staff member
//   · Deactivate → soft delete (excluded from payroll)
// ============================================================================
import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Input, Select, IconButton, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { StaffFormModal } from "../components/StaffFormModal";
import { ConfirmDialog } from "../components/Modal";
import { StaffDetailModal } from "../components/StaffDetailModal";
import { StatusBadge } from "../components/StatusBadge";
import { Icon, type IconName } from "../components/icons";
import { HeroBand } from "../components/HeroBand";
import { ClockTerminal } from "./ClockTerminal";
import { formatBDT } from "../lib/currency";
import { formatDate } from "../lib/dates";
import type { Employee } from "../types";

export function Staff() {
  const { data, canPerm, deactivateStaff, isOnLeaveToday } = useApp();
  const canManage = canPerm("manage.staff");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.staff
      .filter((s) => dept === "all" || s.department === dept)
      .filter((s) => !t || s.fullName.toLowerCase().includes(t) || s.employeeId.toLowerCase().includes(t) || s.phone.includes(t))
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  }, [data.staff, q, dept]);

  const stats = useMemo(() => {
    const active = rows.filter((s) => s.isActive && s.status === "Active").length;
    // On-Leave mirrors the Attendance / Monitor / Dashboard definition: a staff
    // member with an APPROVED leave covering today (or a manual DB ON_LEAVE).
    // Using the same live source everywhere prevents per-browser drift (e.g.
    // a Supervisor seeing one person on leave while an Admin sees another).
    const onLeave = rows.filter((s) => s.isActive && (s.status === "On-leave" || isOnLeaveToday(s.employeeId))).length;
    const offboard = rows.filter((s) => !s.isActive || s.status === "Terminated").length;
    return { total: rows.length, active, onLeave, offboard };
  }, [rows, isOnLeaveToday]);

  // Full managed clock terminal for one staff member (kept from the legacy flow).
  if (selectedStaff) {
    return (
      <div className="space-y-4 animate-fade">
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon="chevronLeft" onClick={() => setSelectedStaff(null)}>Back to grid</Button>
          <p className="text-sm text-muted-foreground">Managing clock for <span className="font-semibold text-foreground">{selectedStaff.fullName}</span></p>
        </div>
        <ClockTerminal embedded targetStaffId={selectedStaff.employeeId} />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade">
      {/* ================= Hero ================= */}
      <HeroBand
        eyebrow="Staff Management · Roster"
        title="Staff Roster"
        subtitle="Every team member as a live card — inspect complete profiles, edit records or manage their clock directly from the grid."
        icon="users2"
        stats={[
          { label: "Total", value: stats.total, icon: "users" },
          { label: "Active", value: stats.active, icon: "check" },
          { label: "On Leave", value: stats.onLeave, icon: "calendar" },
          { label: "Offboard", value: stats.offboard, icon: "x" },
        ]}
        actions={canManage && (
          <button onClick={() => { setEditing(null); setModalOpen(true); }}
            className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary-deep to-primary-bright px-4 py-2 text-sm font-bold text-white shadow-md shadow-primary/30 transition hover:from-primary hover:to-primary-bright">
            <Icon name="plus" size={16} /> Add Staff
          </button>
        )}
      />

      {/* ================= Filter toolbar ================= */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground" />
            <Input className="pl-9" placeholder="Search name, ID or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="min-w-0 flex-1 sm:w-auto sm:flex-none" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">All departments</option>
            {data.departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
          <p className="shrink-0 text-xs text-faint-foreground">{rows.length} of {data.staff.length} staff shown</p>
        </div>
      </Card>
{/* ================= Card grid ================= */}
      {rows.length === 0 ? (
        <Card className="p-8"><EmptyState icon="users2" title="No staff found" desc="Adjust your search or department filter." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((s) => {
            const shift = data.shifts.find((x) => x.id === s.shiftId);
            return (
              <div key={s.employeeId}
                className="group flex h-full flex-col rounded-2xl border border-edge bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-lg">
                {/* profile header */}
                <div className="flex items-start gap-3">
                  <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-foreground">{s.fullName}</p>
                      {s.role === "SUPERVISOR" && (
                        <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary ring-1 ring-inset ring-primary/25">Supervisor</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{s.employeeId} · {s.jobTitle}</p>
                    <div className="mt-1.5">
                      {s.isActive ? <StatusBadge status={isOnLeaveToday(s.employeeId) ? "On-leave" : s.status} /> : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />Deactivated
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* meta */}
                <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  <MetaRow icon="briefcase" text={s.department} />
                  <MetaRow icon="building" text={`${s.section || "—"}${s.counter ? ` · Counter ${s.counter}` : ""}`} />
                  <MetaRow icon="calendar" text={`Joined ${formatDate(s.joinDate)}`} />
                </div>

                {/* shift + salary chips */}
                <div className="mt-3.5 flex flex-wrap gap-1.5">
                  {shift && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-edge">
                      <span className="h-2 w-2 rounded-full" style={{ background: shift.color }} />Template: {shift.name}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft px-2 py-1 text-[11px] font-semibold text-primary ring-1 ring-inset ring-primary/25">
                    <Icon name="wallet" size={11} />{salaryText(s)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-edge">
                    <Icon name="clock" size={11} />Custom hours: {s.shiftStart} – {s.shiftEnd}
                  </span>
                </div>

                {/* quick actions */}
                <div className="mt-auto flex items-center gap-1.5 border-t border-edge pt-3">
                  <Button size="sm" variant="subtle" icon="eye" className="flex-1" onClick={() => setViewing(s)}>View</Button>
                  {canManage && (
                    <>
                      <Button size="sm" variant="secondary" icon="pencil" onClick={() => { setEditing(s); setModalOpen(true); }}>Edit</Button>
                      <IconButton size="sm" icon="clock" label="Manage clock" onClick={() => setSelectedStaff(s)} />
                      {s.isActive && (
                        <IconButton size="sm" icon="trash" label="Deactivate" className="hover:text-rose-600" onClick={() => setConfirmId(s.employeeId)} />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <StaffFormModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
      <StaffDetailModal staff={viewing} open={!!viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => confirmId && deactivateStaff(confirmId)}
        title="Deactivate staff?" message="This soft-deletes the record (excluded from payroll). Logged in the audit trail." confirmLabel="Deactivate" danger />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function MetaRow({ icon, text }: { icon: IconName; text: string }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5">
      <Icon name={icon} size={12} className="shrink-0 text-faint-foreground" />
      <span className="truncate">{text}</span>
    </p>
  );
}

function salaryText(s: Employee): string {
  if (s.salaryType === "Daily") return `${formatBDT(s.dailyRate, false)}/day`;
  if (s.salaryType === "Hourly") return `${formatBDT(s.hourlyRate, false)}/hr`;
  if (s.salaryType === "Weekly") return `${formatBDT(s.baseSalary, false)}/wk`;
  return `${formatBDT(s.baseSalary, false)}/mo`;
}