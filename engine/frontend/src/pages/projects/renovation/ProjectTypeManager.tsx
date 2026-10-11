/* Project types (Full renovation, Airbnb package, Carpentry only, Design only...):
   the SLA days (start date + SLA days = the project's SLA due date) and which of
   the 11 stages a project of that type runs. Design, handover and closed are
   always on. Lives in Project Maintenance in renovation mode. */

import { useState } from "react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { RENO_STAGES, STAGE_LABEL, UNSKIPPABLE, type StageKey } from "../../../vendor/shared/renovation-stages";
import { renovationApi, type ProjectType } from "./renovationApi";
import { errorText } from "./renovationModel";
import { inputClass } from "./renovationUi";

export function toggleStage(keys: readonly string[], key: StageKey): string[] {
  if (UNSKIPPABLE.includes(key)) return [...keys];
  const set = new Set(keys);
  if (set.has(key)) set.delete(key); else set.add(key);
  for (const k of UNSKIPPABLE) set.add(k);
  return RENO_STAGES.filter((k) => set.has(k));
}

export function ProjectTypeManager() {
  const q = useQuery(["renovation", "types"], () => renovationApi.types());
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const types = q.data?.data ?? [];

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); q.reload(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <section className="rounded-md border border-border bg-surface p-6">
      <h2 className="text-[10px] font-semibold uppercase tracking-brand text-accent">Project types</h2>
      <p className="mt-1 mb-4 text-[12px] text-ink-secondary">SLA days: a project is due that many days after it starts (shown on the board, flagged when passed). Stages: a stage that is off is skipped for that type; design, handover and closed always run.</p>
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <div className="space-y-4">
        {types.map((t) => <TypeRow key={t.id} t={t} onSave={(b) => run(() => renovationApi.patchType(t.id, b))} />)}
      </div>
      <div className="mt-4 flex gap-2">
        <input className={inputClass + " max-w-xs"} placeholder="New type name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New project type name" />
        <Button variant="secondary" disabled={!name.trim()} onClick={() => run(async () => { await renovationApi.createType({ name: name.trim(), stageKeys: [...RENO_STAGES] }); setName(""); })}>Add type</Button>
      </div>
    </section>
  );
}

function TypeRow({ t, onSave }: { t: ProjectType; onSave: (b: { stageKeys?: string[]; active?: boolean; slaDays?: number | null }) => void }) {
  const [keys, setKeys] = useState<string[]>(t.stage_keys);
  const [sla, setSla] = useState(t.sla_days == null ? "" : String(t.sla_days));
  const dirty = keys.join(",") !== t.stage_keys.join(",");
  const slaDirty = sla !== (t.sla_days == null ? "" : String(t.sla_days));
  const slaValid = sla === "" || (/^\d+$/.test(sla) && Number(sla) >= 1 && Number(sla) <= 3650);
  return (
    <div className="rounded border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">{t.name}{!t.active && <span className="ml-2 text-xs text-ink-secondary">(inactive)</span>}</div>
        <div className="flex gap-2">
          {dirty && <Button onClick={() => onSave({ stageKeys: keys })}>Save stages</Button>}
          <Button variant="ghost" onClick={() => onSave({ active: !t.active })}>{t.active ? "Deactivate" : "Activate"}</Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-ink-secondary">SLA
          <input className={inputClass + " w-20"} inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value.trim())} aria-label={`SLA days of ${t.name}`} />
          days
        </label>
        {slaDirty && <Button variant="secondary" disabled={!slaValid} onClick={() => onSave({ slaDays: sla === "" ? null : Number(sla) })}>Save SLA</Button>}
        {!slaValid && <span className="text-xs text-err">1 to 3650 days</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {RENO_STAGES.map((k) => {
          const locked = UNSKIPPABLE.includes(k);
          return (
            <label key={k} className={"inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs " + (locked ? "opacity-70" : "")}>
              <input type="checkbox" checked={keys.includes(k)} disabled={locked} onChange={() => setKeys(toggleStage(keys, k))} />
              {STAGE_LABEL[k]}
            </label>
          );
        })}
      </div>
    </div>
  );
}
