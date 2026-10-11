/* The six main steps of a project (owner decisions 11 Oct 2026). The step follows
   the data in the modules (SO, PO, site tasks, handover, payments); staff can move
   it by hand with a reason, and it holds until the data moves past it. The hold
   flag (IN DEFECT / ON HOLD) is separate and can be set or cleared any time. */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Hand, History } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { HOLD_FLAG_LABEL } from "../../../vendor/shared/renovation-stages";
import { simpleApi, type FlowStepKey, type FlowView, type Hold, type HoldFlag } from "./simpleApi";
import { errorText, shortDate } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";

const KIND_TEXT: Record<string, string> = {
  manual_step: "Moved by hand",
  follow_data: "Back to following the data",
  hold_set: "Hold set",
  hold_cleared: "Hold cleared",
};

export function StepStrip({ flow, hold, compact = false }: { flow: FlowView; hold: Hold | null; compact?: boolean }) {
  return (
    <ol aria-label="Project steps" className={cn("grid gap-1", compact ? "grid-cols-6" : "grid-cols-3 sm:grid-cols-6")}>
      {flow.steps.map((s, i) => {
        const done = i < flow.currentIndex;
        const cur = i === flow.currentIndex;
        return (
          <li key={s.key} aria-current={cur ? "step" : undefined}
            className={cn("flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
              cur ? (hold ? "bg-err-bg ring-1 ring-err/40" : "bg-primary/10 ring-1 ring-primary/40") : "bg-surface-dim")}>
            {done ? <CheckCircle2 size={15} className="shrink-0 text-synced" /> : <Circle size={15} className={cn("shrink-0", cur ? "text-primary fill-primary/20" : "text-ink-secondary")} />}
            <span className={cn("truncate", cur ? "font-semibold text-ink" : done ? "text-ink" : "text-ink-secondary")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FlowPanel({ projectId, flow, hold, canWrite, onChanged }: {
  projectId: number; flow: FlowView; hold: Hold | null; canWrite: boolean; onChanged: (text: string) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [holding, setHolding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const derivedLabel = flow.steps.find((s) => s.key === flow.derived)?.label ?? flow.derived;

  async function run(fn: () => Promise<unknown>, text: string) {
    setError(null);
    try { await fn(); onChanged(text); } catch (e) { setError(errorText(e)); }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-3 mb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">Step {flow.currentIndex + 1} of {flow.steps.length}: {flow.currentLabel}</span>
          {hold && <span className="inline-flex items-center gap-1 rounded-full bg-err-bg px-2 py-0.5 text-xs font-semibold text-err"><AlertTriangle size={12} />{HOLD_FLAG_LABEL[hold.flag]}</span>}
          {flow.manualInEffect && <span className="inline-flex items-center gap-1 text-xs text-ink-secondary" title={`The data says ${derivedLabel}`}><Hand size={12} />Set by hand (data says {derivedLabel})</span>}
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setMoving(true)}>Move step...</Button>
            {flow.manualInEffect && <Button variant="ghost" onClick={() => run(() => simpleApi.followData(projectId), "The step follows the data again.")}>Follow data</Button>}
            {hold
              ? <Button variant="secondary" onClick={() => run(() => simpleApi.clearHold(projectId), `${HOLD_FLAG_LABEL[hold.flag]} cleared.`)}>Clear {HOLD_FLAG_LABEL[hold.flag].toLowerCase()}</Button>
              : <Button variant="ghost" onClick={() => setHolding(true)}>Set in defect / on hold...</Button>}
          </div>
        )}
      </div>
      <StepStrip flow={flow} hold={hold} />
      {hold?.note && <p className="mt-2 text-sm text-err">{hold.note}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink" onClick={() => setShowHistory((x) => !x)} aria-expanded={showHistory}>
        <History size={12} />{showHistory ? "Hide step history" : "Step history"}
      </button>
      {showHistory && <StepHistory projectId={projectId} />}
      {moving && (
        <MoveStepDialog flow={flow} onClose={() => setMoving(false)}
          onSave={async (step, reason) => {
            await simpleApi.setStep(projectId, step, reason);
            setMoving(false);
            onChanged(`Moved to ${flow.steps.find((s) => s.key === step)?.label ?? step}.`);
          }} />
      )}
      {holding && (
        <HoldDialog onClose={() => setHolding(false)}
          onSave={async (flag, note) => {
            await simpleApi.setHold(projectId, flag, note);
            setHolding(false);
            onChanged(`${HOLD_FLAG_LABEL[flag]} set.`);
          }} />
      )}
    </section>
  );
}

function StepHistory({ projectId }: { projectId: number }) {
  const q = useQuery(["renovation", "step", projectId], () => simpleApi.step(projectId), [projectId]);
  if (q.loading) return <p className="mt-2 text-xs text-ink-secondary">Loading...</p>;
  const rows = q.data?.history ?? [];
  const label = (k: string | null) => q.data?.steps.find((s) => s.key === k)?.label ?? (k && k in HOLD_FLAG_LABEL ? HOLD_FLAG_LABEL[k as HoldFlag] : k ?? "");
  if (rows.length === 0) return <p className="mt-2 text-xs text-ink-secondary">No hand moves or holds yet. The step has followed the data.</p>;
  return (
    <ul className="mt-2 divide-y divide-border text-xs">
      {rows.map((r) => (
        <li key={r.id} className="py-1.5">
          <span className="text-ink">{KIND_TEXT[r.kind] ?? r.kind}</span>
          {r.kind === "manual_step" && <span className="text-ink-secondary">: {label(r.from_value)} to {label(r.to_value)}</span>}
          {r.kind === "hold_set" && <span className="text-ink-secondary">: {label(r.to_value)}</span>}
          {r.reason && <span className="text-ink-secondary"> · {r.reason}</span>}
          <span className="text-ink-secondary"> · {r.user_name ?? "someone"}, {shortDate(r.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function MoveStepDialog({ flow, onClose, onSave }: { flow: FlowView; onClose: () => void; onSave: (step: FlowStepKey, reason: string | null) => Promise<void> }) {
  const [step, setStep] = useState<FlowStepKey>(flow.current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Move the project to a step" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy || step === flow.current} onClick={async () => {
          setBusy(true); setError(null);
          try { await onSave(step, reason.trim() || null); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
        }}>{busy ? "Saving..." : "Move"}</Button>
      </>}>
      <p className="mb-3 text-sm text-ink-secondary">The step stays where you put it until the data in the sales order, purchase orders, site tasks or handover moves past it. Who moved it and when is recorded.</p>
      <Field label="Step">
        <select className={inputClass} value={step} onChange={(e) => setStep(e.target.value as FlowStepKey)}>
          {flow.steps.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}{s.key === flow.derived ? " (what the data says)" : ""}</option>)}
        </select>
      </Field>
      <div className="mt-2"><Field label="Reason (optional)"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}

function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (flag: HoldFlag, note: string | null) => Promise<void> }) {
  const [flag, setFlag] = useState<HoldFlag>("in_defect");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Flag the project" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await onSave(flag, note.trim() || null); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
        }}>{busy ? "Saving..." : "Set flag"}</Button>
      </>}>
      <Field label="Flag">
        <select className={inputClass} value={flag} onChange={(e) => setFlag(e.target.value as HoldFlag)}>
          <option value="in_defect">IN DEFECT</option>
          <option value="on_hold">ON HOLD</option>
        </select>
      </Field>
      <div className="mt-2"><Field label="Note (optional)"><input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. developer defect: water leak in master bath" /></Field></div>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}
