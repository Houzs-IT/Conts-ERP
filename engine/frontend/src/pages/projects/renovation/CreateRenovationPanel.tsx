/* New renovation project (owner, 14 Oct 2026): type, then the customer and property block shared with
   the sales order (CustomerPropertyFields, migration 0112), planned handover, and
   the people: Project PIC and Attending (owner, 14 Oct 2026: no Sales / Designer
   split; a person's roles say what they do). Attending uses the Team card's own
   picker. No name field: the project is named Building + Unit (else the customer's
   name), shown as it will be saved; no "Customer is" either. No brand, event type
   or venue: those belong to exhibitions. */

import { useState } from "react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi } from "./renovationApi";
import { errorText } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";
import { PersonSelect, usePeople } from "./PersonSelect";
import { AttendingPicker } from "./ProjectRecords";
import type { AttendingPerson } from "./simpleApi";
import { CustomerBlock } from "./CustomerBlock";
import { projectInfoApi } from "./customerPropertyApi";
import { EMPTY_CUSTOMER_PROPERTY, missingFields, toProjectBody, type CustomerPropertyValue } from "./customerPropertyModel";
import { projectNameFrom } from "../../../vendor/shared/renovation-property";

export function CreateRenovationPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const types = useQuery(["renovation", "types"], () => renovationApi.types());
  const lists = useQuery(["renovation", "property-lists"], () => projectInfoApi.lists());
  const [f, setF] = useState({ projectTypeId: "", plannedHandoverDate: "" });
  const [cp, setCp] = useState<CustomerPropertyValue>(EMPTY_CUSTOMER_PROPERTY);
  const [picPersonId, setPicPersonId] = useState<number | null>(null);
  const people = usePeople();
  const [attending, setAttending] = useState<AttendingPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const activeTypes = (types.data?.data ?? []).filter((t) => t.active);
  const typeId = f.projectTypeId || (activeTypes[0] ? String(activeTypes[0].id) : "");
  const propertyReady = lists.data?.ready === true;
  const projectName = projectNameFrom(cp.building, cp.unitNo, cp.customerName);
  const [tried, setTried] = useState(false);
  /* The same required fields as the sales order (owner, 14 Oct 2026); the server checks them too. */
  const missing = tried && propertyReady ? missingFields(cp) : undefined;

  async function submit() {
    setTried(true);
    if (!cp.customerName.trim()) { setError("Enter the customer or owner name."); return; }
    if (propertyReady && missingFields(cp).size > 0) { setError(`Fill in: ${[...missingFields(cp)].join(", ")}.`); return; }
    if (!typeId) { setError("Pick a project type."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await renovationApi.create({
        name: projectName, projectTypeId: Number(typeId), customerName: cp.customerName.trim(),
        customerPhone: cp.customerPhone || null, customerEmail: cp.customerEmail.trim() || null, building: cp.building.trim() || null,
        unitNo: cp.unitNo.trim() || null, plannedHandoverDate: f.plannedHandoverDate || null,
        renoPicPersonId: picPersonId, attendingPersonIds: attending.map((a) => a.id),
        /* The whole block, checked and saved with the project in one request. */
        ...(propertyReady ? { customerInfo: toProjectBody(cp) } : {}),
      });
      onCreated(r.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New renovation project"
      wide
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? "Creating..." : "Create project"}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="min-w-0 text-sm">
            <span className="mb-1 block text-ink-secondary">Project name</span>
            <div className="flex h-[38px] items-center rounded-md border border-dashed border-border bg-surface-dim px-3 text-ink" aria-live="polite">
              {projectName ? <span className="truncate font-medium">{projectName}</span> : <span className="text-ink-secondary">Building and unit (or the customer name)</span>}
            </div>
          </div>
          <Field label="Project type">
            <select className={inputClass} value={typeId} onChange={set("projectTypeId")}>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <section>
          <CustomerBlock mode="project" value={cp} onChange={setCp} lists={lists.data ?? undefined} disabled={busy}
            hideProperty={!propertyReady} missing={missing} />
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">People and dates</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Project PIC"><PersonSelect label="Project PIC" value={picPersonId} onChange={setPicPersonId} /></Field>
            <Field label="Planned handover"><input type="date" className={inputClass} value={f.plannedHandoverDate} onChange={set("plannedHandoverDate")} /></Field>
            <div className="rounded-md border border-border p-2 sm:col-span-2">
              <AttendingPicker
                attending={attending}
                canWrite={!busy}
                onSave={async (ids) => {
                  /* Nothing is saved yet: the picked people go with the new project. */
                  const all = people.data?.data ?? [];
                  setAttending(ids.map((pid) => attending.find((a) => a.id === pid)
                    ?? (() => { const p = all.find((x) => x.id === pid)!; return { id: p.id, name: p.name, active: p.active, phone: p.phone ?? null, roles: p.roles }; })()));
                }}
              />
            </div>
          </div>
        </section>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
