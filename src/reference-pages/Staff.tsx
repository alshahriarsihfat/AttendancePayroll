import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, Button, Input, Select, IconButton, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { StaffFormModal } from "../components/StaffFormModal";
import { ConfirmDialog } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { Icon } from "../components/icons";
import { formatBDT } from "../lib/currency";
import { formatDate } from "../lib/dates";
import type { Employee } from "../types";

export function Staff() {
  const { data, canPerm, deactivateStaff } = useApp();
  const canManage = canPerm("manage.staff");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.staff
      .filter((s) => dept === "all" || s.department === dept)
      .filter((s) => !t || s.fullName.toLowerCase().includes(t) || s.employeeId.toLowerCase().includes(t) || s.phone.includes(t))
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  }, [data.staff, q, dept]);

  return (
    <div className="space-y-5 animate-fade">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, ID or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Select className="min-w-0 flex-1 sm:w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {data.departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </Select>
            {canManage && <Button icon="plus" className="shrink-0" onClick={() => { setEditing(null); setModalOpen(true); }}>Add</Button>}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3"><p className="text-sm font-medium text-slate-600">{rows.length} staff</p></div>
        {rows.length === 0 ? <EmptyState icon="users2" title="No staff found" /> : (
          <>
            {/* ===== MOBILE: stacked info-cards (< md) ===== */}
            <div className="divide-y divide-slate-100 md:hidden">
              {rows.map((s) => {
                const shift = data.shifts.find((x) => x.id === s.shiftId);
                return (
                  <div key={s.employeeId} className="flex flex-col gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">{s.fullName}</p>
                        <p className="truncate text-xs text-slate-500">{s.employeeId} · {s.jobTitle}</p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                      <span className="shrink-0">{s.department}</span>
                      {shift && <span className="inline-flex shrink-0 items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: shift.color }} />{s.shiftStart}–{s.shiftEnd}</span>}
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{s.salaryType}</span>
                        <span className="font-semibold tabular-nums text-slate-700">{salaryText(s)}</span>
                      </span>
                    </div>
                    {canManage && (
                      <div className="flex w-full gap-2">
                        <Button size="sm" variant="secondary" icon="pencil" onClick={() => { setEditing(s); setModalOpen(true); }} className="flex-1">Edit</Button>
                        {s.isActive && <Button size="sm" variant="secondary" icon="trash" className="flex-1 text-rose-600" onClick={() => setConfirmId(s.employeeId)}>Remove</Button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ===== DESKTOP: table (≥ md) ===== */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2.5">Staff</th>
                    <th className="px-3 py-2.5">Department</th>
                    <th className="px-3 py-2.5">Shift</th>
                    <th className="px-3 py-2.5">Salary</th>
                    <th className="px-3 py-2.5">Joined</th>
                    <th className="px-3 py-2.5">Status</th>
                    {canManage && <th className="px-5 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((s) => {
                    const shift = data.shifts.find((x) => x.id === s.shiftId);
                    return (
                      <tr key={s.employeeId} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <PhotoAvatar name={s.fullName} photoUrl={s.photoUrl} size={38} />
                            <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{s.fullName}</p><p className="truncate text-xs text-slate-500">{s.employeeId} · {s.jobTitle}</p></div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{s.department}</td>
                        <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: shift?.color }} />{shift?.name}</span></td>
                        <td className="px-3 py-3">
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">{s.salaryType}</span>
                          <span className="ml-1.5 text-xs font-semibold tabular-nums text-slate-700">{salaryText(s)}</span>
                        </td>
                        <td className="px-3 py-3 text-slate-500">{formatDate(s.joinDate)}</td>
                        <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                        {canManage && (
                          <td className="px-5 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <IconButton icon="pencil" label="Edit" size="sm" onClick={() => { setEditing(s); setModalOpen(true); }} />
                              {s.isActive && <IconButton icon="trash" label="Deactivate" size="sm" className="hover:text-rose-600" onClick={() => setConfirmId(s.employeeId)} />}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <StaffFormModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
      <ConfirmDialog open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => confirmId && deactivateStaff(confirmId)}
        title="Deactivate staff?" message="This soft-deletes the record (excluded from payroll). Logged in the audit trail." confirmLabel="Deactivate" danger />
    </div>
  );
}

function salaryText(s: Employee): string {
  if (s.salaryType === "Daily") return `${formatBDT(s.dailyRate, false)}/d`;
  if (s.salaryType === "Hourly") return `${formatBDT(s.hourlyRate, false)}/h`;
  return `${formatBDT(s.baseSalary, false)}/mo`;
}
