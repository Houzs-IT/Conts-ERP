/* SLA per project step (owner, 16 Oct 2026; engine services/renovation/stepSla.ts, migration 0121).
   - StepSlaLine: under the step bar, the current step's days in step against the days allowed, red "Overdue by N
     days" when over, and "edit" for this project's own days.
   - StepSlaDialog: this project's days per step; blank = no SLA, "use default" goes back to Project Maintenance's.
   - SlaDefaultsManager: Project Maintenance, the default days per step (blank = no SLA). */

import { useState } from "react";
import { Timer } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type FlowStepKey, type FlowStepRow, type StepSlaView } from "./simpleApi";
import { errorText, shortDate } from "./renovationModel";
import { Dialog } from "./renovationUi";

/* inputClass is full width (and cn does not merge classes), so the days box has its own. */
const dayInput = "w-24 shrink-0 rounded-md border border-border bg-surface px-3 py-2 text-sm";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "12 days in Design · SLA 14 days", "Overdue by 5 days", or nothing to say. Pure, for the line and its test. */
export function slaText(sla: Pick<StepSlaView, "daysIn" | "days" | "overdueBy">, stepLabel: string): { main: string; overdue: string | null } {
  const inStep = sla.daysIn != null ? `${plural(sla.daysIn, "day")} in ${stepLabel}` : `In ${stepLabel}`;
  const allowed = sla.days != null ? `SLA ${plural(sla.days, "day")}` : "No SLA";
  return { main: `${inStep} · ${allowed}`, overdue: sla.overdueBy != null ? `Overdue by ${plural(sla.overdueBy, "day")}` : null };
}

export function StepSlaLine({ projectId, sla, stepLabel, canWrite, onChanged }: {
  projectId: number; sla: StepSlaView; stepLabel: string; canWrite: boolean; onChanged: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const t = slaText(sla, stepLabel);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="reno-sla">
      <Timer size={12} className={sla.overdueBy != null ? "text-err" : "text-ink-secondary"} />
      <span className="text-ink-secondary" title={sla.enteredOn ? `In this step since ${shortDate(sla.enteredOn)}` : undefined}>{t.main}</span>
      {t.overdue && <span className="rounded-full bg-err-bg px-2 py-0.5 font-semibold text-err">{t.overdue}</span>}
      {canWrite && <button type="button" className="text-primary hover:underline" onClick={() => setEditing(true)}>edit</button>}
      {editing && <StepSlaDialog projectId={projectId} sla={sla} onClose={() => setEditing(false)} onSaved={(text) => { setEditing(false); onChanged(text); }} />}
    </div>
  );
}

function StepSlaDialog({ projectId, sla, onClose, onSaved }: { projectId: number; sla: StepSlaView; onClose: () => void; onSaved: (text: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(sla.steps.map((s) => [s.key, s.days == null ? "" : String(s.days)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const changed = sla.steps.filter((s) => (vals[s.key] ?? "") !== (s.days == null ? "" : String(s.days)));
      for (const s of changed) {
        const raw = (vals[s.key] ?? "").trim();
        await simpleApi.setStepSla(projectId, s.key, { days: raw === "" ? null : Number(raw) });
      }
      onSaved(changed.length ? "SLA saved." : "Nothing changed.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function resetToDefault(key: FlowStepKey, label: string) {
    setBusy(true);
    setError(null);
    try { await simpleApi.setStepSla(projectId, key, { useDefault: true }); onSaved(`${label} is back on the default SLA.`); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog title="SLA for this project" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
      </>}>
      <p className="mb-3 text-sm text-ink-secondary">Days this project may stay in each step. Blank means no SLA. The default comes from Project Maintenance; a number here applies to this project only.</p>
      <ul className="space-y-2">
        {sla.steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-2">
            <span className={cn("w-28 shrink-0 text-sm", s.key === sla.stepKey ? "font-semibold text-ink" : "text-ink")}>{s.label}{s.key === sla.stepKey ? " (now)" : ""}</span>
            <input className={dayInput} inputMode="numeric" aria-label={`Days allowed in ${s.label}`} placeholder="No SLA"
              value={vals[s.key] ?? ""} disabled={busy} onChange={(e) => setVals((v) => ({ ...v, [s.key]: e.target.value.replace(/[^\d]/g, "") }))} />
            <span className="text-xs text-ink-secondary">days</span>
            <span className="text-[11px] text-ink-secondary">
              {s.source === "project" ? "this project's own" : "default"}
              {s.defaultDays != null ? ` (default ${s.defaultDays})` : " (no default)"}
              {s.source === "project" && <> · <button type="button" className="text-primary hover:underline" disabled={busy} onClick={() => resetToDefault(s.key, s.label)}>use default</button></>}
            </span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}

/** Project Maintenance: the default days per step. Saved per row; every change is audited on the server. */
export function SlaDefaultsManager() {
  const q = useQuery(["renovation", "flow-steps"], () => simpleApi.flowSteps());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const steps = [...(q.data?.data ?? [])].filter((s) => s.step_key !== "closed").sort((a, b) => a.sort_order - b.sort_order);
  const ready = q.data?.slaReady !== false;
  return (
    <section className="rounded-md border border-border bg-surface p-4 sm:p-6 min-w-0" data-testid="sla-defaults">
      <h2 className="text-[10px] font-semibold uppercase tracking-brand text-accent">SLA</h2>
      <p className="mt-1 mb-4 text-[12px] text-ink-secondary">
        How many days a project may stay in each step. A project takes the number when it enters the step and keeps it; it can be changed on the project itself.
        Blank means no SLA. A project over its days shows "Overdue" on the project page and in the list.
      </p>
      {!ready && <p className="mb-2 text-sm text-ink-secondary">SLA needs a database update that is not applied yet.</p>}
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      {saved && <p role="status" className="mb-2 text-sm text-synced">{saved}</p>}
      {q.loading && !q.data && <p className="text-sm text-ink-secondary">Loading...</p>}
      <ul className="divide-y divide-border">
        {steps.map((s) => (
          <SlaRow key={s.step_key} s={s} disabled={!ready} onSave={async (days) => {
            setError(null); setSaved(null);
            try { await simpleApi.setFlowStepSla(s.step_key, days); setSaved(`${s.label}: ${days == null ? "no SLA" : plural(days, "day")}.`); q.reload(); }
            catch (e) { setError(errorText(e)); }
          }} />
        ))}
      </ul>
    </section>
  );
}

function SlaRow({ s, disabled, onSave }: { s: FlowStepRow; disabled: boolean; onSave: (days: number | null) => Promise<void> }) {
  const stored = s.sla_days == null ? "" : String(s.sla_days);
  const [v, setV] = useState(stored);
  const [busy, setBusy] = useState(false);
  const dirty = v !== stored;
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-2", !s.active && "opacity-60")}>
      <span className="w-32 shrink-0 text-sm font-medium text-ink">{s.label}{!s.active && <span className="ml-1 text-[11px] font-normal text-ink-secondary">off</span>}</span>
      <input className={dayInput} inputMode="numeric" aria-label={`Days allowed in ${s.label}`} placeholder="No SLA" value={v}
        disabled={disabled || busy} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} />
      <span className="text-xs text-ink-secondary">days</span>
      {dirty && (
        <Button variant="secondary" disabled={busy || disabled} onClick={async () => { setBusy(true); await onSave(v === "" ? null : Number(v)); setBusy(false); }}>
          {busy ? "Saving..." : "Save"}
        </Button>
      )}
    </li>
  );
}
