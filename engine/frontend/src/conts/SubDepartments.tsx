// Conts only (not part of Houzs's code): the Departments block of the Ledger setup page (SOP 1.1; chew 4 Nov 2026).
// Finance keeps the sub-departments under Rental, Renovation and Company: adds one, renames it, maps it to the staff
// department whose people default to it, retires it and brings it back. Built-in rows are renamed, never retired.
import { useEffect, useState } from "react";
import { Button } from "@2990s/design-system";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import type { Department } from "./department";
import { useSaveSubDepartment, useStaffDepartments, useSubDepartments, type SubDepartment, type SubDepartmentSave } from "./subDepartmentQueries";

const GROUPS: ReadonlyArray<{ department: Department; label: string }> = [
  { department: "rental", label: "Rental" },
  { department: "supply", label: "Renovation" },
  { department: "shared", label: "Company" },
];
const MUTED = "var(--fg-muted)";

function Row({ s, canSave, save, staff }: {
  s: SubDepartment; canSave: boolean; save: (b: SubDepartmentSave) => Promise<void>; staff: ReadonlyArray<{ id: string; name: string }>;
}) {
  const askConfirm = useConfirm();
  const [name, setName] = useState(s.name);
  useEffect(() => { setName(s.name); }, [s.name]);

  const rename = () => {
    const n = name.trim();
    if (!n) { setName(s.name); return; }
    if (n !== s.name) void save({ id: s.id, name: n });
  };
  const retire = async () => {
    const ok = await askConfirm({
      title: `Retire ${s.name}?`,
      body: "Lines that already name it keep it; it is no longer offered on new lines.",
      confirmLabel: "Retire",
    });
    if (ok) await save({ id: s.id, active: false });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: s.active ? 1 : 0.6 }}>
      <input aria-label={`Name of ${s.name}`} value={name} disabled={!canSave} onChange={(e) => setName(e.target.value)} onBlur={rename}
        style={{ flex: "1 1 200px", minWidth: 0 }} />
      <select aria-label={`Staff department for ${s.name}`} value={s.staffDepartmentId ?? ""} disabled={!canSave}
        onChange={(e) => void save({ id: s.id, staffDepartmentId: e.target.value || null })} style={{ flex: "0 1 180px" }}>
        <option value="">No staff department</option>
        {staff.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {s.fixedKey && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Built in</span>}
      {!s.active && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Retired</span>}
      {canSave && !s.fixedKey && s.active && (
        <Button variant="ghost" size="sm" aria-label={`Retire ${s.name}`} onClick={() => void retire()}>Retire</Button>
      )}
      {canSave && !s.active && (
        <Button variant="ghost" size="sm" aria-label={`Bring back ${s.name}`} onClick={() => void save({ id: s.id, active: true })}>Bring back</Button>
      )}
    </div>
  );
}

function AddRow({ department, label, save }: { department: Department; label: string; save: (b: SubDepartmentSave) => Promise<void> }) {
  const [name, setName] = useState("");
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    await save({ department, name: n });
    setName("");
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input aria-label={`New ${label} department`} placeholder={`Add under ${label}`} value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void add(); }} style={{ flex: "1 1 200px", minWidth: 0 }} />
      <Button variant="secondary" size="sm" onClick={() => void add()} disabled={!name.trim()}>Add</Button>
    </div>
  );
}

export function SubDepartments({ canSave }: { canSave: boolean }) {
  const q = useSubDepartments();
  const staff = useStaffDepartments().data?.departments ?? [];
  const mut = useSaveSubDepartment();
  const [note, setNote] = useState<string | null>(null);
  const list = q.data?.subDepartments ?? [];

  const save = async (b: SubDepartmentSave) => {
    setNote(null);
    try { await mut.mutateAsync(b); } catch (err) { setNote(err instanceof Error ? err.message : "Not saved."); }
  };

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Departments</h2>
      <p style={{ margin: 0, color: MUTED, fontSize: "var(--fs-13)" }}>
        Every line names one of these. Its department (Rental, Renovation, Company) is a column of the profit and loss; staff
        documents start on the one mapped to the person&apos;s staff department.
      </p>
      {q.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The departments did not load.</div>}
      {note && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>{note}</div>}
      {GROUPS.map((g) => (
        <fieldset key={g.department} style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <legend style={{ fontWeight: 600, fontSize: "var(--fs-13)", marginBottom: 4 }}>{g.label}</legend>
          {list.filter((s) => s.department === g.department).map((s) => <Row key={s.id} s={s} canSave={canSave} save={save} staff={staff} />)}
          {canSave && <AddRow department={g.department} label={g.label} save={save} />}
        </fieldset>
      ))}
      {!canSave && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Only someone who can post to the ledger may change these.</span>}
    </section>
  );
}
