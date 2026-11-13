"use client";
import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { Modal, ConfirmDialog } from "../components/Modal";
import { Card, Button, Field, Input, Select } from "../components/ui";

interface Department { id: string; code: string; name: string; description?: string | null; isActive: boolean; }

export function Departments() {
  const { toast } = useApp();
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/departments?includeInactive=1", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load departments");
      setItems(Array.isArray(json.departments) ? json.departments : []);
    } catch (e: any) { setError(e?.message || "Failed"); setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setCode(""); setName(""); setDescription(""); setSaveError(""); setOpen(true); };
  const openEdit = (d: Department) => { setEditing(d); setCode(d.code); setName(d.name); setDescription(d.description || ""); setSaveError(""); setOpen(true); };

  const handleSave = async () => {
    if (!code || !name) { setSaveError("Code and name are required."); return; }
    if (saving) return;
    setSaving(true); setSaveError("");
    try {
      const url = editing ? `/api/departments/${editing.id}` : "/api/departments";
      const method = editing ? "PATCH" : "POST";
      const body = editing ? { name, description } : { code, name, description };
      const res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save");
      setOpen(false); void load(); toast?.(editing ? "Updated" : "Created", "success");
    } catch (e: any) { setSaveError(e?.message || "Failed"); }
    finally { setSaving(false); }
  };

  const toggle = async (d: Department) => {
    try {
      const res = await fetch(`/api/departments/${d.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !d.isActive }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed");
      void load(); toast?.("Updated", "success");
    } catch (e: any) { toast?.(e?.message || "Failed", "error"); }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-end"><Button onClick={openCreate}>Add Department</Button></div>
        {loading && <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>}
        {error && <Card className="p-4 text-sm text-rose-600">{error}</Card>}
        {!loading && !error && items.length === 0 && <Card className="p-4 text-sm text-muted-foreground">No departments found.</Card>}
        {!loading && !error && items.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="px-4 py-3">{d.code}</td>
                      <td className="px-4 py-3">{d.name}</td>
                      <td className="px-4 py-3">{d.description || "—"}</td>
                      <td className="px-4 py-3">{d.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => toggle(d)}>{d.isActive ? "Deactivate" : "Activate"}</Button>
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
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Department" : "Create Department"}>
        <div className="space-y-3">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing} /></Field>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
          <div className="flex justify-end"><Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
        </div>
      </Modal>
    </>
  );
}
