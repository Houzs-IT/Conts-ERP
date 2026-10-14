/* Design, the project's main task (owner, 14 Oct 2026), in its order:
   1 Onsite (site measure: date + PIC), there from the day the project is created;
   2 3D: each submission is a link with its submit date, the 3D PIC (who drew it)
     and the 2D PIC (who will draw the 2D), plus a change-notes log;
   3 2D: submissions by link or uploaded file, date, PIC, plus its own notes log.
   Every step shows its latest entry; "History" opens the full list and an add row.
   Reads /design-records (site measures, design files, design notes). */

import { useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, Ruler, Upload } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type DesignFile, type DesignNote, type SiteMeasure } from "./simpleApi";
import { errorText, shortDate } from "./renovationModel";
import { AuthImage, Dialog, smallBtn, smallInput } from "./renovationUi";
import { PersonSelect } from "./PersonSelect";
import { Card, todayMyt } from "./ProjectRecords";

type StepKey = "onsite" | "3d" | "2d";
type Run = (fn: () => Promise<unknown>, text: string) => Promise<boolean>;

const submittedOf = (f: DesignFile) => f.submitted_on ?? f.uploaded_at;

export function DesignTaskCard({ projectId, canWrite, onDone, onError }: {
  projectId: number; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const q = useQuery(["renovation", "design", projectId], () => simpleApi.designRecords(projectId), [projectId]);
  const [open, setOpen] = useState<StepKey | null>(null);
  const [view, setView] = useState<DesignFile | null>(null);
  const [busy, setBusy] = useState(false);
  const measures = q.data?.measures ?? [];
  const files = q.data?.files ?? [];
  const notes = q.data?.notes ?? [];
  const threeD = files.filter((f) => f.kind === "3d");
  const twoD = files.filter((f) => f.kind === "2d" || f.kind === "other");

  const run: Run = async (fn, text) => {
    setBusy(true);
    try { await fn(); q.reload(); onDone(text); return true; } catch (e) { onError(errorText(e)); return false; } finally { setBusy(false); }
  };
  const toggle = (k: StepKey) => setOpen((cur) => (cur === k ? null : k));
  const openFile = (f: DesignFile) => (f.external_url ? window.open(f.external_url, "_blank", "noopener") : setView(f));

  return (
    <Card title="Design" icon={<Ruler size={14} />}>
      {q.loading && !q.data ? <p className="text-xs text-ink-secondary">Loading design...</p> : (
        <ol className="space-y-1">
          <Step n={1} label="Onsite" done={measures.length > 0} last={false} open={open === "onsite"} count={measures.length} onToggle={() => toggle("onsite")}
            summary={measures[0] ? <>{shortDate(measures[0].done_on)} · {measures[0].person_name ?? "PIC not set"}</> : <span className="text-ink-secondary">Not measured yet</span>}>
            <OnsiteHistory projectId={projectId} measures={measures} canWrite={canWrite} busy={busy} run={run} />
          </Step>
          <Step n={2} label="3D" done={threeD.length > 0} last={false} open={open === "3d"} count={threeD.length} onToggle={() => toggle("3d")}
            summary={threeD[0] ? <FileLine f={threeD[0]} onOpen={openFile} showNext /> : <span className="text-ink-secondary">No submission yet</span>}>
            <FileHistory kind="3d" projectId={projectId} files={threeD} canWrite={canWrite} busy={busy} run={run} onOpen={openFile} />
            <NotesLog kind="3d" projectId={projectId} notes={notes.filter((n) => n.kind === "3d")} canWrite={canWrite} busy={busy} run={run} />
          </Step>
          <Step n={3} label="2D" done={twoD.some((f) => f.kind === "2d")} last open={open === "2d"} count={twoD.length} onToggle={() => toggle("2d")}
            summary={twoD[0] ? <FileLine f={twoD[0]} onOpen={openFile} /> : <span className="text-ink-secondary">No submission yet</span>}>
            <FileHistory kind="2d" projectId={projectId} files={twoD} canWrite={canWrite} busy={busy} run={run} onOpen={openFile} />
            <NotesLog kind="2d" projectId={projectId} notes={notes.filter((n) => n.kind === "2d")} canWrite={canWrite} busy={busy} run={run} />
          </Step>
        </ol>
      )}
      {view?.r2_key && (
        <Dialog title={`v${view.version} ${view.file_name}`} onClose={() => setView(null)}>
          {/\.(png|jpe?g|webp)$/i.test(view.r2_key)
            ? <AuthImage path={simpleApi.fileUrl(projectId, view.r2_key)} alt={view.file_name} className="w-full rounded" />
            : <p className="text-sm"><a className="text-primary" href={simpleApi.fileUrl(projectId, view.r2_key)} target="_blank" rel="noopener">Open the file</a></p>}
        </Dialog>
      )}
    </Card>
  );
}

function Step({ n, label, done, last, open, count, onToggle, summary, children }: {
  n: number; label: string; done: boolean; last: boolean; open: boolean; count: number; onToggle: () => void; summary: ReactNode; children: ReactNode;
}) {
  return (
    <li className="relative pl-7">
      {!last && <span aria-hidden className="absolute left-[9px] top-6 bottom-[-4px] w-px bg-border" />}
      <span className={cn("absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
        done ? "border-synced bg-synced-bg text-synced" : "border-border bg-surface text-ink-secondary")}>
        {done ? <Check size={11} /> : n}
      </span>
      <div className="flex min-h-6 flex-wrap items-baseline gap-x-2 gap-y-0.5 pb-1">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="min-w-0 flex-1 text-xs text-ink">{summary}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} className="shrink-0 text-xs text-primary hover:underline">
          {open ? "Hide" : `History (${count})`}
        </button>
      </div>
      {open && <div className="mb-2 space-y-3 rounded-md border border-border bg-surface-dim/50 p-2">{children}</div>}
    </li>
  );
}

function FileLine({ f, onOpen, showNext }: { f: DesignFile; onOpen: (f: DesignFile) => void; showNext?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <button type="button" className="inline-flex max-w-[11rem] items-baseline sm:max-w-[16rem] gap-1 truncate text-left text-primary hover:underline" onClick={() => onOpen(f)} title={f.external_url ?? f.file_name}>
        {f.kind === "other" ? "Other " : ""}v{f.version}{f.external_url ? <ExternalLink size={10} className="self-center" /> : null} <span className="truncate">{f.file_name}</span>
      </button>
      <span className="text-ink-secondary">
        · {shortDate(submittedOf(f))} · {f.kind === "3d" ? "3D PIC " : "PIC "}{f.person_name ?? "-"}{showNext ? ` · 2D PIC ${f.next_person_name ?? "-"}` : ""}
      </span>
    </span>
  );
}

function OnsiteHistory({ projectId, measures, canWrite, busy, run }: { projectId: number; measures: SiteMeasure[]; canWrite: boolean; busy: boolean; run: Run }) {
  const [on, setOn] = useState(todayMyt());
  const [pic, setPic] = useState<number | null>(null);
  return (
    <div>
      {canWrite && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
          <input type="date" aria-label="Onsite date" className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
          <PersonSelect label="Onsite PIC" placeholder="PIC" value={pic} onChange={setPic} className={smallInput} />
          <Button variant="secondary" className={cn(smallBtn, "col-span-2 sm:col-span-1")} disabled={busy || !on}
            onClick={async () => { if (await run(() => simpleApi.addSiteMeasure(projectId, { doneOn: on, personId: pic }), "Onsite recorded.")) setPic(null); }}>Add</Button>
        </div>
      )}
      <MiniTable empty="No site measure recorded." head={["Date", "PIC", "Note"]}
        rows={measures.map((m) => ({ key: m.id, cells: [shortDate(m.done_on), m.person_name ?? "-", m.note ?? ""] }))} />
    </div>
  );
}

function FileHistory({ kind, projectId, files, canWrite, busy, run, onOpen }: {
  kind: "3d" | "2d"; projectId: number; files: DesignFile[]; canWrite: boolean; busy: boolean; run: Run; onOpen: (f: DesignFile) => void;
}) {
  const [url, setUrl] = useState("");
  const [on, setOn] = useState(todayMyt());
  const [pic, setPic] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const reset = () => { setUrl(""); setPic(null); setNext(null); };
  const label = kind === "3d" ? "3D" : "2D";
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{label} submissions</div>
      {canWrite && (
        <div className={cn("grid grid-cols-2 gap-1", kind === "3d"
          ? "sm:grid-cols-[minmax(0,2fr)_8.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
          : "sm:grid-cols-[minmax(0,2fr)_8.5rem_minmax(0,1fr)_auto_auto]")}>
          <input type="url" aria-label={`${label} link`} placeholder="https://..." className={cn(smallInput, "col-span-2 sm:col-span-1")} value={url} onChange={(e) => setUrl(e.target.value)} />
          <input type="date" aria-label={`${label} submit date`} className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
          <PersonSelect label={`${label} PIC`} placeholder={`${label} PIC`} value={pic} onChange={setPic} className={smallInput} />
          {kind === "3d" && <PersonSelect label="2D PIC" placeholder="2D PIC" value={next} onChange={setNext} className={smallInput} />}
          <Button variant="secondary" className={smallBtn} disabled={busy || !/^https?:\/\/\S+/i.test(url.trim()) || !on}
            onClick={async () => {
              if (await run(() => simpleApi.addDesignLink(projectId, { kind, url: url.trim(), submittedOn: on, personId: pic, nextPersonId: kind === "3d" ? next : null }), `${label} submission added.`)) reset();
            }}>Add link</Button>
          {kind === "2d" && (
            <>
              <Button variant="secondary" className={smallBtn} icon={<Upload size={12} />} disabled={busy || !on} onClick={() => fileRef.current?.click()}>Upload</Button>
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.zip" aria-label="2D file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void run(() => simpleApi.uploadDesignFile(projectId, "2d", f, pic, null, { submittedOn: on }), `${f.name} uploaded.`).then((ok) => { if (ok) reset(); });
                }} />
            </>
          )}
        </div>
      )}
      <MiniTable empty={`No ${label} submission yet.`} head={kind === "3d" ? ["Version", "Submitted", "3D PIC", "2D PIC"] : ["Version", "Submitted", "PIC", "By"]}
        rows={files.map((f) => ({
          key: f.id,
          cells: [
            <button key="v" type="button" className="block max-w-[8rem] truncate text-left sm:max-w-[14rem] text-primary hover:underline" title={f.external_url ?? f.file_name} onClick={() => onOpen(f)}>
              {f.kind === "other" ? "Other " : ""}v{f.version} {f.file_name}
            </button>,
            shortDate(submittedOf(f)),
            f.person_name ?? "-",
            kind === "3d" ? f.next_person_name ?? "-" : f.uploaded_by_name ?? "-",
          ],
        }))} />
    </div>
  );
}

function NotesLog({ kind, projectId, notes, canWrite, busy, run }: { kind: "3d" | "2d"; projectId: number; notes: DesignNote[]; canWrite: boolean; busy: boolean; run: Run }) {
  const [on, setOn] = useState(todayMyt());
  const [who, setWho] = useState<number | null>(null);
  const [whoText, setWhoText] = useState("");
  const [note, setNote] = useState("");
  const label = kind === "3d" ? "3D" : "2D";
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{label} notes</div>
      {canWrite && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-[8.5rem_minmax(13rem,1.2fr)_minmax(0,2fr)_auto]">
          <input type="date" aria-label={`${label} note date`} className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
          {who === null
            ? (
              <div className="col-span-2 flex min-w-0 gap-1 sm:col-span-1">
                <div className="min-w-0 flex-1"><PersonSelect label="Requested by" placeholder="Requested by" value={who} onChange={setWho} className={smallInput} /></div>
                <input aria-label="Requested by (not in the list)" placeholder="or name" className={cn(smallInput.replace("w-full", "w-24"), "shrink-0")} value={whoText} onChange={(e) => setWhoText(e.target.value)} />
              </div>
            )
            : <div className="col-span-2 min-w-0 sm:col-span-1"><PersonSelect label="Requested by" placeholder="Requested by" value={who} onChange={setWho} className={smallInput} /></div>}
          <input aria-label={`${label} change to make`} placeholder="What to change" className={cn(smallInput, "col-span-2 sm:col-span-1")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="secondary" className={cn(smallBtn, "col-span-2 sm:col-span-1")} disabled={busy || !note.trim() || !on}
            onClick={async () => {
              const ok = await run(() => simpleApi.addDesignNote(projectId, { kind, notedOn: on, requestedByPersonId: who, requestedByText: who ? null : whoText.trim() || null, note: note.trim() }), `${label} note added.`);
              if (ok) { setNote(""); setWho(null); setWhoText(""); }
            }}>Add note</Button>
        </div>
      )}
      <MiniTable empty={`No ${label} notes.`} head={["Date", "Requested by", "Change"]}
        rows={notes.map((n) => ({ key: n.id, cells: [shortDate(n.noted_on), n.requested_by_person_name ?? n.requested_by_text ?? "-", n.note] }))} />
    </div>
  );
}

function MiniTable({ head, rows, empty }: { head: string[]; rows: Array<{ key: number; cells: ReactNode[] }>; empty: string }) {
  if (rows.length === 0) return <p className="mt-1 text-[11px] text-ink-secondary">{empty}</p>;
  return (
    <div className="mt-1 max-h-60 overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-surface-dim text-left text-ink-secondary">
          <tr>{head.map((h) => <th key={h} className="py-1 pr-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => <tr key={r.key}>{r.cells.map((c, i) => <td key={i} className={cn("py-1 pr-2 align-top text-ink", i === 0 && "whitespace-nowrap")}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
