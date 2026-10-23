/* Beta workspace > Defects: report a problem with a photo, then follow each one across To fix, Check it and Done.
   Photos go up through the existing project file upload; the key is sent with the defect. */

import { useState, type FormEvent } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { useDialog } from "../../hooks/useDialog";
import { cn } from "../../lib/utils";
import { Card } from "../projects/renovation/ProjectRecords";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText, shortDate } from "../projects/renovation/renovationModel";
import { AuthImage, Dialog, Field, Pill, inputClass, smallBtn } from "../projects/renovation/renovationUi";
import { sendReminder, tradeLabel, TRADE_LABEL, type BetaTabProps } from "./betaShared";
import { BETA_TRADES, betaApi, type BetaDefect, type BetaTrade } from "./renovationBetaApi";
import { defectDaysLate, groupDefects, snagProgress, type DefectColumn } from "./renovationBetaModel";

const COLUMNS: ReadonlyArray<{ key: DefectColumn; title: string; empty: string }> = [
  { key: "to_fix", title: "To fix", empty: "Nothing waiting to be fixed." },
  { key: "check", title: "Check it", empty: "Nothing waiting for a check." },
  { key: "done", title: "Done", empty: "No closed defects yet." },
];

type Step = { type: "fixed" | "redo"; defect: BetaDefect };

export function BetaDefectsTab(p: BetaTabProps) {
  const dialog = useDialog();
  const { workspace, canWrite, projectId, today } = p;
  const [reporting, setReporting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = groupDefects(workspace.defects);
  const { closed, total } = snagProgress(workspace.defects);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); p.onDone(ok); } catch (e) { p.onError(errorText(e)); } finally { setBusy(false); }
  }
  async function close(d: BetaDefect) {
    const ok = await dialog.confirm({ title: "Close this defect?", message: `${d.location ?? "Defect"}: ${d.description ?? ""}`, confirmLabel: "OK, close" });
    if (ok) await act(() => betaApi.defectClose(d.id), "Defect closed.");
  }
  function remind(d: BetaDefect) {
    const late = defectDaysLate(d, today);
    const where = d.location ?? "the unit";
    const text = `Defect to fix at ${where} (${p.detail.project.name}): ${d.description ?? "see the project"}.${d.dueDate ? ` Fix by ${shortDate(d.dueDate)}${late > 0 ? `, now ${late} day${late === 1 ? "" : "s"} late` : ""}.` : ""} Please fix it and tell us when it is done.`;
    void sendReminder(projectId, { kind: "defect", text, phone: null }, p.onDone, p.onError);
  }

  return (
    <div className="space-y-4">
      <Card
        title="Defects"
        icon={<AlertTriangle size={14} />}
        actions={canWrite && !reporting ? <Button variant="secondary" className={smallBtn} icon={<Plus size={12} />} onClick={() => setReporting(true)}>Report a problem</Button> : undefined}
      >
        <p className="text-sm text-ink-secondary" data-testid="snag-progress">
          <span className="font-medium text-ink">{closed} of {total}</span> snags closed. Every snag must be closed before the handover.
        </p>
        {reporting && <ReportForm p={p} onClose={() => setReporting(false)} />}
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <section key={c.key} aria-label={c.title} className="min-w-0 rounded-lg border border-border bg-surface-dim p-2">
            <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-ink">{c.title}<span className="text-xs font-normal text-ink-secondary">{groups[c.key].length}</span></h3>
            {groups[c.key].length === 0 ? <p className="px-1 py-2 text-xs text-ink-secondary">{c.empty}</p> : (
              <ul className="space-y-2">
                {groups[c.key].map((d) => (
                  <DefectCard key={d.id} d={d} column={c.key} p={p} busy={busy}
                    onFixed={() => setStep({ type: "fixed", defect: d })} onRedo={() => setStep({ type: "redo", defect: d })}
                    onClose={() => void close(d)} onRemind={() => remind(d)} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {step?.type === "fixed" && <FixedDialog p={p} defect={step.defect} onClose={() => setStep(null)} />}
      {step?.type === "redo" && <RedoDialog p={p} defect={step.defect} onClose={() => setStep(null)} />}
    </div>
  );
}

function DefectCard({ d, column, p, busy, onFixed, onRedo, onClose, onRemind }: {
  d: BetaDefect; column: DefectColumn; p: BetaTabProps; busy: boolean; onFixed: () => void; onRedo: () => void; onClose: () => void; onRemind: () => void;
}) {
  const late = defectDaysLate(d, p.today);
  const what = `${d.location ?? "Defect"}: ${d.description ?? ""}`;
  const trade = tradeLabel(d.trade);
  return (
    <li className="rounded-md border border-border bg-surface p-2 text-sm">
      <div className="flex gap-2">
        {d.photoKey && <AuthImage path={renovationApi.fileUrl(p.projectId, d.photoKey)} alt={`Photo of the problem at ${d.location ?? "the unit"}`} className="h-16 w-16 shrink-0 rounded" />}
        {d.afterPhotoKey && <AuthImage path={renovationApi.fileUrl(p.projectId, d.afterPhotoKey)} alt={`Photo after the fix at ${d.location ?? "the unit"}`} className="h-16 w-16 shrink-0 rounded" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink [overflow-wrap:anywhere]">{d.location ?? "No area given"}</div>
          <div className="text-ink-secondary [overflow-wrap:anywhere]">{d.description}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {trade && <Pill tone="info">{trade}</Pill>}
        {d.redoCount > 0 && <Pill tone="warn">Redone {d.redoCount} {d.redoCount === 1 ? "time" : "times"}</Pill>}
        {late > 0 && <Pill tone="err">{late} day{late === 1 ? "" : "s"} late</Pill>}
        {d.dueDate && <span className={cn("text-ink-secondary", late > 0 && "text-err")}>Fix by {shortDate(d.dueDate)}</span>}
      </div>
      <div className="mt-1 text-xs text-ink-secondary">
        {d.reportedAt ? `Reported ${shortDate(d.reportedAt)}` : "Reported"}{d.reportedByName && ` by ${d.reportedByName}`}
        {column !== "to_fix" && d.fixedAt && ` · fixed ${shortDate(d.fixedAt)}`}
        {column === "done" && d.closedAt && ` · closed ${shortDate(d.closedAt)}`}
      </div>
      {p.canWrite && column !== "done" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {column === "to_fix" && <>
            <Button className={smallBtn} disabled={busy} onClick={onFixed}>Fixed<span className="sr-only">: {what}</span></Button>
            <Button variant="secondary" className={smallBtn} disabled={busy} onClick={onRemind}>Remind<span className="sr-only">: {what}</span></Button>
          </>}
          {column === "check" && <>
            <Button className={smallBtn} disabled={busy} onClick={onClose}>OK, close<span className="sr-only">: {what}</span></Button>
            <Button variant="secondary" className={smallBtn} disabled={busy} onClick={onRedo}>Redo<span className="sr-only">: {what}</span></Button>
          </>}
        </div>
      )}
    </li>
  );
}

function ReportForm({ p, onClose }: { p: BetaTabProps; onClose: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [trade, setTrade] = useState<BetaTrade | "">("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!photo) { setError("Add a photo of the problem."); return; }
    if (!description.trim()) { setError("Say what is wrong."); return; }
    setBusy(true);
    setError(null);
    try {
      const { key } = await renovationApi.upload(p.projectId, "defect", photo);
      await betaApi.reportDefect(p.projectId, {
        location: location.trim() || null,
        description: description.trim(),
        trade: trade || null,
        dueDate: dueDate || null,
        photoKey: key,
      });
      p.onDone("Defect reported.");
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-3 rounded-md border border-border bg-surface-dim p-3" aria-label="Report a problem">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Photo of the problem (required)">
          <input type="file" accept="image/*" className={inputClass} onChange={(e) => setPhoto(e.target.files?.item(0) ?? null)} />
        </Field>
        <Field label="Area (for example Kitchen)"><input className={inputClass} value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <Field label="What is wrong"><textarea className={inputClass} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <Field label="Who fixes it">
          <select className={inputClass} value={trade} onChange={(e) => setTrade(BETA_TRADES.find((t) => t === e.target.value) ?? "")}>
            <option value="">Not decided</option>
            {BETA_TRADES.map((t) => <option key={t} value={t}>{TRADE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Fix by"><input type="date" className={inputClass} value={dueDate} min={p.today} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </div>
      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Report problem"}</Button>
      </div>
    </form>
  );
}

function FixedDialog({ p, defect, onClose }: { p: BetaTabProps; defect: BetaDefect; onClose: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const key = photo ? (await renovationApi.upload(p.projectId, "defect", photo)).key : null;
      await betaApi.defectFixed(defect.id, key);
      p.onDone("Marked as fixed. It now waits for a check.");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog title="Mark as fixed" onClose={onClose} footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Mark as fixed"}</Button>
      </>
    }>
      <p className="mb-3 text-sm text-ink-secondary [overflow-wrap:anywhere]">{defect.location ?? "Defect"}: {defect.description}</p>
      <Field label="Photo after the fix (optional)"><input type="file" accept="image/*" className={inputClass} onChange={(e) => setPhoto(e.target.files?.item(0) ?? null)} /></Field>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}

function RedoDialog({ p, defect, onClose }: { p: BetaTabProps; defect: BetaDefect; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await betaApi.defectRedo(defect.id, note.trim() || null);
      p.onDone("Sent back to To fix.");
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Dialog title="Redo this fix" onClose={onClose} footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving..." : "Send back to To fix"}</Button>
      </>
    }>
      <p className="mb-3 text-sm text-ink-secondary [overflow-wrap:anywhere]">{defect.location ?? "Defect"}: {defect.description}</p>
      <Field label="What is still wrong (optional)"><textarea className={inputClass} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}
