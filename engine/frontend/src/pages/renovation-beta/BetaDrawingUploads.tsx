/* Beta workspace > Drawings: the upload dialogs. They save through the same routes as the current project page's
   Design card (DesignTask.tsx): a site measure with its photos and files, a 3D or 2D file, a 3D link, and more files
   on a site measure already recorded. Files are checked before anything is saved, so a wrong file never leaves a
   site measure behind without its files. */

import { useRef, useState, type ReactElement } from "react";
import { prepareImageForUpload } from "../../lib/imagePipeline";
import { errorText } from "../projects/renovation/renovationModel";
import { peopleOptions, personLabel, usePeople } from "../projects/renovation/PersonSelect";
import { simpleApi, type DesignFile, type NamedRef, type SiteMeasure } from "../projects/renovation/simpleApi";
import { BetaModal, BetaPeoplePicker } from "./BetaForms";
import { WS, WsField, inputStyle, textareaStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import type { DesignKind } from "./renovationBetaModel";
import { sheetNameOf, sheetSetAt, sheetsApi, type BetaSheet, type SetSheet, type UploadedSheet } from "./renovationBetaSheets";
import { isPdf, pdfPageCount, splitPdf } from "./renovationBetaPdfSplit";
import { BETA } from "./renovationBetaTheme";

export type UploadDialog =
  | { t: "measure" }
  | { t: "measure-files"; measure: SiteMeasure }
  | { t: "file"; kind: DesignKind }
  /** 2D sheets: the full set (first time, or redrawn), only the changed pages, or a new version of one sheet. */
  | { t: "sheets"; mode?: "full" | "replace"; sheet?: string }
  /** One 3D link the old way (before database update 0155). */
  | { t: "link" }
  /** Several named 3D links in one version (0155). */
  | { t: "links" };

/* The server's list (DESIGN_FILE_TYPES in engine/backend/src/services/renovation/records.ts). A file the browser
   cannot name (a DWG, usually) goes up as application/octet-stream, which the server takes. */
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "application/zip", "application/octet-stream", "image/vnd.dwg", "application/acad"]);
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = "image/*,.pdf,.dwg,.zip";
const typeOf = (f: File): string => (f.type || "application/octet-stream").toLowerCase();
const isLink = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Shrinks photos (and turns an iPhone HEIC into JPEG where the browser can), then checks type and size. */
async function readyFiles(files: File[]): Promise<{ ok: File[] } | { error: string }> {
  const out: File[] = [];
  for (const f of files) {
    const ready = f.type.startsWith("image/") ? (await prepareImageForUpload(f)).file : f;
    if (!ALLOWED.has(typeOf(ready))) return { error: `${f.name} is not a PDF, photo (JPG, PNG, WebP), DWG or ZIP file.` };
    if (ready.size === 0) return { error: `${f.name} is empty.` };
    if (ready.size > MAX_BYTES) return { error: `${f.name} is larger than 25 MB.` };
    out.push(ready);
  }
  return { ok: out };
}

/** Uploads one after another; a failure does not stop the rest, and is reported by file name. */
async function uploadEach(files: File[], send: (f: File) => Promise<unknown>): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    try { await send(f); } catch (e) { failed.push(`${f.name} (${errorText(e)})`); }
  }
  return failed;
}

const idsOf = (people: NamedRef[] | undefined, single: number | null | undefined): number[] =>
  people?.length ? people.map((x) => x.id) : single ? [single] : [];

export function BetaUploadDialog({ p, dialog, sheets, onClose, onSaved }: {
  p: BetaTabProps; dialog: UploadDialog; sheets: readonly BetaSheet[]; onClose: () => void; onSaved: (text: string, failed?: string) => void;
}): ReactElement {
  if (dialog.t === "measure") return <MeasureForm p={p} onClose={onClose} onSaved={onSaved} />;
  if (dialog.t === "measure-files") return <MeasureFilesForm p={p} measure={dialog.measure} onClose={onClose} onSaved={onSaved} />;
  if (dialog.t === "sheets") return <SheetsForm p={p} sheets={sheets} mode={dialog.mode ?? "full"} forSheet={dialog.sheet} onClose={onClose} onSaved={onSaved} />;
  if (dialog.t === "links") return <LinksForm p={p} sheets={sheets} onClose={onClose} onSaved={onSaved} />;
  return <DesignForm p={p} kind={dialog.t === "link" ? "3d" : dialog.kind} link={dialog.t === "link"} onClose={onClose} onSaved={onSaved} />;
}

type FormProps = { p: BetaTabProps; onClose: () => void; onSaved: (text: string, failed?: string) => void };

function useForm(): { busy: boolean; error: string | null; setError: (t: string | null) => void; run: (fn: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}

/* ---------- Site measure ---------- */

function MeasureForm({ p, onClose, onSaved }: FormProps): ReactElement {
  const last = [...p.records.measures].sort((a, b) => (b.done_on ?? "").localeCompare(a.done_on ?? "") || b.id - a.id).at(0);
  const [on, setOn] = useState(p.today);
  const [people, setPeople] = useState<number[]>(() => idsOf(last?.people, null));
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const f = useForm();

  return (
    <BetaModal
      title="Record site measure" sub={p.detail.project.name} onClose={onClose} error={f.error} busy={f.busy}
      onSubmit={() => f.run(async () => {
        if (!on) { f.setError("Give the date of the site measure."); return; }
        if (on > p.today) { f.setError("The site measure date is still ahead. Record it on the day it is done."); return; }
        const ready = await readyFiles(files);
        if ("error" in ready) { f.setError(ready.error); return; }
        const r = await simpleApi.addSiteMeasure(p.projectId, { doneOn: on, personIds: people, note: note.trim() || null });
        const failed = await uploadEach(ready.ok, (x) => simpleApi.uploadOnsiteFile(p.projectId, r.id, x));
        const sent = ready.ok.length - failed.length;
        onSaved(
          ready.ok.length ? `Site measure recorded with ${plural(sent, "file")}.` : "Site measure recorded.",
          failed.length ? `These files did not upload: ${failed.join("; ")}. Use "Add files" on the site measure to try again.` : undefined,
        );
      })}
    >
      <WsField label="Measured on"><input type="date" required style={inputStyle} value={on} max={p.today} onChange={(e) => setOn(e.target.value)} /></WsField>
      <PeoplePicker label="Measured by" value={people} onChange={setPeople} />
      <FilePicker label="PDF / photos" multiple files={files} onChange={setFiles} />
      <WsField label="Site notes (optional)"><textarea style={textareaStyle} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></WsField>
    </BetaModal>
  );
}

function MeasureFilesForm({ p, measure, onClose, onSaved }: FormProps & { measure: SiteMeasure }): ReactElement {
  const [files, setFiles] = useState<File[]>([]);
  const f = useForm();
  return (
    <BetaModal
      title="Add files to the site measure" sub={`${p.detail.project.name} · ${measure.done_on ?? "not dated"}`} onClose={onClose} error={f.error} busy={f.busy}
      onSubmit={() => f.run(async () => {
        if (files.length === 0) { f.setError("Choose at least one file."); return; }
        const ready = await readyFiles(files);
        if ("error" in ready) { f.setError(ready.error); return; }
        const failed = await uploadEach(ready.ok, (x) => simpleApi.uploadOnsiteFile(p.projectId, measure.id, x));
        if (failed.length === ready.ok.length) { f.setError(`Nothing was uploaded: ${failed.join("; ")}`); return; }
        onSaved(`${plural(ready.ok.length - failed.length, "file")} added to the site measure.`, failed.length ? `These files did not upload: ${failed.join("; ")}.` : undefined);
      })}
    >
      <FilePicker label="PDF / photos" multiple files={files} onChange={setFiles} />
    </BetaModal>
  );
}

/* ---------- 3D / 2D version ---------- */

function DesignForm({ p, kind, link, onClose, onSaved }: FormProps & { kind: DesignKind; link: boolean }): ReactElement {
  const K = kind.toUpperCase();
  const last: DesignFile | undefined = p.records.files.filter((x) => x.kind === kind).sort((a, b) => b.version - a.version).at(0);
  const nextVersion = (last?.version ?? 0) + 1;
  const [file, setFile] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [on, setOn] = useState(p.today);
  const [people, setPeople] = useState<number[]>(() => idsOf(last?.people, last?.person_id));
  const [next, setNext] = useState<number | null>(last?.next_person_id ?? null);
  const [note, setNote] = useState("");
  const f = useForm();
  const title = link ? `Add ${K} link (v${nextVersion})` : `Upload ${K} PDF (v${nextVersion})`;

  return (
    <BetaModal
      title={title} sub={p.detail.project.name} onClose={onClose} error={f.error} busy={f.busy}
      onSubmit={() => f.run(async () => {
        if (!on) { f.setError("Give the date the drawing was handed in."); return; }
        if (on > p.today) { f.setError("The submit date is still ahead."); return; }
        const extra = { submittedOn: on, nextPersonId: kind === "3d" ? next : null };
        if (link) {
          if (!linkName.trim()) { f.setError("Give the link a name, e.g. Living room render."); return; }
          if (!isLink(url)) { f.setError("Paste the full link, starting with https://."); return; }
          const r = await simpleApi.addDesignLink(p.projectId, { kind, url: url.trim(), name: linkName.trim(), personIds: people, note: note.trim() || null, ...extra });
          onSaved(`${K} v${r.version} added.`);
          return;
        }
        const picked = file.at(0);
        if (!picked) { f.setError(`Choose the ${K} file.`); return; }
        const ready = await readyFiles([picked]);
        if ("error" in ready) { f.setError(ready.error); return; }
        const r = await simpleApi.uploadDesignFile(p.projectId, kind, ready.ok[0], people, note.trim() || null, extra);
        onSaved(`${K} v${r.version} uploaded.`);
      })}
    >
      {kind === "2d" && nextVersion > 1 && <p style={{ fontSize: 13, color: WS.text2 }}>V{nextVersion} answers every 2D amendment request still open.</p>}
      {link
        ? (
          <>
            <WsField label="Name"><input required placeholder="e.g. Living room render" style={inputStyle} value={linkName} maxLength={200} onChange={(e) => setLinkName(e.target.value)} /></WsField>
            <WsField label={`${K} link`}><input type="url" required placeholder="https://..." style={inputStyle} value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} /></WsField>
          </>
        )
        : <FilePicker label={`${K} file (PDF, photo, DWG or ZIP)`} files={file} onChange={setFile} />}
      <WsField label="Handed in on"><input type="date" required style={inputStyle} value={on} max={p.today} onChange={(e) => setOn(e.target.value)} /></WsField>
      <PeoplePicker label={`${K} drawn by`} value={people} onChange={setPeople} />
      {kind === "3d" && <PersonPick label="2D designer (optional)" value={next} onChange={setNext} />}
      <WsField label={kind === "2d" ? "What changed in this revision (optional)" : "Note (optional)"}>
        <textarea style={textareaStyle} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </WsField>
    </BetaModal>
  );
}

/* ---------- 2D sheets ---------- */

/** A file going up: a new sheet (named after the file, renamable here), or a new version of one sheet of the set. */
interface SheetRow { id: number; file: File; name: string; replaces: boolean }

/** The 2D set as sheets (owner, 24 Oct 2026). "full": the first set, or new sheets added to it; each file (or each page
 *  of a multi-page PDF) is one new sheet, named after the file without its extension, and a name already in the set
 *  gets a number so nothing is replaced by accident. "replace": a Replace button on each sheet of the set (or on the
 *  one sheet the dialog was opened for); only the sheets picked change, the rest are kept. File names never decide
 *  what is replaced. Files already uploaded are not sent again when Save is pressed again after a failure. */
function SheetsForm({ p, sheets, mode, forSheet, onClose, onSaved }: FormProps & { sheets: readonly BetaSheet[]; mode: "full" | "replace"; forSheet?: string }): ReactElement {
  const twoD = p.records.files.filter((x) => x.kind === "2d").sort((a, b) => b.version - a.version);
  const last = twoD.at(0);
  const nextVersion = (last?.version ?? 0) + 1;
  const current = last ? sheetSetAt(p.records.files, sheets, last.version) : [];
  const first = current.length === 0;
  const replacing = !first && (mode === "replace" || forSheet != null);
  const listed = forSheet ? current.filter((s) => s.name === forSheet) : current;
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [seq, setSeq] = useState(1);
  const [on, setOn] = useState(p.today);
  const [people, setPeople] = useState<number[]>(() => idsOf(last?.people, last?.person_id));
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const done = useRef(new Map<File, UploadedSheet>());
  const f = useForm();

  /** A name not used by the set or by another file going up: "Plan", else "Plan (2)", "Plan (3)" ... */
  const freeName = (base: string, taken: Set<string>): string => {
    let n = base;
    for (let i = 2; taken.has(n.toLowerCase()); i += 1) n = `${base} (${i})`;
    taken.add(n.toLowerCase());
    return n;
  };
  async function addNew(picked: File[]): Promise<void> {
    const taken = new Set([...current.map((s) => s.name.toLowerCase()), ...rows.map((r) => r.name.trim().toLowerCase())]);
    const out: Array<{ file: File; name: string }> = [];
    for (const file of picked) {
      const base = sheetNameOf(file.name);
      if (isPdf(file) && (await pdfPageCount(file)) > 1) {
        setProgress(`Splitting ${file.name} into pages...`);
        try {
          for (const page of await splitPdf(file, base)) out.push({ file: page, name: freeName(sheetNameOf(page.name), taken) });
        } catch {
          out.push({ file, name: freeName(base, taken) });
        } finally {
          setProgress(null);
        }
        continue;
      }
      out.push({ file, name: freeName(base, taken) });
    }
    setRows((r) => [...r, ...out.map((x, i) => ({ id: seq + i, ...x, replaces: false }))]);
    setSeq((n) => n + out.length);
  }
  const replace = (name: string, file: File): void => {
    setRows((r) => [...r.filter((x) => !(x.replaces && x.name === name)), { id: seq, file, name, replaces: true }]);
    setSeq((n) => n + 1);
  };
  const byName = new Map(rows.filter((x) => x.replaces).map((x) => [x.name, x]));
  const added = rows.filter((x) => !x.replaces);
  const title = forSheet ? `Replace ${forSheet} (2D V${nextVersion})` : first ? `Upload 2D set (V${nextVersion})` : replacing ? `Replace changed pages (2D V${nextVersion})` : `Add sheets to the 2D set (V${nextVersion})`;

  return (
    <BetaModal
      title={title} sub={p.detail.project.name} onClose={onClose} error={f.error} busy={f.busy || progress != null}
      onSubmit={() => f.run(async () => {
        if (rows.length === 0) { f.setError(replacing ? "Press Replace on the sheets that changed." : "Choose the sheets (PDF or photos)."); return; }
        if (!on || on > p.today) { f.setError("Give the date the drawings were handed in (not ahead of today)."); return; }
        const names = rows.map((x) => x.name.trim().replace(/\s+/g, " "));
        if (names.some((x) => !x)) { f.setError("Give every sheet a name."); return; }
        const lower = names.map((x) => x.toLowerCase());
        const dup = lower.find((x, i) => lower.indexOf(x) !== i);
        if (dup) { f.setError(`Two sheets are both named "${names[lower.indexOf(dup)]}". Rename one of them.`); return; }
        const clash = rows.find((x, i) => !x.replaces && current.some((s) => s.name.toLowerCase() === lower[i]));
        if (clash) { f.setError(`"${clash.name}" is already a sheet in the set. Rename the new one, or use Replace on that sheet.`); return; }
        const uploaded: Array<UploadedSheet & { name: string }> = [];
        try {
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i]!;
            let up = done.current.get(row.file);
            if (!up) {
              setProgress(`Uploading ${i + 1} of ${rows.length}...`);
              const ready = await readyFiles([row.file]);
              if ("error" in ready) { f.setError(ready.error); return; }
              up = await sheetsApi.uploadFile(p.projectId, ready.ok[0]!);
              done.current.set(row.file, up);
            }
            uploaded.push({ ...up, name: names[i]! });
          }
          setProgress("Saving the version...");
          const r = await sheetsApi.saveVersion(p.projectId, { submittedOn: on, personIds: people, note: note.trim() || null, sheets: uploaded });
          onSaved(first ? `2D V${r.version} uploaded with ${plural(uploaded.length, "sheet")}.` : `2D V${r.version} saved: ${plural(uploaded.length, "sheet")} changed.`);
        } finally {
          setProgress(null);
        }
      })}
    >
      {replacing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!forSheet && <div style={{ fontSize: 12, color: BETA.muted }}>Press Replace on each sheet that changed. The others are kept from the set.</div>}
          <ul aria-label="Sheets of the set" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {listed.map((s) => {
              const r = byName.get(s.name);
              return (
                <li key={s.name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: r ? WS.tealSoft : WS.panel, fontSize: 13 }}>
                  <span style={{ flex: "1 1 140px", minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 }}>{s.name} <span style={{ fontWeight: 400, color: BETA.muted }}>· V{s.version}</span></span>
                  {r && <span style={{ flex: "1 1 120px", minWidth: 0, overflowWrap: "anywhere", color: BETA.accentInk }}>New: {r.file.name}</span>}
                  {r
                    ? <button type="button" className="link" style={{ color: WS.red }} onClick={() => setRows((x) => x.filter((y) => y !== r))}>Undo<span className="sr"> {s.name}</span></button>
                    : (
                      <label className="link" style={{ cursor: "pointer", color: BETA.accent, fontWeight: 600 }}>
                        Replace<span className="sr"> {s.name}</span>
                        <input type="file" className="sr" accept={ACCEPT} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) replace(s.name, file); }} />
                      </label>
                    )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!forSheet && (
        <FilePicker label={replacing ? "New sheets to add (optional)" : "PDF or photos: one sheet per file, or per page of a PDF"} multiple files={[]} onChange={(x) => void addNew(x)} />
      )}
      {added.length > 0 && (
        <ul aria-label="New sheets" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
          {added.map((x) => (
            <li key={x.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, background: WS.panel }}>
              <input aria-label={`Sheet name for ${x.file.name}`} style={{ ...inputStyle, flex: "1 1 160px", minHeight: 36 }} value={x.name} maxLength={120}
                onChange={(e) => setRows((r) => r.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />
              <span style={{ flex: "1 1 120px", minWidth: 0, fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{x.file.name}</span>
              <button type="button" className="link" style={{ color: WS.red }} onClick={() => setRows((r) => r.filter((y) => y.id !== x.id))}>Remove<span className="sr"> {x.name}</span></button>
            </li>
          ))}
        </ul>
      )}
      {nextVersion > 1 && <p style={{ fontSize: 13, color: WS.text2 }}>V{nextVersion} answers every 2D amendment request still open.</p>}
      <WsField label="Handed in on"><input type="date" required style={inputStyle} value={on} max={p.today} onChange={(e) => setOn(e.target.value)} /></WsField>
      <PeoplePicker label="2D drawn by" value={people} onChange={setPeople} />
      <WsField label="What changed in this revision (optional)"><textarea style={textareaStyle} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></WsField>
      {progress && <p role="status" style={{ fontSize: 13, color: BETA.accentInk }}>{progress}</p>}
    </BetaModal>
  );
}

/* ---------- 3D links ---------- */

interface LinkRow { id: number; name: string; url: string }

/** A 3D version of several named links (migration 0155). A link named like one in the current 3D set replaces it; the
 *  others are added; the rest of the set stays. Approving the version approves every link in its set. */
function LinksForm({ p, sheets, onClose, onSaved }: FormProps & { sheets: readonly BetaSheet[] }): ReactElement {
  const last = p.records.files.filter((x) => x.kind === "3d").sort((a, b) => b.version - a.version).at(0);
  const nextVersion = (last?.version ?? 0) + 1;
  const current = last ? sheetSetAt(p.records.files, sheets, last.version, "3d") : [];
  const [rows, setRows] = useState<LinkRow[]>([{ id: 1, name: "", url: "" }]);
  const [on, setOn] = useState(p.today);
  const [people, setPeople] = useState<number[]>(() => idsOf(last?.people, last?.person_id));
  const [next, setNext] = useState<number | null>(last?.next_person_id ?? null);
  const [note, setNote] = useState("");
  const f = useForm();
  const set = (id: number, patch: Partial<LinkRow>): void => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const inSet = (name: string): SetSheet | undefined => current.find((s) => s.name.toLowerCase() === name.trim().replace(/\s+/g, " ").toLowerCase());

  return (
    <BetaModal
      title={`Add 3D links (V${nextVersion})`} sub={p.detail.project.name} onClose={onClose} error={f.error} busy={f.busy}
      onSubmit={() => f.run(async () => {
        const links = rows.filter((x) => x.name.trim() || x.url.trim()).map((x) => ({ name: x.name.trim().replace(/\s+/g, " "), url: x.url.trim() }));
        if (links.length === 0) { f.setError("Add at least one link with its name."); return; }
        const bad = links.find((x) => !x.name);
        if (bad) { f.setError("Give every link a name, e.g. Living room render."); return; }
        const badUrl = links.find((x) => !isLink(x.url));
        if (badUrl) { f.setError(`Paste the full link for "${badUrl.name}", starting with https://.`); return; }
        if (!on || on > p.today) { f.setError("Give the date the 3D was handed in (not ahead of today)."); return; }
        const r = await sheetsApi.saveLinks(p.projectId, { submittedOn: on, personIds: people, nextPersonId: next, note: note.trim() || null, links });
        onSaved(`3D V${r.version} saved with ${plural(links.length, "link")}.`);
      })}
    >
      {current.length > 0 && (
        <p style={{ fontSize: 13, color: WS.text2 }}>
          The 3D set has {plural(current.length, "link")}: {current.map((x) => x.name).join(", ")}. A link with the same name replaces it; the others stay.
        </p>
      )}
      <ul aria-label="Links" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((x, i) => (
          <li key={x.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 8, background: WS.panel }}>
            <WsField label={`Link ${i + 1} name`}>
              <input placeholder="e.g. Living room render" style={inputStyle} value={x.name} maxLength={120} onChange={(e) => set(x.id, { name: e.target.value })} />
            </WsField>
            <WsField label={`Link ${i + 1} address`}>
              <input type="url" placeholder="https://..." style={inputStyle} value={x.url} maxLength={2000} onChange={(e) => set(x.id, { url: e.target.value })} />
            </WsField>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: BETA.muted }}>
              <span>{x.name.trim() ? (inSet(x.name) ? `Replaces V${inSet(x.name)!.version}` : "New link") : ""}</span>
              {rows.length > 1 && <button type="button" className="link" style={{ color: WS.red }} onClick={() => setRows((r) => r.filter((y) => y.id !== x.id))}>Remove<span className="sr"> link {i + 1}</span></button>}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="link" style={{ alignSelf: "flex-start", fontWeight: 600 }}
        onClick={() => setRows((r) => [...r, { id: Math.max(0, ...r.map((y) => y.id)) + 1, name: "", url: "" }])}>
        Add another link
      </button>
      <WsField label="Handed in on"><input type="date" required style={inputStyle} value={on} max={p.today} onChange={(e) => setOn(e.target.value)} /></WsField>
      <PeoplePicker label="3D drawn by" value={people} onChange={setPeople} />
      <PersonPick label="2D designer (optional)" value={next} onChange={setNext} />
      <WsField label="Note (optional)"><textarea style={textareaStyle} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></WsField>
    </BetaModal>
  );
}

/* ---------- Fields ---------- */

function FilePicker({ label, files, onChange, multiple = false }: { label: string; files: File[]; onChange: (f: File[]) => void; multiple?: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 72, padding: 10, border: `1.5px dashed ${BETA.focus}`, borderRadius: 10, background: WS.tealSoft, color: BETA.accentInk, fontWeight: 600, fontSize: 14, textAlign: "center", cursor: "pointer" }}>
        {multiple ? "Choose files" : "Choose a file"}
        <span style={{ fontSize: 12, fontWeight: 400, color: BETA.muted }}>{label} · up to 25 MB each</span>
        <input
          type="file" className="sr" accept={ACCEPT} multiple={multiple} aria-label={label}
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; onChange(multiple ? [...files, ...list] : list.slice(0, 1)); }}
        />
      </label>
      {files.length > 0 && (
        <ul aria-label="Chosen files" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map((x, i) => (
            <li key={`${x.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 10px", borderRadius: 8, background: WS.panel }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{x.name}</span>
              <span style={{ color: BETA.muted, flex: "none" }}>{x.size < 1024 * 1024 ? `${Math.max(1, Math.round(x.size / 1024))} KB` : `${(x.size / 1024 / 1024).toFixed(1)} MB`}</span>
              <button type="button" className="link" style={{ color: WS.red, flex: "none" }} onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove<span className="sr"> {x.name}</span></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One person, from the same list and labels as the current project page (PersonSelect.tsx). */
function PersonPick({ label, value, onChange }: { label: string; value: number | null; onChange: (id: number | null) => void }): ReactElement {
  const q = usePeople();
  const opts = peopleOptions(q.data?.data ?? [], undefined, value ? [value] : []);
  return (
    <WsField label={label}>
      <select style={inputStyle} value={value ?? ""} disabled={q.loading} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{q.loading ? "Loading..." : "Not set"}</option>
        {opts.map((x) => <option key={x.id} value={x.id}>{personLabel(x)}</option>)}
      </select>
    </WsField>
  );
}

/** Several people: the same tick-box picker with avatar chips as the Assign dialog (owner, 24 Oct 2026). */
function PeoplePicker({ label, value, onChange }: { label: string; value: number[]; onChange: (ids: number[]) => void }): ReactElement {
  return <BetaPeoplePicker label={label} value={value} onChange={onChange} />;
}
