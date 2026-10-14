/* The customer + property block shared by the renovation sales order form and the
   project screens (owner, 14 Oct 2026; migration 0112). One component, two uses:
   - on the SO ("so"): pick the project, building / unit, property type, layout,
     built-up sq ft, and the project's start and end dates (read only). The SO's
     own Customer and Delivery address cards hold the customer fields.
   - on the project ("project"): the same property fields plus the customer
     name / phone / email and the site address, which the project masters.
   The pick lists come from Project Maintenance; the rule for which side wins is
   in vendor/shared/renovation-property.ts. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { PhoneInput } from "../../../vendor/scm/components/PhoneInput";
import { soInfoApi } from "./customerPropertyApi";
import {
  applyLayout,
  layoutFor,
  showDate,
  type CustomerPropertyValue,
  type ProjectShared,
  type PropertyLists,
} from "./customerPropertyModel";

const input = "h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-dim disabled:text-ink-secondary";
const ring = "border-err ring-2 ring-err/15";

function Cell({ label, required, missing, className, children, htmlFor }: {
  label: string; required?: boolean; missing?: boolean; className?: string; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className={cn("mb-1 block text-[11px] font-semibold uppercase tracking-wide", missing ? "text-err" : "text-ink-secondary")}>
        {label}{required && <span className="text-err"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ReadOnly({ children }: { children: ReactNode }) {
  return <div className="flex h-9 items-center rounded-md border border-dashed border-border bg-surface-dim px-2.5 text-sm text-ink-secondary">{children}</div>;
}

/** Search renovation projects by code, name, building or customer; picking one fills the block. */
function ProjectPicker({ value, project, onPick, disabled, id }: {
  value: number | null; project: ProjectShared | null; onPick: (p: ProjectShared | null) => void; disabled?: boolean; id: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectShared[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState("loading");
    const t = setTimeout(() => {
      soInfoApi.projects(q.trim())
        .then((r) => { if (live) { setRows(r.data); setState("idle"); } })
        .catch(() => { if (live) setState("error"); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value != null && !open) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {project ? <><span className="font-semibold">{project.code ?? `#${project.id}`}</span> · {project.name}</> : `Project #${value}`}
        </span>
        {!disabled && (
          <>
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => { setQ(""); setOpen(true); }}>Change</button>
            <button type="button" aria-label="Remove the project" className="text-ink-secondary hover:text-ink" onClick={() => onPick(null)}><X size={14} /></button>
          </>
        )}
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
        <input
          id={id}
          className={cn(input, "pl-8")}
          placeholder="Search project, building or customer"
          value={q}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          autoComplete="off"
        />
      </div>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {state === "loading" && rows.length === 0 && <li className="px-3 py-2 text-sm text-ink-secondary">Searching...</li>}
          {state === "error" && <li className="px-3 py-2 text-sm text-err">Projects could not be loaded. Try again.</li>}
          {state !== "error" && rows.length === 0 && state !== "loading" && <li className="px-3 py-2 text-sm text-ink-secondary">No project matches. Create it under Projects first.</li>}
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === value}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-primary-soft"
                onClick={() => { onPick(p); setOpen(false); }}
              >
                <span className="font-semibold">{p.code ?? `#${p.id}`}</span> · {p.name}
                <span className="block truncate text-xs text-ink-secondary">{[p.building, p.unitNo, p.customerName].filter(Boolean).join(" · ") || "No building or customer yet"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CustomerPropertyFieldsProps {
  mode: "so" | "project";
  value: CustomerPropertyValue;
  onChange: (next: CustomerPropertyValue) => void;
  lists: PropertyLists | undefined;
  /** SO: the picked project (for its name and dates). */
  project?: ProjectShared | null;
  /** SO: a project was picked (or cleared); the parent merges its values. */
  onPickProject?: (p: ProjectShared | null) => void;
  /** Labels of required fields still missing (red ring). */
  missing?: ReadonlySet<string>;
  disabled?: boolean;
}

export function CustomerPropertyFields({ mode, value, onChange, lists, project, onPickProject, missing, disabled }: CustomerPropertyFieldsProps) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const set = (patch: Partial<CustomerPropertyValue>) => onChange({ ...value, ...patch });
  const miss = (label: string) => !!missing?.has(label);
  const required = mode === "so";
  const layouts = lists?.layouts ?? [];
  const types = lists?.propertyTypes ?? [];
  const pickedLayout = layoutFor(value, layouts);
  /* A stored value that is no longer an active list row still shows (and saves) as it is. */
  const typeOptions = types.filter((t) => t.active || t.label === value.propertyType);
  const typeMissingFromList = value.propertyType && !types.some((t) => t.label === value.propertyType);
  const layoutOptions = layouts.filter((l) => l.active || l.id === pickedLayout?.id);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
      {mode === "so" && (
        <>
          <Cell label="Project" className="col-span-2" htmlFor={id("project")}>
            <ProjectPicker id={id("project")} value={value.projectId} project={project ?? null} onPick={(p) => onPickProject?.(p)} disabled={disabled} />
          </Cell>
          <Cell label="Start date"><ReadOnly>{value.projectId ? showDate(project?.startDate) : "Pick a project"}</ReadOnly></Cell>
          <Cell label="End date"><ReadOnly>{value.projectId ? showDate(project?.endDate) : "Pick a project"}</ReadOnly></Cell>
        </>
      )}
      {mode === "project" && (
        <>
          <Cell label="Customer name" required missing={miss("Customer name")} className="col-span-2" htmlFor={id("name")}>
            <input id={id("name")} className={cn(input, miss("Customer name") && ring)} value={value.customerName} disabled={disabled}
              onChange={(e) => set({ customerName: e.target.value })} />
          </Cell>
          <Cell label="Phone" missing={miss("Phone number")} className="col-span-2 sm:col-span-1">
            <PhoneInput className={input} value={value.customerPhone} onChange={(v) => set({ customerPhone: v })} disabled={disabled} aria-label="Phone" />
          </Cell>
          <Cell label="Email" className="col-span-2 sm:col-span-1" htmlFor={id("email")}>
            <input id={id("email")} type="email" className={input} value={value.customerEmail} disabled={disabled}
              onChange={(e) => set({ customerEmail: e.target.value })} />
          </Cell>
          <Cell label="Site address" missing={miss("Delivery address")} className="col-span-2 sm:col-span-4" htmlFor={id("site")}>
            <textarea id={id("site")} rows={2} className={cn(input, "h-auto py-2", miss("Delivery address") && ring)} value={value.siteAddress} disabled={disabled}
              placeholder="Unit, street, area" onChange={(e) => set({ siteAddress: e.target.value })} />
          </Cell>
        </>
      )}
      <Cell label="Building" className="col-span-2" htmlFor={id("building")}>
        <input id={id("building")} className={input} value={value.building} disabled={disabled} placeholder="e.g. Skyline Residence"
          onChange={(e) => set({ building: e.target.value })} />
      </Cell>
      <Cell label="Unit" htmlFor={id("unit")}>
        <input id={id("unit")} className={input} value={value.unitNo} disabled={disabled} placeholder="A-12-3"
          onChange={(e) => set({ unitNo: e.target.value })} />
      </Cell>
      <Cell label="Property type" required={required} missing={miss("Property type")} htmlFor={id("ptype")}>
        <select id={id("ptype")} className={cn(input, miss("Property type") && ring)} value={value.propertyType} disabled={disabled}
          onChange={(e) => set({ propertyType: e.target.value })}>
          <option value="">Choose...</option>
          {typeMissingFromList && <option value={value.propertyType}>{value.propertyType}</option>}
          {typeOptions.map((t) => <option key={t.id} value={t.label}>{t.label}{t.active ? "" : " (off)"}</option>)}
        </select>
      </Cell>
      <Cell label="Layout" required={required} missing={miss("Layout")} className="col-span-2" htmlFor={id("layout")}>
        <select id={id("layout")} className={cn(input, miss("Layout") && ring)}
          value={pickedLayout ? String(pickedLayout.id) : value.layoutLabel ? "custom" : ""} disabled={disabled}
          onChange={(e) => {
            if (e.target.value === "custom") return;
            onChange(applyLayout(value, layouts.find((l) => String(l.id) === e.target.value) ?? null));
          }}>
          <option value="">Choose...</option>
          {!pickedLayout && value.layoutLabel && <option value="custom">{value.layoutLabel}</option>}
          {layoutOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </Cell>
      <Cell label="Built-up sq ft" required={required} missing={miss("Built-up sq ft")} htmlFor={id("sqft")}>
        <input id={id("sqft")} inputMode="decimal" className={cn(input, miss("Built-up sq ft") && ring)} value={value.builtUpSqft} disabled={disabled}
          placeholder="e.g. 1,100" onChange={(e) => set({ builtUpSqft: e.target.value.replace(/[^\d.,]/g, "") })} />
      </Cell>
      {lists && !lists.ready && (
        <p className="col-span-2 self-end text-xs text-ink-secondary sm:col-span-3">The property lists are not set up yet (Project Maintenance).</p>
      )}
    </div>
  );
}
