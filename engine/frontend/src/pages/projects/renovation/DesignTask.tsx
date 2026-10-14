/* Design, the project's main task (owner, 14 Oct 2026), in its order:
   1 Onsite: entries with a date, several PICs, a remark and photos / files;
   2 3D: link submissions with the submit date, several 3D PICs and the 2D PIC, plus a notes log;
   3 2D: versions V1, V2... (link or file, date, PIC). A 2D amendment request puts 2D in Amending; the next
     version answers every open request.
   The whole step row opens or closes it (several may be open); the current step opens by default. Each list
   shows its history first; its add form opens from a "+" button (open from the start only while the list is
   empty), prefills the PICs of the latest entry, and closes after saving or Cancel. Every row can be edited.
   Reads /design-records (site measures, design files, design notes). */

import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Paperclip, Pencil, Plus, Ruler, Upload } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type DesignFile, type DesignNote, type NamedRef, type SiteMeasure } from "./simpleApi";
import { errorText, shortDate } from "./renovationModel";
import { AuthImage, Dialog, Pill, smallBtn, smallInput } from "./renovationUi";
import { PersonMultiSelect, PersonSelect } from "./PersonSelect";
import { Card, todayMyt } from "./ProjectRecords";
import { currentDesignStep, designStatus, twoDTimeline, type DesignStepKey } from "./designModel";

type Run = (fn: () => Promise<unknown>, text: string) => Promise<boolean>;
type Openable = { external_url?: string | null; r2_key: string | null; file_name: string };
type Shared = { projectId: number; canWrite: boolean; busy: boolean; run: Run; onOpen: (f: Openable) => void };

const submittedOf = (f: DesignFile) => f.submitted_on ?? f.uploaded_at;
const names = (people: NamedRef[] | undefined, fallback: string | null) =>
  people && people.length ? people.map((p) => p.name).join(", ") : fallback;
const filePics = (f: DesignFile) => names(f.people, f.person_name) ?? "-";
const picIds = (people: NamedRef[] | undefined, single: number | null | undefined): number[] =>
  people && people.length ? people.map((p) => p.id) : single ? [single] : [];
const isLink = (s: string) => /^https?:\/\/\S+/i.test(s.trim());

export function DesignTaskCard({ projectId, canWrite, onDone, onError }: {
  projectId: number; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const q = useQuery(["renovation", "design", projectId], () => simpleApi.designRecords(projectId), [projectId]);
  const [open, setOpen] = useState<Set<DesignStepKey> | null>(null);
  const [view, setView] = useState<Openable | null>(null);
  const [busy, setBusy] = useState(false);
  const measures = q.data?.measures ?? [];
  const files = q.data?.files ?? [];
  const notes = q.data?.notes ?? [];
  const threeD = files.filter((f) => f.kind === "3d");
  const twoD = files.filter((f) => f.kind === "2d");
  const others = files.filter((f) => f.kind === "other");
  const timeline = twoDTimeline(twoD, notes.filter((n) => n.kind === "2d"));
  const counts = { onsite: measures.length, threeD: threeD.length, twoD: twoD.length };
  const current = currentDesignStep(counts);
  const openSet = open ?? new Set<DesignStepKey>([current]);
  const status = designStatus(counts, timeline.state);
  const stateOf = (k: DesignStepKey, done: boolean): StepState => (done ? "done" : k === current ? "current" : "todo");

  const run: Run = async (fn, text) => {
    setBusy(true);
    try { await fn(); q.reload(); onDone(text); return true; } catch (e) { onError(errorText(e)); return false; } finally { setBusy(false); }
  };
  const toggle = (k: DesignStepKey) => setOpen(() => {
    const next = new Set(openSet);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const onOpen = (f: Openable) => (f.external_url ? window.open(f.external_url, "_blank", "noopener") : setView(f));
  const shared: Shared = { projectId, canWrite, busy, run, onOpen };

  const m0 = measures.at(0);
  const t0 = threeD.at(0);
  const v0 = timeline.versions.at(0);
  return (
    <Card title="Design" icon={<Ruler size={14} />}
      actions={q.data ? <Pill tone={timeline.state === "amending" ? "warn" : timeline.state === "submitted" ? "ok" : "muted"}>{status}</Pill> : undefined}>
      {q.loading && !q.data ? <p className="text-xs text-ink-secondary">Loading design...</p> : (
        <ol className="space-y-1">
          <Step n={1} label="Onsite" state={stateOf("onsite", measures.length > 0)} last={false} open={openSet.has("onsite")} count={measures.length} onToggle={() => toggle("onsite")}
            summary={m0 ? `${shortDate(m0.done_on)} · ${names(m0.people, m0.person_name) ?? "PIC not set"}${m0.files?.length ? ` · ${m0.files.length} photo${m0.files.length === 1 ? "" : "s"} / file${m0.files.length === 1 ? "" : "s"}` : ""}` : "Not measured yet"}
            muted={!m0}>
            <OnsiteHistory {...shared} measures={measures} />
          </Step>
          <Step n={2} label="3D" state={stateOf("3d", threeD.length > 0)} last={false} open={openSet.has("3d")} count={threeD.length} onToggle={() => toggle("3d")}
            summary={t0 ? `V${t0.version} · ${shortDate(submittedOf(t0))} · 3D: ${filePics(t0)} · 2D: ${t0.next_person_name ?? "-"}` : "No submission yet"} muted={!t0}>
            <ThreeDHistory {...shared} files={threeD} />
            <NotesLog {...shared} kind="3d" title="3D notes" notes={notes.filter((n) => n.kind === "3d")} />
          </Step>
          <Step n={3} label="2D" state={stateOf("2d", timeline.state === "submitted")} last open={openSet.has("2d")} count={twoD.length} onToggle={() => toggle("2d")}
            badge={timeline.state === "amending" ? <Pill tone="warn">Amending · {timeline.openCount} open</Pill> : null}
            summary={v0 ? `V${v0.number} · ${shortDate(submittedOf(v0.file))} · PIC ${filePics(v0.file)}` : "No submission yet"} muted={!v0}>
            <TwoDFlow {...shared} timeline={timeline} others={others} />
          </Step>
        </ol>
      )}
      {view?.r2_key && (
        <Dialog title={view.file_name} onClose={() => setView(null)}>
          {/\.(png|jpe?g|webp)$/i.test(view.r2_key)
            ? <AuthImage path={simpleApi.fileUrl(projectId, view.r2_key)} alt={view.file_name} className="w-full rounded" />
            : <p className="text-sm"><a className="text-primary" href={simpleApi.fileUrl(projectId, view.r2_key)} target="_blank" rel="noopener">Open the file</a></p>}
        </Dialog>
      )}
    </Card>
  );
}

type StepState = "done" | "current" | "todo";

function Step({ n, label, state, last, open, count, onToggle, summary, muted, badge, children }: {
  n: number; label: string; state: StepState; last: boolean; open: boolean; count: number; onToggle: () => void;
  summary: string; muted?: boolean; badge?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="relative">
      {!last && <span aria-hidden className="absolute left-[9px] top-6 bottom-[-4px] w-px bg-border" />}
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="relative flex w-full items-start gap-2 rounded-md py-1 pr-1 text-left hover:bg-surface-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <span aria-label={state === "done" ? "Done" : state === "current" ? "In progress" : "Not started"}
          className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
            state === "done" ? "border-synced bg-synced-bg text-synced" : state === "current" ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink-secondary")}>
          {state === "done" ? <Check size={11} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn("text-sm text-ink", state === "current" ? "font-bold" : "font-semibold")}>{label}</span>
            {badge}
            <span className="ml-auto shrink-0 text-[11px] text-ink-secondary">History ({count})</span>
          </span>
          <span className={cn("block truncate text-xs", muted ? "text-ink-secondary" : "text-ink")}>{summary}</span>
        </span>
        <span className="mt-0.5 shrink-0 text-ink-secondary">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
      </button>
      {open && <div className="mb-2 ml-7 mt-1 space-y-3 rounded-md border border-border bg-surface-dim/50 p-2">{children}</div>}
    </li>
  );
}

/** A list's title with its "+" button; the form below shows while adding (or while the list is still empty). */
function Section({ title, addLabel, canWrite, empty, form, children }: {
  title: string; addLabel: string; canWrite: boolean; empty: boolean; form: (close: () => void, first: boolean) => ReactNode; children: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const showForm = canWrite && (adding || empty);
  // On a phone a form opened from "+" is a bottom sheet; the first-time form (empty list) stays inline.
  const sheet = adding;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{title}</span>
        {canWrite && !showForm && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
            <Plus size={11} />{addLabel}
          </button>
        )}
      </div>
      {showForm && sheet && <div aria-hidden className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setAdding(false)} />}
      {showForm && (
        <div role={sheet ? "dialog" : undefined} aria-label={sheet ? title : undefined}
          className={cn("mb-2 rounded border border-border bg-surface p-1.5",
            sheet && "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mb-0 max-sm:max-h-[80vh] max-sm:overflow-auto max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:p-3 max-sm:shadow-lg")}>
          {sheet && <div className="mb-2 text-sm font-semibold text-ink sm:hidden">{title}</div>}
          {form(() => setAdding(false), empty && !adding)}
        </div>
      )}
      {children}
    </div>
  );
}

function FormButtons({ busy, onCancel, first, children }: { busy: boolean; onCancel: () => void; first: boolean; children: ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {!first && <Button variant="ghost" className={smallBtn} disabled={busy} onClick={onCancel}>Cancel</Button>}
      {children}
    </div>
  );
}

function FileButton({ f, onOpen, label }: { f: Openable; onOpen: (f: Openable) => void; label?: string }) {
  return (
    <button type="button" className="inline-flex max-w-[9rem] items-center gap-1 text-left text-primary hover:underline sm:max-w-[16rem]" title={f.external_url ?? f.file_name} onClick={() => onOpen(f)}>
      {f.external_url ? <ExternalLink size={10} className="shrink-0" /> : <Paperclip size={10} className="shrink-0" />}
      <span className="truncate">{label ?? f.file_name}</span>
    </button>
  );
}

function EditButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="p-0.5 text-ink-secondary hover:text-ink">
      <Pencil size={12} />
    </button>
  );
}

// ── Onsite ───────────────────────────────────────────────────────────────

function OnsiteForm({ init, busy, onSave, onCancel, first, withFiles, saveLabel }: {
  init: { on: string; pics: number[]; remark: string }; busy: boolean; first: boolean; withFiles: boolean; saveLabel: string;
  onSave: (v: { on: string; pics: number[]; remark: string; files: File[] }) => void; onCancel: () => void;
}) {
  const [on, setOn] = useState(init.on);
  const [pics, setPics] = useState(init.pics);
  const [remark, setRemark] = useState(init.remark);
  const [picked, setPicked] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.4fr)]">
        <input type="date" aria-label="Onsite date" className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
        <PersonMultiSelect label="Onsite PIC" placeholder="Add PIC" value={pics} onChange={setPics} className={smallInput} />
        <input aria-label="Onsite remark" placeholder="Remark" className={cn(smallInput, "col-span-2 sm:col-span-1")} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>
      {withFiles && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button variant="secondary" className={smallBtn} icon={<Upload size={12} />} disabled={busy} onClick={() => fileRef.current?.click()}>Photos / files</Button>
          <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,.pdf,.dwg,.zip" aria-label="Onsite photos or files"
            onChange={(e) => { setPicked([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-secondary">{picked.length ? picked.map((f) => f.name).join(", ") : "No file chosen"}</span>
        </div>
      )}
      <FormButtons busy={busy} onCancel={onCancel} first={first}>
        <Button className={smallBtn} disabled={busy || !on} onClick={() => onSave({ on, pics, remark, files: picked })}>{saveLabel}</Button>
      </FormButtons>
    </div>
  );
}

function OnsiteHistory({ projectId, canWrite, busy, run, onOpen, measures }: Shared & { measures: SiteMeasure[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const last = measures.at(0);
  return (
    <Section title="Onsite entries" addLabel="Add onsite" canWrite={canWrite} empty={measures.length === 0}
      form={(close, first) => (
        <OnsiteForm init={{ on: todayMyt(), pics: picIds(last?.people, null), remark: "" }} busy={busy} first={first} withFiles saveLabel="Add"
          onCancel={close}
          onSave={async (v) => {
            const ok = await run(async () => {
              const r = await simpleApi.addSiteMeasure(projectId, { doneOn: v.on, personIds: v.pics, note: v.remark.trim() || null });
              for (const f of v.files) await simpleApi.uploadOnsiteFile(projectId, r.id, f);
            }, v.files.length ? `Onsite recorded with ${v.files.length} file${v.files.length === 1 ? "" : "s"}.` : "Onsite recorded.");
            if (ok) close();
          }} />
      )}>
      <MiniTable empty="No onsite entry yet." head={["Date", "PIC", "Remark", "Files"]} editable={canWrite}
        rows={measures.map((m) => editing === m.id ? {
          key: m.id,
          form: (
            <OnsiteForm init={{ on: m.done_on ?? todayMyt(), pics: picIds(m.people, null), remark: m.note ?? "" }} busy={busy} first={false} withFiles={false} saveLabel="Save"
              onCancel={() => setEditing(null)}
              onSave={async (v) => {
                if (await run(() => simpleApi.editSiteMeasure(m.id, { doneOn: v.on, personIds: v.pics, note: v.remark.trim() || null }), "Onsite entry updated.")) setEditing(null);
              }} />
          ),
        } : {
          key: m.id,
          cells: [
            shortDate(m.done_on),
            names(m.people, m.person_name) ?? "-",
            m.note ?? "",
            <span key="f" className="flex flex-col gap-0.5">{(m.files ?? []).map((f) => <FileButton key={f.id} f={f} onOpen={onOpen} />)}</span>,
          ],
          action: <EditButton label={`Edit onsite entry of ${shortDate(m.done_on)}`} disabled={busy} onClick={() => setEditing(m.id)} />,
        })} />
    </Section>
  );
}

// ── 3D ───────────────────────────────────────────────────────────────────

function ThreeDForm({ init, busy, first, needsLink, saveLabel, onSave, onCancel }: {
  init: { url: string; on: string; pics: number[]; next: number | null }; busy: boolean; first: boolean; needsLink: boolean; saveLabel: string;
  onSave: (v: { url: string; on: string; pics: number[]; next: number | null }) => void; onCancel: () => void;
}) {
  const [url, setUrl] = useState(init.url);
  const [on, setOn] = useState(init.on);
  const [pics, setPics] = useState(init.pics);
  const [next, setNext] = useState(init.next);
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[minmax(0,2fr)_8.5rem_minmax(0,1fr)_minmax(0,1fr)]">
        {needsLink && <input type="url" aria-label="3D link" placeholder="https://..." className={cn(smallInput, "col-span-2 sm:col-span-1")} value={url} onChange={(e) => setUrl(e.target.value)} />}
        <input type="date" aria-label="3D submit date" className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
        <PersonMultiSelect label="3D PIC" placeholder="Add 3D PIC" value={pics} onChange={setPics} className={smallInput} />
        <PersonSelect label="2D PIC" placeholder="2D PIC" value={next} onChange={setNext} className={smallInput} />
      </div>
      <FormButtons busy={busy} onCancel={onCancel} first={first}>
        <Button className={smallBtn} disabled={busy || (needsLink && !isLink(url)) || !on} onClick={() => onSave({ url: url.trim(), on, pics, next })}>{saveLabel}</Button>
      </FormButtons>
    </div>
  );
}

function ThreeDHistory({ projectId, canWrite, busy, run, onOpen, files }: Shared & { files: DesignFile[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const last = files.at(0);
  return (
    <Section title="3D submissions" addLabel="New submission" canWrite={canWrite} empty={files.length === 0}
      form={(close, first) => (
        <ThreeDForm init={{ url: "", on: todayMyt(), pics: picIds(last?.people, last?.person_id), next: last?.next_person_id ?? null }}
          busy={busy} first={first} needsLink saveLabel="Add link" onCancel={close}
          onSave={async (v) => {
            if (await run(() => simpleApi.addDesignLink(projectId, { kind: "3d", url: v.url, submittedOn: v.on, personIds: v.pics, nextPersonId: v.next }), "3D submission added.")) close();
          }} />
      )}>
      <MiniTable empty="No 3D submission yet." head={["Version", "Submitted", "3D PIC", "2D PIC"]} editable={canWrite}
        rows={files.map((f) => editing === f.id ? {
          key: f.id,
          form: (
            <ThreeDForm init={{ url: f.external_url ?? "", on: (f.submitted_on ?? f.uploaded_at).slice(0, 10), pics: picIds(f.people, f.person_id), next: f.next_person_id }}
              busy={busy} first={false} needsLink={!!f.external_url} saveLabel="Save" onCancel={() => setEditing(null)}
              onSave={async (v) => {
                const b = { submittedOn: v.on, personIds: v.pics, nextPersonId: v.next, ...(f.external_url ? { url: v.url } : {}) };
                if (await run(() => simpleApi.editDesignFile(f.id, b), `3D v${f.version} updated.`)) setEditing(null);
              }} />
          ),
        } : {
          key: f.id,
          cells: [<FileButton key="v" f={f} onOpen={onOpen} label={`v${f.version} ${f.file_name}`} />, shortDate(submittedOf(f)), filePics(f), f.next_person_name ?? "-"],
          action: <EditButton label={`Edit 3D v${f.version}`} disabled={busy} onClick={() => setEditing(f.id)} />,
        })} />
    </Section>
  );
}

// ── 2D ───────────────────────────────────────────────────────────────────

function TwoDForm({ init, busy, first, mode, saveLabel, onLink, onFile, onCancel }: {
  init: { url: string; on: string; pic: number | null }; busy: boolean; first: boolean; mode: "new" | "edit-link" | "edit-file"; saveLabel: string;
  onLink: (v: { url: string; on: string; pic: number | null }) => void; onFile?: (v: { file: File; on: string; pic: number | null }) => void; onCancel: () => void;
}) {
  const [url, setUrl] = useState(init.url);
  const [on, setOn] = useState(init.on);
  const [pic, setPic] = useState(init.pic);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const needsLink = mode !== "edit-file";
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[minmax(0,2fr)_8.5rem_minmax(0,1fr)]">
        {needsLink && <input type="url" aria-label="2D link" placeholder="https://..." className={cn(smallInput, "col-span-2 sm:col-span-1")} value={url} onChange={(e) => setUrl(e.target.value)} />}
        <input type="date" aria-label="2D submit date" className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
        <PersonSelect label="2D version PIC" placeholder="PIC" value={pic} onChange={setPic} className={smallInput} />
      </div>
      <FormButtons busy={busy} onCancel={onCancel} first={first}>
        {mode === "new" && onFile && (
          <>
            <Button variant="secondary" className={smallBtn} icon={<Upload size={12} />} disabled={busy || !on} onClick={() => fileRef.current?.click()}>Upload file</Button>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.zip" aria-label="2D file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile({ file: f, on, pic }); }} />
          </>
        )}
        <Button className={smallBtn} disabled={busy || (needsLink && !isLink(url)) || !on} onClick={() => onLink({ url: url.trim(), on, pic })}>{saveLabel}</Button>
      </FormButtons>
    </div>
  );
}

function TwoDFlow({ projectId, canWrite, busy, run, onOpen, timeline, others }: Shared & {
  timeline: ReturnType<typeof twoDTimeline<DesignFile, DesignNote>>; others: DesignFile[];
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const nextNumber = timeline.versions.length + 1;
  const lastVersion = timeline.versions.at(0);
  const last = lastVersion?.file;
  const answers = timeline.openCount ? ` It answers ${timeline.openCount} open amendment request${timeline.openCount === 1 ? "" : "s"}.` : "";
  const byId = new Map(timeline.versions.map((v) => [v.file.id, v]));
  const reqNo = new Map(timeline.requests.map((r) => [r.note.id, r.number]));
  return (
    <div className="space-y-3">
      <Section title="2D versions" addLabel={timeline.versions.length ? `Upload amended version (V${nextNumber})` : "New submission"} canWrite={canWrite} empty={timeline.versions.length === 0}
        form={(close, first) => (
          <>
            <p className="mb-1 text-[11px] text-ink-secondary">Hand in V{nextNumber} by link or file.{answers}</p>
            <TwoDForm init={{ url: "", on: todayMyt(), pic: last?.person_id ?? null }} busy={busy} first={first} mode="new" saveLabel="Add link" onCancel={close}
              onLink={async (v) => {
                if (await run(() => simpleApi.addDesignLink(projectId, { kind: "2d", url: v.url, submittedOn: v.on, personIds: v.pic ? [v.pic] : [] }), `2D V${nextNumber} added.`)) close();
              }}
              onFile={async (v) => {
                if (await run(() => simpleApi.uploadDesignFile(projectId, "2d", v.file, v.pic ? [v.pic] : [], null, { submittedOn: v.on }), `2D V${nextNumber} uploaded.`)) close();
              }} />
          </>
        )}>
        <MiniTable empty="No 2D version yet." head={["Version", "Date", "PIC", "Answers request"]} editable={canWrite}
          rows={timeline.versions.map((v) => editing === v.file.id ? {
            key: v.file.id,
            form: (
              <TwoDForm init={{ url: v.file.external_url ?? "", on: submittedOf(v.file).slice(0, 10), pic: v.file.person_id ?? null }} busy={busy} first={false}
                mode={v.file.external_url ? "edit-link" : "edit-file"} saveLabel="Save" onCancel={() => setEditing(null)}
                onLink={async (x) => {
                  const b = { submittedOn: x.on, personIds: x.pic ? [x.pic] : [], ...(v.file.external_url ? { url: x.url } : {}) };
                  if (await run(() => simpleApi.editDesignFile(v.file.id, b), `2D V${v.number} updated.`)) setEditing(null);
                }} />
            ),
          } : {
            key: v.file.id,
            cells: [
              <FileButton key="v" f={v.file} onOpen={onOpen} label={`V${v.number} ${v.file.file_name}`} />,
              shortDate(submittedOf(v.file)),
              filePics(v.file),
              v.answered.length ? v.answered.map((n) => `#${reqNo.get(n.id) ?? "?"}`).join(", ") : v.number === 1 ? "First submission" : "-",
            ],
            action: <EditButton label={`Edit 2D V${v.number}`} disabled={busy} onClick={() => setEditing(v.file.id)} />,
          })} />
        {others.length > 0 && (
          <div className="mt-1 text-[11px] text-ink-secondary">Other files: {others.map((f) => <FileButton key={f.id} f={f} onOpen={onOpen} label={`v${f.version} ${f.file_name}`} />)}</div>
        )}
      </Section>
      <NotesLog projectId={projectId} canWrite={canWrite} busy={busy} run={run} onOpen={onOpen} kind="2d" title="2D amendment request" notes={timeline.requests.map((r) => r.note)} numberOf={reqNo}
        status={(n) => (n.closed_by_file_id == null ? <Pill tone="warn">Open</Pill> : <span className="text-synced">Closed by V{byId.get(n.closed_by_file_id)?.number ?? "?"}{byId.get(n.closed_by_file_id) ? ` (${shortDate(submittedOf(byId.get(n.closed_by_file_id)!.file))})` : ""}</span>)} />
    </div>
  );
}

// ── Notes / amendment requests ───────────────────────────────────────────

function NotesLog({ projectId, canWrite, busy, run, kind, title, notes, status, numberOf }: Shared & {
  kind: "3d" | "2d"; title: string; notes: DesignNote[]; status?: (n: DesignNote) => ReactNode; numberOf?: Map<number, number>;
}) {
  const label = kind === "3d" ? "3D" : "2D";
  return (
    <Section title={title} addLabel={kind === "2d" ? "Amendment request" : "Add note"} canWrite={canWrite} empty={false}
      form={(close) => <NoteForm kind={kind} label={label} busy={busy} onCancel={close}
        onSave={async (b) => {
          if (await run(() => simpleApi.addDesignNote(projectId, { kind, ...b }), kind === "2d" ? "Amendment request added: 2D is now amending." : "3D note added.")) close();
        }} />}>
      <MiniTable empty={kind === "2d" ? "No amendment request." : "No 3D notes."}
        head={[...(numberOf ? ["#"] : []), "Date", "Requested by", "Change", ...(status ? ["Status"] : [])]}
        rows={notes.map((n) => ({
          key: n.id,
          cells: [...(numberOf ? [`#${numberOf.get(n.id) ?? "?"}`] : []), shortDate(n.noted_on), n.requested_by_person_name ?? n.requested_by_text ?? "-", n.note, ...(status ? [status(n)] : [])],
        }))} />
    </Section>
  );
}

function NoteForm({ kind, label, busy, onSave, onCancel }: {
  kind: "3d" | "2d"; label: string; busy: boolean; onCancel: () => void;
  onSave: (b: { notedOn: string; requestedByPersonId: number | null; requestedByText: string | null; note: string }) => void;
}) {
  const [on, setOn] = useState(todayMyt());
  const [who, setWho] = useState<number | null>(null);
  const [whoText, setWhoText] = useState("");
  const [note, setNote] = useState("");
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[8.5rem_minmax(13rem,1.2fr)_minmax(0,2fr)]">
        <input type="date" aria-label={`${label} note date`} className={smallInput} value={on} max={todayMyt()} onChange={(e) => setOn(e.target.value)} />
        <div className="col-span-2 flex min-w-0 gap-1 sm:col-span-1">
          <div className="min-w-0 flex-1"><PersonSelect label="Requested by" placeholder="Requested by" value={who} onChange={setWho} className={smallInput} /></div>
          {who === null && <input aria-label="Requested by (not in the list)" placeholder="or name" className={cn(smallInput.replace("w-full", "w-24"), "shrink-0")} value={whoText} onChange={(e) => setWhoText(e.target.value)} />}
        </div>
        <input aria-label={`${label} change to make`} placeholder="What to change" className={cn(smallInput, "col-span-2 sm:col-span-1")} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <FormButtons busy={busy} onCancel={onCancel} first={false}>
        <Button className={smallBtn} disabled={busy || !note.trim() || !on}
          onClick={() => onSave({ notedOn: on, requestedByPersonId: who, requestedByText: who ? null : whoText.trim() || null, note: note.trim() })}>
          {kind === "2d" ? "Add request" : "Add note"}
        </Button>
      </FormButtons>
    </div>
  );
}

type Row = { key: number; cells: ReactNode[]; action?: ReactNode } | { key: number; form: ReactNode };

function MiniTable({ head, rows, empty, editable }: { head: string[]; rows: Row[]; empty: string; editable?: boolean }) {
  if (rows.length === 0) return <p className="mt-1 text-[11px] text-ink-secondary">{empty}</p>;
  const cols = head.length + (editable ? 1 : 0);
  return (
    <div className="mt-1 max-h-72 overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-surface-dim text-left text-ink-secondary">
          <tr>{head.map((h) => <th key={h} className="py-1 pr-2 font-medium">{h}</th>)}{editable && <th className="w-6"><span className="sr-only">Edit</span></th>}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => ("form" in r
            ? <tr key={r.key}><td colSpan={cols} className="py-1.5">{r.form}</td></tr>
            : (
              <tr key={r.key}>
                {r.cells.map((c, i) => <td key={i} className={cn("py-1 pr-2 align-top text-ink", i === 0 && "whitespace-nowrap")}>{c}</td>)}
                {editable && <td className="py-1 text-right align-top">{r.action}</td>}
              </tr>
            )))}
        </tbody>
      </table>
    </div>
  );
}
