/* One renovation project: billing prompt, hardware gate, stage timeline, the
   selected stage's checklist / tasks / proof of delivery, handover and warranty,
   and the linked documents. Every write goes through /api/renovation and the
   page reloads from the server afterwards: the server decides, the page shows. */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, Circle, Lock, MinusCircle, Printer, RefreshCw, Unlock } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { api } from "../../../api/client";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { renovationApi, type ChecklistItem, type ProjectDetail, type StageView, type TaskView } from "./renovationApi";
import {
  SKIP_SOURCE_TEXT, STAGE_STATE_LABEL, TASK_STATUS_LABEL, UNIT_KEY_LABEL,
  errorText, money, shortDate, stageTone, supplyLabel, supplyTone, taskTone,
} from "./renovationModel";
import { AuthImage, Dialog, Field, Pill, SignaturePad, SkipReasonDialog, canvasBlob, inputClass } from "./renovationUi";
import type { StageKey } from "../../../vendor/shared/renovation-stages";

type Skipping = { kind: "stage"; key: StageKey; label: string } | { kind: "item"; id: number; label: string } | { kind: "task"; id: number; label: string };

export function RenovationDetail({ id, canWrite, embedded = false }: { id: number; canWrite: boolean; embedded?: boolean }) {
  const q = useQuery(["renovation", "detail", id], () => renovationApi.detail(id), [id]);
  const [selected, setSelected] = useState<StageKey | null>(null);
  const [skipping, setSkipping] = useState<Skipping | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;

  async function act(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (okText) setNotice({ tone: "ok", text: okText });
      q.reload();
    } catch (e) {
      setNotice({ tone: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  if (q.loading) return <p className="py-10 text-center text-sm text-ink-secondary">Loading project...</p>;
  if (q.error || !d) return <p role="alert" className="py-6 text-sm text-err">The project could not be loaded: {q.error ?? "not found"}</p>;
  const stageKey: StageKey = selected ?? d.currentStage;
  const stage = d.stages.find((s) => s.key === stageKey) ?? d.stages[0]!;
  const p = d.project;

  return (
    <div className="pb-10">
      <PageHeader
        back={embedded ? undefined : "/projects"}
        eyebrow={`Renovation · ${p.code ?? ""}`}
        title={p.name}
        description={[[p.building, p.unit_no].filter(Boolean).join(" "), p.customer_name, d.type?.name].filter(Boolean).join(" · ")}
        actions={<Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => q.reload()}>Refresh</Button>}
      />

      {notice && (
        <div role={notice.tone === "err" ? "alert" : "status"} className={cn("mb-3 rounded-md border px-3 py-2 text-sm", notice.tone === "err" ? "border-err/30 bg-err-bg text-err" : "border-synced/30 bg-synced-bg text-synced")}>
          {notice.text}
        </div>
      )}

      <SummaryStrip d={d} />
      {!d.financeHidden && d.so && <BillingPromptBanner d={d} canWrite={canWrite} onDone={(t) => { setNotice({ tone: "ok", text: t }); q.reload(); }} onError={(t) => setNotice({ tone: "err", text: t })} />}
      <GateCard d={d} />

      <StageTimeline stages={d.stages} current={d.currentStage} selected={stageKey} onSelect={setSelected} />

      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <div className="lg:col-span-2 space-y-4">
          <StagePanel
            d={d}
            stage={stage}
            canWrite={canWrite}
            busy={busy}
            onStart={() => act(() => renovationApi.startStage(id, stage.key), `${stage.label} started.`)}
            onComplete={() => act(() => renovationApi.completeStage(id, stage.key), `${stage.label} marked done.`)}
            onSkip={() => setSkipping({ kind: "stage", key: stage.key, label: stage.label })}
            onUnskip={() => act(() => renovationApi.unskipStage(id, stage.key), `${stage.label} is back in the plan.`)}
            onPlan={(a, b) => act(() => renovationApi.planStage(id, stage.key, a, b))}
            onTick={(item, done) => act(() => renovationApi.tickItem(item.id, done))}
            onSkipItem={(item) => setSkipping({ kind: "item", id: item.id, label: item.title })}
            onUnskipItem={(item) => act(() => renovationApi.unskipItem(item.id))}
          />
          {(stage.key === "hardware" || stage.key === "handover" || d.tasks.some((t) => t.stage_key === stage.key)) && (
            <TradeTasksPanel
              projectId={id}
              tasks={d.tasks.filter((t) => t.stage_key === stage.key)}
              canWrite={canWrite}
              linesAvailable={!d.linesUnavailable}
              onAct={act}
              onSkip={(t) => setSkipping({ kind: "task", id: t.id, label: t.label })}
            />
          )}
          {stage.key === "handover" && <HandoverPanel d={d} canWrite={canWrite} onAct={act} />}
          {stage.key === "warranty" && <WarrantyPanel d={d} />}
          <EvidenceGallery projectId={id} />
        </div>
        <aside className="space-y-4">
          <LinkedDocuments d={d} />
          {d.redFlags.length > 0 && (
            <section className="rounded-lg border border-err/30 bg-err-bg p-3">
              <h3 className="text-sm font-semibold text-err flex items-center gap-1"><AlertTriangle size={14} />Red flags</h3>
              <ul className="mt-1 text-sm text-err list-disc pl-5">{d.redFlags.map((f) => <li key={f.code}>{f.text}</li>)}</ul>
            </section>
          )}
        </aside>
      </div>

      {skipping && (
        <SkipReasonDialog
          what={skipping.label}
          onCancel={() => setSkipping(null)}
          onConfirm={async (reason) => {
            try {
              if (skipping.kind === "stage") await renovationApi.skipStage(id, skipping.key, reason);
              else if (skipping.kind === "item") await renovationApi.skipItem(skipping.id, reason);
              else await renovationApi.skipTask(skipping.id, reason);
            } catch (e) {
              throw new Error(errorText(e));
            }
            setSkipping(null);
            setNotice({ tone: "ok", text: `${skipping.label} skipped. The reason is recorded.` });
            q.reload();
          }}
        />
      )}
    </div>
  );
}

function SummaryStrip({ d }: { d: ProjectDetail }) {
  const cell = (label: string, value: ReactNode) => (
    <div className="min-w-0"><div className="text-xs text-ink-secondary">{label}</div><div className="text-sm text-ink truncate">{value}</div></div>
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 rounded-lg border border-border bg-surface p-3 mb-3">
      {cell("Sales order", d.so ? `${d.so.doc_no} · ${d.so.status.replace(/^RENO_/, "").toLowerCase()}` : "Not yet")}
      {cell("Furniture", <Pill tone={supplyTone(d.conditions.furniture?.condition)}>{supplyLabel(d.conditions.furniture?.condition)}</Pill>)}
      {cell("Reno items", <Pill tone={supplyTone(d.conditions.renoItem?.condition)}>{supplyLabel(d.conditions.renoItem?.condition)}</Pill>)}
      {cell("Payment", d.payment.label)}
      {cell("Unit key", UNIT_KEY_LABEL[d.unitKey])}
      {cell("Planned handover", shortDate(d.project.planned_handover_date))}
    </div>
  );
}

function BillingPromptBanner({ d, canWrite, onDone, onError }: { d: ProjectDetail; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [confirming, setConfirming] = useState<null | ProjectDetail["prompts"][number]>(null);
  const [date, setDate] = useState(() => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  if (!d.billing.available) {
    return <div className="mb-3 rounded-md border border-border bg-surface-dim px-3 py-2 text-sm text-ink-secondary">Customer billing is not available yet, so no instalment can be billed from here and the hardware gate stays closed.</div>;
  }
  if (d.prompts.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {d.prompts.map((pr) => (
        <div key={pr.instalmentId} className="flex flex-wrap items-center justify-between gap-2 py-1">
          <div className="text-sm">
            <span className="font-semibold text-ink">Instalment {pr.seq}: {pr.label}</span>
            {pr.description && <span className="text-ink-secondary"> · {pr.description}</span>}
            {pr.dueSen != null && <span className="text-ink-secondary"> · {money(pr.dueSen)}</span>}
            {!pr.actionable && <span className="text-ink-secondary"> · waiting for the earlier instalment</span>}
          </div>
          {pr.actionable && canWrite && <Button onClick={() => setConfirming(pr)}>Bill instalment {pr.seq}</Button>}
        </div>
      ))}
      {confirming && d.so && (
        <Dialog
          title={`Bill instalment ${confirming.seq}`}
          onClose={() => setConfirming(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await renovationApi.bill(d.so!.doc_no, confirming.instalmentId, confirming.dueSen, date);
                setConfirming(null);
                onDone(`Instalment ${confirming.seq} billed.`);
              } catch (e) {
                onError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}>{busy ? "Billing..." : "Issue progress invoice"}</Button>
          </>}
        >
          <p className="text-sm text-ink-secondary mb-3">A progress invoice for {confirming.label}{confirming.dueSen != null ? ` (${money(confirming.dueSen)})` : ""} will be issued to the customer.</p>
          <Field label="Invoice date"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </Dialog>
      )}
    </div>
  );
}

function GateCard({ d }: { d: ProjectDetail }) {
  const hw = d.stages.find((s) => s.key === "hardware");
  if (!hw || hw.state === "skipped" || hw.state === "done") return null;
  return (
    <section className={cn("mb-3 rounded-lg border p-3", d.gate.open ? "border-synced/30 bg-synced-bg" : "border-warning-text/20 bg-warning-bg")}>
      <h3 className={cn("text-sm font-semibold flex items-center gap-1", d.gate.open ? "text-synced" : "text-warning-text")}>
        {d.gate.open ? <Unlock size={14} /> : <Lock size={14} />}
        {d.gate.open ? "Hardware works may start" : "Hardware works cannot start yet"}
      </h3>
      {!d.gate.open && <ul className="mt-1 list-disc pl-5 text-sm text-warning-text">{d.gate.messages.map((m) => <li key={m}>{m}</li>)}</ul>}
    </section>
  );
}

function stageIcon(s: StageView) {
  if (s.state === "done") return <CheckCircle2 size={16} className="text-synced" />;
  if (s.state === "skipped") return <MinusCircle size={16} className="text-ink-secondary" />;
  if (s.state === "in_progress") return <Circle size={16} className="text-primary fill-primary/20" />;
  return <Circle size={16} className="text-ink-secondary" />;
}

export function StageTimeline({ stages, current, selected, onSelect }: { stages: StageView[]; current: StageKey; selected: StageKey; onSelect: (k: StageKey) => void }) {
  return (
    <nav aria-label="Stages" className="rounded-lg border border-border bg-surface p-2">
      <ol className="flex flex-col md:flex-row md:overflow-x-auto gap-1">
        {stages.map((s) => (
          <li key={s.key} className="md:flex-1 md:min-w-[7.5rem]">
            <button
              type="button"
              onClick={() => onSelect(s.key)}
              aria-current={s.key === selected ? "step" : undefined}
              className={cn(
                "w-full flex md:flex-col items-center md:items-start gap-2 md:gap-1 rounded-md px-2 py-2 text-left",
                s.key === selected ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-surface-dim",
                s.state === "skipped" && "opacity-60",
              )}
            >
              <span className="flex items-center gap-1">{stageIcon(s)}<span className="text-xs text-ink-secondary">{s.seq + 1}</span></span>
              <span className={cn("text-sm leading-tight", s.key === current ? "font-semibold text-ink" : "text-ink")}>{s.label}</span>
              <span className="ml-auto md:ml-0 text-xs text-ink-secondary">{STAGE_STATE_LABEL[s.state]}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StagePanel(props: {
  d: ProjectDetail; stage: StageView; canWrite: boolean; busy: boolean;
  onStart: () => void; onComplete: () => void; onSkip: () => void; onUnskip: () => void;
  onPlan: (a: string | null, b: string | null) => void;
  onTick: (item: ChecklistItem, done: boolean) => void; onSkipItem: (item: ChecklistItem) => void; onUnskipItem: (item: ChecklistItem) => void;
}) {
  const { d, stage, canWrite, busy } = props;
  const items = d.checklist.filter((c) => c.stage_key === stage.key);
  const [ps, setPs] = useState(stage.plannedStart ?? "");
  const [pe, setPe] = useState(stage.plannedEnd ?? "");
  const lineById = useMemo(() => new Map((d.lines ?? []).map((l) => [l.soItemId, l])), [d.lines]);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" key={stage.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">{stage.label}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={stageTone(stage.state)}>{STAGE_STATE_LABEL[stage.state]}</Pill>
            {stage.skipSource && <span className="text-ink-secondary">{SKIP_SOURCE_TEXT[stage.skipSource]}{stage.skipReason ? `: ${stage.skipReason}` : ""}</span>}
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {stage.state === "not_started" && <Button disabled={busy} onClick={props.onStart}>Start</Button>}
            {(stage.state === "in_progress" || stage.state === "not_started") && <Button variant="secondary" disabled={busy} onClick={props.onComplete}><Check size={14} className="inline mr-1" />Mark done</Button>}
            {stage.skippable && stage.state !== "skipped" && stage.state !== "done" && <Button variant="ghost" disabled={busy} onClick={props.onSkip}>Skip...</Button>}
            {stage.skipSource === "manual" && <Button variant="secondary" disabled={busy} onClick={props.onUnskip}>Un-skip</Button>}
          </div>
        )}
      </div>

      {stage.state !== "skipped" && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Field label="Planned start"><input type="date" className={inputClass} value={ps} disabled={!canWrite} onChange={(e) => setPs(e.target.value)} /></Field>
          <Field label="Planned end"><input type="date" className={inputClass} value={pe} disabled={!canWrite} onChange={(e) => setPe(e.target.value)} /></Field>
          {canWrite && (ps !== (stage.plannedStart ?? "") || pe !== (stage.plannedEnd ?? "")) && (
            <Button variant="secondary" className="col-span-2 sm:col-span-1" disabled={busy} onClick={() => props.onPlan(ps || null, pe || null)}>Save dates</Button>
          )}
        </div>
      )}

      {stage.pod.total > 0 && (
        <div className="mt-3 text-sm">
          <span className="text-ink-secondary">Proof of delivery: </span>
          <span className={stage.pod.missing.length ? "text-warning-text" : "text-synced"}>{stage.pod.covered} of {stage.pod.total} lines</span>
          {stage.pod.missing.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-ink-secondary">
              {stage.pod.missing.slice(0, 8).map((sid) => { const l = lineById.get(sid); return <li key={sid}>{l ? `${l.room ? `${l.room}: ` : ""}${l.description ?? l.itemCode ?? sid}` : sid}</li>; })}
            </ul>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {items.map((it) => {
            const skipped = !!it.skip_reason;
            const done = it.status === "done";
            return (
              <li key={it.id} className="flex items-start gap-3 py-2">
                <input
                  type="checkbox"
                  aria-label={it.title}
                  className="mt-1 h-4 w-4"
                  checked={done}
                  disabled={!canWrite || busy || skipped}
                  onChange={(e) => props.onTick(it, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", skipped ? "line-through text-ink-secondary" : "text-ink")}>{it.title}</div>
                  {it.evidence_hint && !skipped && <div className="text-xs text-ink-secondary">Evidence: {it.evidence_hint}</div>}
                  {skipped && <div className="text-xs text-ink-secondary">Skipped: {it.skip_reason}</div>}
                </div>
                {canWrite && !done && (skipped
                  ? <button type="button" className="text-xs text-primary" onClick={() => props.onUnskipItem(it)}>Un-skip</button>
                  : it.skippable && <button type="button" className="text-xs text-ink-secondary hover:text-ink" onClick={() => props.onSkipItem(it)}>Skip...</button>)}
                {!it.skippable && !done && <span className="text-xs text-ink-secondary" title="Cannot be skipped">Required</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TradeTasksPanel({ projectId, tasks, canWrite, linesAvailable, onAct, onSkip }: {
  projectId: number; tasks: TaskView[]; canWrite: boolean; linesAvailable: boolean;
  onAct: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; onSkip: (t: TaskView) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">Site tasks</h3>
          <p className="text-xs text-ink-secondary">The order is a suggestion: tasks may overlap and move. Only dates that pass raise a flag.</p>
        </div>
        {canWrite && linesAvailable && <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => onAct(() => renovationApi.syncTasks(projectId), "Tasks updated from the contract.")}>Update from contract</Button>}
      </div>
      {tasks.length === 0 && <p className="mt-3 text-sm text-ink-secondary">No tasks in this stage yet.</p>}
      <ul className="mt-3 space-y-2">
        {tasks.map((t) => <TaskRow key={t.id} t={t} canWrite={canWrite} onAct={onAct} onSkip={() => onSkip(t)} />)}
      </ul>
    </section>
  );
}

function TaskRow({ t, canWrite, onAct, onSkip }: { t: TaskView; canWrite: boolean; onAct: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; onSkip: () => void }) {
  const [s, setS] = useState(t.planned_start ?? "");
  const [e, setE] = useState(t.planned_end ?? "");
  const dirty = s !== (t.planned_start ?? "") || e !== (t.planned_end ?? "");
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{t.label}</div>
          <div className="text-xs text-ink-secondary">
            {t.fulfilment_kind === "internal" ? "Done by our team" : [t.supplier_name ?? "No subcontractor yet", t.po_number].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Pill tone={taskTone(t.status)}>{TASK_STATUS_LABEL[t.status]}</Pill>
      </div>
      {t.status !== "skipped" && t.status !== "done" && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
          <Field label="Start"><input type="date" className={inputClass} value={s} disabled={!canWrite} onChange={(ev) => setS(ev.target.value)} /></Field>
          <Field label="End"><input type="date" className={inputClass} value={e} disabled={!canWrite} onChange={(ev) => setE(ev.target.value)} /></Field>
          {canWrite && dirty && <Button variant="secondary" onClick={() => onAct(() => renovationApi.planTask(t.id, s || null, e || null))}>Save</Button>}
          {canWrite && (
            <div className="flex gap-2 col-span-2 sm:col-span-1">
              {t.state === "open" && <Button variant="secondary" onClick={() => onAct(() => renovationApi.startTask(t.id), `${t.label} started.`)}>Start</Button>}
              {t.fulfilment_kind === "internal" && <Button onClick={() => onAct(() => renovationApi.completeTask(t.id), `${t.label} done.`)}>Done</Button>}
              <Button variant="ghost" onClick={onSkip}>Skip...</Button>
            </div>
          )}
        </div>
      )}
      {t.status === "skipped" && (
        <div className="mt-1 flex items-center justify-between text-xs text-ink-secondary">
          <span>{t.skip_source === "vo_omitted" ? "All its lines were omitted by a variation order" : `Skipped: ${t.skip_reason ?? ""}`}</span>
          {canWrite && t.skip_source === "manual" && <button type="button" className="text-primary" onClick={() => onAct(() => renovationApi.unskipTask(t.id))}>Un-skip</button>}
        </div>
      )}
      {t.fulfilment_kind === "po" && t.status !== "done" && t.status !== "skipped" && <p className="mt-1 text-xs text-ink-secondary">Completes when its purchase order is received on site.</p>}
    </li>
  );
}

function HandoverPanel({ d, canWrite, onAct }: { d: ProjectDetail; canWrite: boolean; onAct: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const snags = d.defects.filter((x) => x.phase === "snag");
  const open = snags.filter((x) => !x.closed_at);
  const [loc, setLoc] = useState("");
  const [desc, setDesc] = useState("");
  const [signer, setSigner] = useState(d.project.customer_name ?? "");
  const [signed, setSigned] = useState(false);
  const [keys, setKeys] = useState("");
  const sigRef = useRef<HTMLCanvasElement | null>(null);
  const projectId = d.project.id;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-ink">Snag list</h3>
        <p className="text-xs text-ink-secondary">Each snag must be fixed within 7 days. The customer signs the handover only when every snag is closed.</p>
        <ul className="mt-2 divide-y divide-border">
          {snags.length === 0 && <li className="py-2 text-sm text-ink-secondary">No snags recorded.</li>}
          {snags.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className={cn(s.closed_at && "line-through text-ink-secondary")}>{s.location ? `${s.location}: ` : ""}{s.item_description}{s.due_date && !s.closed_at ? ` · fix by ${shortDate(s.due_date)}` : ""}</span>
              {canWrite && !s.closed_at && <Button variant="secondary" onClick={() => onAct(() => renovationApi.closeSnag(s.id), "Snag closed.")}>Close</Button>}
            </li>
          ))}
        </ul>
        {canWrite && !d.handover && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2">
            <input className={inputClass} placeholder="Room" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Snag room" />
            <input className={inputClass} placeholder="What needs fixing" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Snag description" />
            <Button variant="secondary" disabled={!desc.trim()} onClick={() => onAct(async () => { await renovationApi.addSnag(projectId, { location: loc, description: desc }); setLoc(""); setDesc(""); }, "Snag added.")}>Add snag</Button>
          </div>
        )}
      </div>
      <div className="border-t border-border pt-4">
        <h3 className="text-base font-semibold text-ink">Handover form</h3>
        {d.handover
          ? <p className="mt-1 text-sm text-synced">Signed by {d.handover.customer_signer_name} on {shortDate(d.handover.signed_at)}.</p>
          : open.length > 0
            ? <p className="mt-1 text-sm text-warning-text">{open.length} snag{open.length === 1 ? "" : "s"} still open, so the customer cannot sign yet.</p>
            : canWrite && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Customer name"><input className={inputClass} value={signer} onChange={(e) => setSigner(e.target.value)} /></Field>
                  <Field label="Keys returned"><input className={inputClass} inputMode="numeric" value={keys} onChange={(e) => setKeys(e.target.value.replace(/\D/g, ""))} /></Field>
                </div>
                <SignaturePad canvasRef={sigRef} onChange={setSigned} label="Customer signature" />
                <Button disabled={!signed || !signer.trim()} onClick={() => onAct(async () => {
                  const blob = await canvasBlob(sigRef.current!);
                  const { key } = await renovationApi.upload(projectId, "handover-signature", blob);
                  await renovationApi.handover(projectId, { customerSignerName: signer.trim(), customerSignatureR2Key: key, keysReturned: keys ? Number(keys) : null });
                }, "Handover signed.")}>Sign handover</Button>
              </div>
            )}
      </div>
    </section>
  );
}

function WarrantyPanel({ d }: { d: ProjectDetail }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-semibold text-ink">Warranty: service cases</h3>
      {d.serviceCases.length === 0
        ? <p className="mt-2 text-sm text-ink-secondary">No complaints since handover.</p>
        : <ul className="mt-2 divide-y divide-border">{d.serviceCases.map((c) => <li key={c.id} className="py-2 text-sm"><Link className="text-primary" to={`/assr?case=${c.id}`}>{c.assr_no}</Link> · {c.status ?? "-"} · {c.complaint_issue ?? ""}</li>)}</ul>}
    </section>
  );
}

function EvidenceGallery({ projectId }: { projectId: number }) {
  const q = useQuery(["renovation", "pod", projectId], () => renovationApi.pod(projectId), [projectId]);
  const [big, setBig] = useState<string | null>(null);
  const rooms = q.data?.rooms ?? [];
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Proof of delivery by room</h3>
        <Button variant="secondary" icon={<Printer size={14} />} onClick={() => void api.openHtml(`/api/renovation/${projectId}/pod/print`)}>Print note</Button>
      </div>
      {q.loading && <p className="mt-2 text-sm text-ink-secondary">Loading photos...</p>}
      {!q.loading && rooms.length === 0 && <p className="mt-2 text-sm text-ink-secondary">No site receipt photos yet.</p>}
      {rooms.map((g) => (
        <div key={g.room} className="mt-3">
          <div className="text-sm font-medium text-ink">{g.room} <span className="text-ink-secondary font-normal">({g.photos.length})</span></div>
          <div className="mt-1 grid grid-cols-3 sm:grid-cols-5 gap-2">
            {g.photos.map((ph) => (
              <AuthImage key={ph.id} path={renovationApi.fileUrl(projectId, ph.r2_key)} alt={`${g.room} ${ph.kind}`} className="h-20 w-full rounded" onClick={() => setBig(ph.r2_key)} />
            ))}
          </div>
        </div>
      ))}
      {big && (
        <Dialog title="Photo" onClose={() => setBig(null)}>
          <AuthImage path={renovationApi.fileUrl(projectId, big)} alt="Proof of delivery" className="w-full rounded" />
        </Dialog>
      )}
    </section>
  );
}

function LinkedDocuments({ d }: { d: ProjectDetail }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold text-ink">Documents</h3>
      <dl className="mt-2 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-secondary">Sales order</dt>
          <dd>{d.so ? <Link className="text-primary" to={`/scm/sales-orders/${encodeURIComponent(d.so.doc_no)}`}>{d.so.doc_no}</Link> : "Not converted yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-secondary">Purchase orders</dt>
          <dd>{d.purchaseOrders.length === 0 ? "None yet" : (
            <ul>{d.purchaseOrders.map((po) => <li key={po.id}><Link className="text-primary" to={`/scm/purchase-orders/${po.id}`}>{po.po_number}</Link> · {po.supplier_name ?? "-"}{po.received ? " · received" : ""}</li>)}</ul>
          )}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-secondary">Receipts</dt>
          <dd>{d.receipts.length === 0 ? "None yet" : (
            <ul>{d.receipts.map((g) => <li key={g.id}><Link className="text-primary" to={`/scm/grns/${g.id}`}>{g.grn_number}</Link>{g.received_at_site ? " · on site" : ""}{g.site_received_at ? ` · ${shortDate(g.site_received_at)}` : ""}</li>)}</ul>
          )}</dd>
        </div>
      </dl>
    </section>
  );
}
