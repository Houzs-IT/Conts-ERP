/* New renovation project: name, type, the customer and property block shared with
   the sales order (CustomerPropertyFields, migration 0112), planned handover, and
   the team: Project PIC, and the sales person and designer who start out as
   Attending. No brand, event type or venue: those belong to exhibitions. */

import { useState } from "react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi } from "./renovationApi";
import { errorText } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";
import { PersonSelect } from "./PersonSelect";
import { CustomerPropertyFields } from "./CustomerPropertyFields";
import { projectInfoApi } from "./customerPropertyApi";
import { EMPTY_CUSTOMER_PROPERTY, toProjectBody, type CustomerPropertyValue } from "./customerPropertyModel";

export function CreateRenovationPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const types = useQuery(["renovation", "types"], () => renovationApi.types());
  const lists = useQuery(["renovation", "property-lists"], () => projectInfoApi.lists());
  const [f, setF] = useState({ name: "", projectTypeId: "", customerKind: "customer" as "owner" | "customer", plannedHandoverDate: "" });
  const [cp, setCp] = useState<CustomerPropertyValue>(EMPTY_CUSTOMER_PROPERTY);
  const [picPersonId, setPicPersonId] = useState<number | null>(null);
  const [salesPersonId, setSalesPersonId] = useState<number | null>(null);
  const [designerPersonId, setDesignerPersonId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const activeTypes = (types.data?.data ?? []).filter((t) => t.active);
  const typeId = f.projectTypeId || (activeTypes[0] ? String(activeTypes[0].id) : "");
  const propertyReady = lists.data?.ready === true;
  const missing = error && !cp.customerName.trim() ? new Set(["Customer name"]) : undefined;

  async function submit() {
    if (!f.name.trim()) { setError("Give the project a name."); return; }
    if (!cp.customerName.trim()) { setError("Enter the customer or owner name."); return; }
    if (!typeId) { setError("Pick a project type."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await renovationApi.create({
        name: f.name.trim(), projectTypeId: Number(typeId), customerKind: f.customerKind, customerName: cp.customerName.trim(),
        customerPhone: cp.customerPhone || null, customerEmail: cp.customerEmail.trim() || null, building: cp.building.trim() || null,
        unitNo: cp.unitNo.trim() || null, siteAddress: cp.siteAddress.trim() || null, plannedHandoverDate: f.plannedHandoverDate || null,
        renoPicPersonId: picPersonId, salesPersonId, designerPersonId,
      });
      /* The property (type, layout, sq ft) is saved with the customer block once the project exists. */
      if (propertyReady && (cp.propertyType || cp.layoutLabel || cp.builtUpSqft.trim())) {
        try {
          await projectInfoApi.save(r.id, toProjectBody(cp));
        } catch (e) {
          setError(`The project ${r.code} was created, but its property was not saved: ${errorText(e)} Open it and use Edit on Customer info.`);
          setBusy(false);
          onCreated(r.id);
          return;
        }
      }
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="Project name"><input className={inputClass} value={f.name} onChange={set("name")} placeholder="Skyline Embassy A-12-3" /></Field>
          <Field label="Project type">
            <select className={inputClass} value={typeId} onChange={set("projectTypeId")}>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Customer is">
            <select className={inputClass} value={f.customerKind} onChange={set("customerKind")}>
              <option value="customer">Outside customer</option>
              <option value="owner">Conts-managed owner</option>
            </select>
          </Field>
        </div>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">Customer and property</h3>
          <CustomerPropertyFields mode="project" value={cp} onChange={setCp} lists={lists.data ?? undefined} disabled={busy}
            hideProperty={!propertyReady} missing={missing} />
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">Team and dates</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Project PIC"><PersonSelect label="Project PIC" value={picPersonId} onChange={setPicPersonId} /></Field>
            <Field label="Planned handover"><input type="date" className={inputClass} value={f.plannedHandoverDate} onChange={set("plannedHandoverDate")} /></Field>
            <Field label="Sales (attending)"><PersonSelect label="Sales" role="sales" value={salesPersonId} onChange={setSalesPersonId} /></Field>
            <Field label="Designer (attending)"><PersonSelect label="Designer" role="designer" value={designerPersonId} onChange={setDesignerPersonId} /></Field>
          </div>
        </section>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
