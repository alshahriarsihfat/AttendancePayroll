"use client";
import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { Modal, ConfirmDialog } from "../components/Modal";
import { Card, Button, Field, Input, Select } from "../components/ui";

interface Assignment {
  id: string;
  employeeId: string;
  shiftId: string;
  date: string;
  employee?: { fullName?: string; employeeId?: string };
  shift?: { name?: string; startTime?: string; endTime?: string };
}

export function ShiftAssignments() {
  const { data, toast } = useApp();
  const [items, setItems] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; isActive?: boolean }[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [employee, setEmployee] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (employeeId) params.set("employeeId", employeeId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/shift-assignments${params.toString() ? `?${params}` : ""}`, { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load assignments");
      setItems(Array.isArray(json.assignments) ? json.assignments : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load assignments");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEmployeeId("");
    setFrom("");
    setTo("");
    setTimeout(() => void load(), 0);
  };

  useEffect(() => {
    if (!open) return;
    setTemplatesLoading(true);
    setTemplatesError("");
    fetch("/api/shift-templates", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load shift templates");
        setTemplates(Array.isArray(json.templates) ? json.templates : []);
      })
      .catch((e: any) => {
        setTemplates([]);
        setTemplatesError(e?.message || "Failed to load shift templates");
      })
      .finally(() => setTemplatesLoading(false));
  }, [open]);

  const handleSave = async () => {
    if (!employee || !templateId || !date) {
      setSaveError("Employee, Shift Template, and Date are required.");
      return;
    }
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const isEdit = !!editingId;
      const url = isEdit ? `/api/shift-assignments/${editingId}` : "/api/shift-assignments";
      const method = isEdit ? "PUT" : "POST";
      const body = isEdit ? { shiftTemplateId: templateId } : { employeeId: employee, shiftTemplateId: templateId, date };
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save assignment");
      setOpen(false);
      setEditingId(null);
      setEmployee("");
      setTemplateId("");
      setDate("");
      setSaveError("");
      void load();
      toast?.(isEdit ? "Assignment updated" : "Assignment created", "success");
    } catch (e: any) {
      setSaveError(e?.message || "Failed to save assignment");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (a: Assignment) => {
    setEditingId(a.id);
    setEmployee(a.employeeId);
    setTemplateId(a.shiftId);
    setDate(a.date.slice(0, 10));
    setSaveError("");
    setOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId || deleteSaving) return;
    setDeleteSaving(true);
    try {
      const res = await fetch(`/api/shift-assignments/${deletingId}`, { method: "DELETE", credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to delete assignment");
      setConfirmDelete(false);
      setDeletingId(null);
      void load();
      toast?.("Assignment deleted", "success");
    } catch (e: any) {
      toast?.(e?.message || "Failed to delete assignment", "error");
    } finally {
      setDeleteSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">All employees</option>
                {data.staff.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName} ({s.employeeId})</option>)}
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <div className="flex items-end gap-2">
              <Button onClick={() => void load()} disabled={loading}>Apply</Button>
              <Button variant="ghost" onClick={reset} disabled={loading}>Reset</Button>
              <Button onClick={() => { setEditingId(null); setEmployee(""); setTemplateId(""); setDate(""); setSaveError(""); setOpen(true); }} disabled={loading}>Add Assignment</Button>
            </div>
          </div>
        </Card>

        {loading && <Card className="p-4 text-sm text-muted-foreground">Loading assignments…</Card>}
        {error && <Card className="p-4 text-sm text-rose-600">{error}</Card>}
        {!loading && !error && items.length === 0 && <Card className="p-4 text-sm text-muted-foreground">No assignments found.</Card>}

        {!loading && !error && items.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Shift</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Shift Time</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-4 py-3">{a.employee?.fullName || a.employeeId}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-1 text-xs">{a.shift?.name || a.shiftId}</span></td>
                      <td className="px-4 py-3">{new Date(a.date).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })}</td>
                      <td className="px-4 py-3">{a.shift ? `${a.shift.startTime} – ${a.shift.endTime}` : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(a)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setDeletingId(a.id); setConfirmDelete(true); }}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
      <Modal open={open} onClose={() => { setOpen(false); setEditingId(null); setEmployee(""); setTemplateId(""); setDate(""); setSaveError(""); }} title="Create Shift Assignment">
        <div className="space-y-3">
          <Field label="Employee">
            <Select value={employee} onChange={(e) => setEmployee(e.target.value)} disabled={!!editingId}>
              <option value="">Select employee</option>
              {data.staff.map((s) => <option key={s.employeeId} value={s.employeeId}>{s.fullName} ({s.employeeId})</option>)}
            </Select>
          </Field>
          <Field label="Shift Template">
            {templatesLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
            {templatesError && <p className="text-sm text-rose-600">{templatesError}</p>}
            {!templatesLoading && !templatesError && templates.length === 0 && <p className="text-sm text-muted-foreground">No shift templates found.</p>}
            {!templatesLoading && !templatesError && templates.length > 0 && (
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!editingId} />
          </Field>
          {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
          <div className="flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => { setConfirmDelete(false); setDeletingId(null); }} onConfirm={handleDelete} title="Delete Assignment" message="Are you sure?" confirmLabel="Delete" danger />
    </>
  );
}
