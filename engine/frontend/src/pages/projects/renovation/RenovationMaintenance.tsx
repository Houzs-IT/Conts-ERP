/* Project Maintenance for the simplified renovation project (owner decisions
   11 Oct 2026): site crew without a login (everyone else comes from the user
   accounts, 14 Oct 2026), the six main steps (label, order, on/off) and the site
   task categories (Notion wording). */

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { STAGE_LABEL } from "../../../vendor/shared/renovation-stages";
import { simpleApi, type FlowStepRow, type Person, type TaskCategoryRow } from "./simpleApi";
import { errorText } from "./renovationModel";
import { inputClass } from "./renovationUi";

function Box({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 sm:p-6 min-w-0">
      <h2 className="text-[10px] font-semibold uppercase tracking-brand text-accent">{title}</h2>
      <p className="mt-1 mb-4 text-[12px] text-ink-secondary">{hint}</p>
      {children}
    </section>
  );
}

/* Site crew without a login (owner, 14 Oct 2026). Everyone else is a Property OS user account; site crew and
   contractors (ZAINAL, MONIR, ATUN TEAM ...) have no email, so they stay here: people not linked to an account, with the
   site crew role. They are offered as site task crew only. Switch one off instead of deleting, so old tasks keep the name. */
export function CrewManager() {
  const q = useQuery(["renovation", "people", "all"], () => simpleApi.people());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = (q.data?.data ?? []).filter((p) => !p.linked && p.roles.includes("site_crew"));

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <Box title="Crew (no login)" hint="Site crew and contractors without a user account. They can be picked as crew on a site task, nowhere else. Everyone with a login is managed in Property OS under Users and roles. Switch a name off instead of deleting it, so old tasks keep it.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input className={inputClass} placeholder="Name, e.g. ZAINAL" value={name} onChange={(e) => setName(e.target.value)} aria-label="New crew name" />
        <div className="shrink-0 whitespace-nowrap"><Button icon={<Plus size={14} />} disabled={!name.trim()} onClick={() => run(async () => { await simpleApi.createPerson({ name: name.trim(), roles: ["site_crew"] }); setName(""); })}>Add crew</Button></div>
      </div>
      {q.loading && <p className="text-sm text-ink-secondary">Loading...</p>}
      <ul className="divide-y divide-border">
        {list.map((p) => <CrewRow key={p.id} p={p} onSave={(b) => run(() => simpleApi.patchPerson(p.id, b))} />)}
        {!q.loading && list.length === 0 && <li className="py-2 text-sm text-ink-secondary">No crew without a login yet.</li>}
      </ul>
    </Box>
  );
}

function CrewRow({ p, onSave }: { p: Person; onSave: (b: Partial<{ name: string; active: boolean }>) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-2 sm:flex-row">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label={`New name for ${p.name}`} />
        <div className="flex gap-2">
          <Button disabled={!name.trim()} onClick={() => { onSave({ name: name.trim() }); setEditing(false); }}>Save</Button>
          <Button variant="secondary" onClick={() => { setName(p.name); setEditing(false); }}>Cancel</Button>
        </div>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-2 py-2", !p.active && "opacity-60")}>
      <div className="min-w-0 text-sm font-medium text-ink">
        {p.name}
        {!p.active && <span className="ml-1 text-[11px] font-normal text-ink-secondary">switched off</span>}
        {p.source === "import" && <span className="ml-1 text-[11px] font-normal text-ink-secondary">imported</span>}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${p.name}`}>Rename</Button>
        <Button variant="ghost" onClick={() => onSave({ active: !p.active })}>{p.active ? "Switch off" : "Switch on"}</Button>
      </div>
    </li>
  );
}

export function FlowStepsManager() {
  const q = useQuery(["renovation", "flow-steps"], () => simpleApi.flowSteps());
  const [error, setError] = useState<string | null>(null);
  const steps = [...(q.data?.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); }
  }
  async function swap(a: FlowStepRow, b: FlowStepRow) {
    await run(async () => {
      await simpleApi.patchFlowStep(a.step_key, { sortOrder: b.sort_order });
      await simpleApi.patchFlowStep(b.step_key, { sortOrder: a.sort_order });
    });
  }

  return (
    <Box title="Main steps" hint="The six steps a project moves through. Each step's meaning is fixed (it follows the sales order, purchase orders, site tasks, handover and payments); you can rename, reorder or switch one off.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <StepRow key={s.step_key} s={s} index={i}
            onUp={i > 0 ? () => swap(s, steps[i - 1]!) : undefined}
            onDown={i < steps.length - 1 ? () => swap(s, steps[i + 1]!) : undefined}
            onSave={(b) => run(() => simpleApi.patchFlowStep(s.step_key, b))} />
        ))}
      </ol>
    </Box>
  );
}

const STEP_RULE: Record<string, string> = {
  design: "from project creation",
  signed: "a sales order is linked",
  ordering: "sales order lines are on purchase orders",
  renovation: "a site task has started",
  handover: "the customer signed the handover",
  closed: "handed over and fully paid, or closed by hand",
};

function StepRow({ s, index, onUp, onDown, onSave }: { s: FlowStepRow; index: number; onUp?: () => void; onDown?: () => void; onSave: (b: Partial<{ label: string; active: boolean }>) => void }) {
  const [label, setLabel] = useState(s.label);
  return (
    <li className={cn("rounded-md border border-border p-2", !s.active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-sm text-ink-secondary">{index + 1}.</span>
        <input className={inputClass + " flex-1 min-w-[8rem]"} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={`Label of step ${index + 1}`} />
        {label.trim() && label !== s.label && <Button variant="secondary" onClick={() => onSave({ label })}>Save</Button>}
        <button type="button" className="p-1 text-ink-secondary disabled:opacity-30" disabled={!onUp} onClick={onUp} aria-label="Move up"><ChevronUp size={16} /></button>
        <button type="button" className="p-1 text-ink-secondary disabled:opacity-30" disabled={!onDown} onClick={onDown} aria-label="Move down"><ChevronDown size={16} /></button>
        {s.step_key !== "design" && (
          <label className="flex items-center gap-1 text-xs text-ink-secondary">
            <input type="checkbox" checked={s.active} onChange={(e) => onSave({ active: e.target.checked })} />On
          </label>
        )}
      </div>
      <div className="mt-1 pl-7 text-[11px] text-ink-secondary">Reached when {STEP_RULE[s.step_key]}</div>
    </li>
  );
}

export function TaskCategoriesManager() {
  const q = useQuery(["renovation", "task-categories"], () => simpleApi.taskCategories());
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cats = q.data?.data ?? [];

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <Box title="Site task categories" hint="The task names used on site (from the Notion task board). A category switched off is no longer offered when adding a task; existing tasks keep it.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <button type="button" className="text-sm text-primary" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? "Hide" : `Show all ${cats.length}`} categories</button>
      {open && (
        <ul className="mt-2 divide-y divide-border">
          {cats.map((c) => <CategoryRow key={c.code} c={c} onSave={(b) => run(() => simpleApi.patchTaskCategory(c.code, b))} />)}
        </ul>
      )}
    </Box>
  );
}

function CategoryRow({ c, onSave }: { c: TaskCategoryRow; onSave: (b: Partial<{ label: string; active: boolean }>) => void }) {
  const [label, setLabel] = useState(c.label);
  const kind = c.internal_key ? "our team's task" : c.trade_code ? `trade ${c.trade_code.replace(/_/g, " ").toLowerCase()}` : "task by itself";
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-1.5", !c.active && "opacity-60")}>
      <input className={inputClass + " flex-1 min-w-[10rem]"} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={`Label of ${c.code}`} />
      {label.trim() && label !== c.label && <Button variant="secondary" onClick={() => onSave({ label })}>Save</Button>}
      <span className="text-[11px] text-ink-secondary">{(STAGE_LABEL as Partial<Record<string, string>>)[c.stage_key] ?? c.stage_key} · {kind}</span>
      <label className="flex items-center gap-1 text-xs text-ink-secondary"><input type="checkbox" checked={c.active} onChange={(e) => onSave({ active: e.target.checked })} />On</label>
    </li>
  );
}
