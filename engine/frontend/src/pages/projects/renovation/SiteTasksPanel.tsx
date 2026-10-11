/* Site tasks of a project, named by the owner's Notion categories. A task is done
   by a subcontractor or supplier on a purchase order (it completes when the PO is
   received) or by our own in-house crew picked from the people list (ticked done).
   Tasks come from the contract's works lines and the project type, or are added
   here by category; one category may repeat. */

import { useState } from "react";
import { Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { STAGE_LABEL, type StageKey } from "../../../vendor/shared/renovation-stages";
import { renovationApi } from "./renovationApi";
import { simpleApi, type TaskViewV2 } from "./simpleApi";
import { TASK_STATUS_LABEL, errorText, shortDate, taskTone } from "./renovationModel";
import { Dialog, Field, Pill, inputClass } from "./renovationUi";
import { PeoplePicker } from "./PersonSelect";

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

export function fulfilmentText(t: Pick<TaskViewV2, "fulfilment_kind" | "supplier_name" | "po_number" | "assignees">): string {
  const crew = (t.assignees ?? []).map((a) => a.name).join(", ");
  if (t.fulfilment_kind === "internal") return crew ? `In-house: ${crew}` : "In-house crew (not assigned)";
  return [t.supplier_name ?? "No subcontractor yet", t.po_number, crew ? `crew: ${crew}` : null].filter(Boolean).join(" · ");
}

export function SiteTasksPanel({ projectId, tasks, canWrite, linesAvailable, onAct, onSkip }: {
  projectId: number; tasks: TaskViewV2[]; canWrite: boolean; linesAvailable: boolean; onAct: Act; onSkip: (t: TaskViewV2) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const visible = tasks.filter((t) => showSkipped || t.status !== "skipped");
  const stages = [...new Set(visible.map((t) => t.stage_key))];
  const skipped = tasks.filter((t) => t.status === "skipped").length;
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">Site tasks</h3>
          <p className="text-xs text-ink-secondary">Dates are a plan, not a gate: tasks may overlap and move; only dates that pass raise a flag.</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {linesAvailable && <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => onAct(() => renovationApi.syncTasks(projectId), "Tasks updated from the contract.")}>Update from contract</Button>}
            <Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add task</Button>
          </div>
        )}
      </div>
      {visible.length === 0 && <p className="mt-3 text-sm text-ink-secondary">No site tasks yet.</p>}
      {stages.map((st) => (
        <div key={st} className="mt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{STAGE_LABEL[st as StageKey] ?? st}</div>
          <ul className="mt-1 space-y-2">
            {visible.filter((t) => t.stage_key === st).map((t) => <SiteTaskRow key={t.id} t={t} canWrite={canWrite} onAct={onAct} onSkip={() => onSkip(t)} />)}
          </ul>
        </div>
      ))}
      {skipped > 0 && (
        <button type="button" className="mt-2 text-xs text-ink-secondary hover:text-ink" onClick={() => setShowSkipped((x) => !x)}>
          {showSkipped ? "Hide skipped tasks" : `Show ${skipped} skipped task${skipped === 1 ? "" : "s"}`}
        </button>
      )}
      {adding && <AddTaskDialog projectId={projectId} onClose={() => setAdding(false)} onAdded={(label) => { setAdding(false); void onAct(async () => undefined, `${label} added.`); }} />}
    </section>
  );
}

function SiteTaskRow({ t, canWrite, onAct, onSkip }: { t: TaskViewV2; canWrite: boolean; onAct: Act; onSkip: () => void }) {
  const [s, setS] = useState(t.planned_start ?? "");
  const [e, setE] = useState(t.planned_end ?? "");
  const [crewOpen, setCrewOpen] = useState(false);
  const dirty = s !== (t.planned_start ?? "") || e !== (t.planned_end ?? "");
  const open = t.status !== "skipped" && t.status !== "done";
  const isTemplate = t.trade_code.startsWith("INTERNAL:");
  const poLinked = t.fulfilment_kind === "po" && !!t.purchase_order_id;
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{t.label}{(t.occurrence ?? 1) > 1 ? ` (${t.occurrence})` : ""}</div>
          <div className="text-xs text-ink-secondary">{fulfilmentText(t)}</div>
          {(t.planned_start || t.planned_end) && !open && <div className="text-xs text-ink-secondary">{shortDate(t.planned_start)} to {shortDate(t.planned_end)}</div>}
        </div>
        <Pill tone={taskTone(t.status)}>{TASK_STATUS_LABEL[t.status]}</Pill>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Field label="Start"><input type="date" className={inputClass} value={s} disabled={!canWrite} onChange={(ev) => setS(ev.target.value)} /></Field>
          <Field label="End"><input type="date" className={inputClass} value={e} disabled={!canWrite} onChange={(ev) => setE(ev.target.value)} /></Field>
          {canWrite && dirty && <Button variant="secondary" className="col-span-2 sm:col-span-1" onClick={() => onAct(() => renovationApi.planTask(t.id, s || null, e || null), "Dates saved.")}>Save dates</Button>}
        </div>
      )}
      {open && canWrite && (
        <div className="mt-2 flex flex-wrap gap-2">
          {t.state === "open" && <Button variant="secondary" onClick={() => onAct(() => renovationApi.startTask(t.id), `${t.label} started.`)}>Start</Button>}
          {(t.fulfilment_kind === "internal" || !poLinked) && <Button onClick={() => onAct(() => renovationApi.completeTask(t.id), `${t.label} done.`)}>Done</Button>}
          <Button variant="ghost" icon={<Users size={14} />} onClick={() => setCrewOpen((x) => !x)}>Crew</Button>
          {!isTemplate && (t.fulfilment_kind === "po"
            ? <Button variant="ghost" onClick={() => onAct(() => simpleApi.setFulfilment(t.id, "inhouse"), `${t.label} is now done by our in-house crew.`)}>Do in-house</Button>
            : <Button variant="ghost" onClick={() => onAct(() => simpleApi.setFulfilment(t.id, "po"), `${t.label} now goes to a subcontractor PO.`)}>Use a PO</Button>)}
          <Button variant="ghost" onClick={onSkip}>Skip...</Button>
        </div>
      )}
      {crewOpen && <CrewEditor t={t} onAct={onAct} onDone={() => setCrewOpen(false)} />}
      {t.status === "skipped" && (
        <div className="mt-1 flex items-center justify-between text-xs text-ink-secondary">
          <span>{t.skip_source === "vo_omitted" ? "All its lines were omitted by a variation order" : `Skipped: ${t.skip_reason ?? ""}`}</span>
          {canWrite && t.skip_source === "manual" && <button type="button" className="text-primary" onClick={() => onAct(() => renovationApi.unskipTask(t.id))}>Un-skip</button>}
        </div>
      )}
      {open && poLinked && <p className="mt-1 text-xs text-ink-secondary">Completes when its purchase order is received on site.</p>}
    </li>
  );
}

function CrewEditor({ t, onAct, onDone }: { t: TaskViewV2; onAct: Act; onDone: () => void }) {
  const [ids, setIds] = useState<number[]>((t.assignees ?? []).map((a) => a.id));
  return (
    <div className="mt-2 rounded-md bg-surface-dim p-2">
      <div className="mb-1 text-xs text-ink-secondary">In-house crew on this task</div>
      <PeoplePicker label="Crew" role="site_crew" value={ids} onChange={setIds} />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button onClick={async () => { await onAct(() => simpleApi.setAssignees(t.id, ids), "Crew saved."); onDone(); }}>Save crew</Button>
      </div>
    </div>
  );
}

function AddTaskDialog({ projectId, onClose, onAdded }: { projectId: number; onClose: () => void; onAdded: (label: string) => void }) {
  const cats = useQuery(["renovation", "task-categories"], () => simpleApi.taskCategories(), [], { staleTime: 5 * 60_000 });
  const list = (cats.data?.data ?? []).filter((c) => c.active);
  const [code, setCode] = useState("");
  const [fulfilment, setFulfilment] = useState<"internal" | "po">("internal");
  const [crew, setCrew] = useState<number[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = list.find((c) => c.code === code);
  const templateOnly = !!cat?.internal_key;
  return (
    <Dialog title="Add a site task" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy || !code} onClick={async () => {
          setBusy(true); setError(null);
          try {
            await simpleApi.addTask(projectId, { categoryCode: code, fulfilment: templateOnly ? "internal" : fulfilment, assigneeIds: crew, plannedStart: start || null, plannedEnd: end || null });
            onAdded(cat?.label ?? code);
          } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
        }}>{busy ? "Adding..." : "Add task"}</Button>
      </>}>
      <div className="space-y-2">
        <Field label="Category">
          <select className={inputClass} value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">{cats.loading ? "Loading..." : "Pick a category"}</option>
            {list.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </Field>
        {!templateOnly && (
          <Field label="Done by">
            <select className={inputClass} value={fulfilment} onChange={(e) => setFulfilment(e.target.value as "internal" | "po")}>
              <option value="internal">Our in-house crew</option>
              <option value="po">Subcontractor / supplier (purchase order)</option>
            </select>
          </Field>
        )}
        <Field label="Crew (optional)"><PeoplePicker label="Crew" role="site_crew" value={crew} onChange={setCrew} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start"><input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><input type="date" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
