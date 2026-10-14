/* Project Maintenance (renovation mode): the two pick lists the sales order form
   and the project share (owner, 14 Oct 2026; migration 0112). Property types
   (Condo, Landed, ...) and layouts (a label with its bedroom and bathroom
   counts). Rename, reorder, switch off; nothing is deleted, so saved orders and
   projects keep the label they were written with. */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { projectInfoApi } from "./customerPropertyApi";
import type { LayoutOption, PropertyTypeOption } from "./customerPropertyModel";
import { errorText } from "./renovationModel";
import { inputClass } from "./renovationUi";

function Box({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 sm:p-6 min-w-0">
      <h2 className="text-[10px] font-semibold uppercase tracking-brand text-accent">{title}</h2>
      <p className="mt-1 mb-4 text-[12px] text-ink-secondary">{hint}</p>
      {children}
    </section>
  );
}

const small = "w-16 rounded-md border border-border bg-surface px-2 py-2 text-sm";

function Arrows({ onUp, onDown }: { onUp?: () => void; onDown?: () => void }) {
  return (
    <span className="flex">
      <button type="button" aria-label="Move up" disabled={!onUp} onClick={onUp} className="p-1 text-ink-secondary disabled:opacity-30"><ChevronUp size={16} /></button>
      <button type="button" aria-label="Move down" disabled={!onDown} onClick={onDown} className="p-1 text-ink-secondary disabled:opacity-30"><ChevronDown size={16} /></button>
    </span>
  );
}

export function PropertyListsManager() {
  const q = useQuery(["renovation", "property-lists"], () => projectInfoApi.lists());
  const [error, setError] = useState<string | null>(null);
  const [typeLabel, setTypeLabel] = useState("");
  const [layout, setLayout] = useState({ label: "", bedrooms: "", bathrooms: "" });

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); }
  }
  if (q.data && !q.data.ready) {
    return (
      <Box title="Property types and layouts" hint="Shared by the sales order form and the project.">
        <p className="text-sm text-ink-secondary">These lists arrive with database update 0112, which is not applied yet.</p>
      </Box>
    );
  }
  const types = [...(q.data?.propertyTypes ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const layouts = [...(q.data?.layouts ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const swapType = (a: PropertyTypeOption, b: PropertyTypeOption) => run(async () => {
    await projectInfoApi.patchPropertyType(a.id, { sortOrder: b.sort_order });
    await projectInfoApi.patchPropertyType(b.id, { sortOrder: a.sort_order });
  });
  const swapLayout = (a: LayoutOption, b: LayoutOption) => run(async () => {
    await projectInfoApi.patchLayout(a.id, { sortOrder: b.sort_order });
    await projectInfoApi.patchLayout(b.id, { sortOrder: a.sort_order });
  });
  const bed = Number(layout.bedrooms);
  const bath = Number(layout.bathrooms);
  const layoutOk = layout.bedrooms !== "" && layout.bathrooms !== "" && Number.isInteger(bed) && Number.isInteger(bath);

  return (
    <Box title="Property types and layouts" hint="The sales order form and the project pick from these. A layout carries its bedroom and bathroom counts; the line items can make one room section per room from it. Switch a row off instead of deleting it.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      {q.loading && <p className="text-sm text-ink-secondary">Loading...</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold text-ink">Property type</h3>
          <ul className="divide-y divide-border">
            {types.map((t, i) => (
              <TypeRow key={t.id} t={t}
                onUp={i > 0 ? () => swapType(t, types[i - 1]!) : undefined}
                onDown={i < types.length - 1 ? () => swapType(t, types[i + 1]!) : undefined}
                onSave={(b) => run(() => projectInfoApi.patchPropertyType(t.id, b))} />
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className={inputClass} placeholder="e.g. Townhouse" value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} aria-label="New property type" />
            <Button icon={<Plus size={14} />} disabled={!typeLabel.trim()} onClick={() => run(async () => { await projectInfoApi.addPropertyType(typeLabel.trim()); setTypeLabel(""); })}>Add</Button>
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold text-ink">Layout</h3>
          <ul className="divide-y divide-border">
            {layouts.map((l, i) => (
              <LayoutRow key={l.id} l={l}
                onUp={i > 0 ? () => swapLayout(l, layouts[i - 1]!) : undefined}
                onDown={i < layouts.length - 1 ? () => swapLayout(l, layouts[i + 1]!) : undefined}
                onSave={(b) => run(() => projectInfoApi.patchLayout(l.id, b))} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className={cn(inputClass, "min-w-0 flex-1")} placeholder="Label, e.g. 3 bed 3 bath" value={layout.label} onChange={(e) => setLayout({ ...layout, label: e.target.value })} aria-label="New layout label" />
            <input className={small} inputMode="numeric" placeholder="Bed" value={layout.bedrooms} onChange={(e) => setLayout({ ...layout, bedrooms: e.target.value.replace(/\D/g, "") })} aria-label="Bedrooms" />
            <input className={small} inputMode="numeric" placeholder="Bath" value={layout.bathrooms} onChange={(e) => setLayout({ ...layout, bathrooms: e.target.value.replace(/\D/g, "") })} aria-label="Bathrooms" />
            <Button icon={<Plus size={14} />} disabled={!layoutOk} onClick={() => run(async () => {
              await projectInfoApi.addLayout({ label: layout.label.trim() || `${bed} bed ${bath} bath`, bedrooms: bed, bathrooms: bath });
              setLayout({ label: "", bedrooms: "", bathrooms: "" });
            })}>Add</Button>
          </div>
        </div>
      </div>
    </Box>
  );
}

function TypeRow({ t, onUp, onDown, onSave }: { t: PropertyTypeOption; onUp?: () => void; onDown?: () => void; onSave: (b: { label?: string; active?: boolean }) => void }) {
  const [label, setLabel] = useState(t.label);
  return (
    <li className={cn("flex items-center gap-2 py-1.5", !t.active && "opacity-60")}>
      <Arrows onUp={onUp} onDown={onDown} />
      <input className={cn(inputClass, "min-w-0 flex-1")} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Property type" />
      {label.trim() !== t.label && <Button disabled={!label.trim()} onClick={() => onSave({ label: label.trim() })}>Save</Button>}
      <Button variant="ghost" onClick={() => onSave({ active: !t.active })}>{t.active ? "Switch off" : "Switch on"}</Button>
    </li>
  );
}

function LayoutRow({ l, onUp, onDown, onSave }: { l: LayoutOption; onUp?: () => void; onDown?: () => void; onSave: (b: { label?: string; bedrooms?: number; bathrooms?: number; active?: boolean }) => void }) {
  const [label, setLabel] = useState(l.label);
  const [bed, setBed] = useState(String(l.bedrooms));
  const [bath, setBath] = useState(String(l.bathrooms));
  const changed = label.trim() !== l.label || bed !== String(l.bedrooms) || bath !== String(l.bathrooms);
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-1.5", !l.active && "opacity-60")}>
      <Arrows onUp={onUp} onDown={onDown} />
      <input className={cn(inputClass, "min-w-0 flex-1")} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Layout label" />
      <input className={small} inputMode="numeric" value={bed} onChange={(e) => setBed(e.target.value.replace(/\D/g, ""))} aria-label="Bedrooms" title="Bedrooms" />
      <input className={small} inputMode="numeric" value={bath} onChange={(e) => setBath(e.target.value.replace(/\D/g, ""))} aria-label="Bathrooms" title="Bathrooms" />
      {changed && <Button disabled={!label.trim() || bed === "" || bath === ""} onClick={() => onSave({ label: label.trim(), bedrooms: Number(bed), bathrooms: Number(bath) })}>Save</Button>}
      <Button variant="ghost" onClick={() => onSave({ active: !l.active })}>{l.active ? "Switch off" : "Switch on"}</Button>
    </li>
  );
}
