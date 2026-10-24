/* "Add photos" from the project (owner, 24 Oct 2026): the site team's progress photos by default, or photos of one
   site step (with "Mark this step done"), or photos attached to one of the project's DOs, GRs or POs. Attached to a
   document, a file is stored as that document's own photo (scm.doc_attachments, the storage its own screen uses), so
   it also shows on the DO or GR tab and on the document. Progress and site step photos keep an optional area and note.
   AreaPick is the area picker Beta uses wherever an area is asked: the project's sales order areas, or "Other...". */

import { useId, useState, type ReactElement } from "react";
import { renovationApi } from "../projects/renovation/renovationApi";
import { errorText } from "../projects/renovation/renovationModel";
import { MediaPicker } from "./BetaMedia";
import { WS, WsBtn, WsDialog, WsField, inputStyle, textareaStyle } from "./BetaWsUi";
import { betaMediaApi, uploadAll, type PhotoDocs } from "./renovationBetaMediaApi";
import { BETA } from "./renovationBetaTheme";

export type UploadTarget =
  | { kind: "progress" }
  | { kind: "task"; id: number }
  | { kind: "do" | "gr" | "po"; id: string };

const OTHER = "__other__";
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The project's areas as a list, with "Other..." for one typed by hand; "" is no area. */
export function AreaPick({ value, areas, onChange, label = "Area", blank = "No area", required = false }: {
  value: string; areas: readonly string[]; onChange: (v: string) => void; label?: string; blank?: string; required?: boolean;
}): ReactElement {
  const known = areas.find((a) => same(a, value));
  const [other, setOther] = useState(!!value && !known);
  const id = useId();
  const sel = other ? OTHER : known ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <WsField label={label}>
        <select aria-label={label} style={inputStyle} value={sel} required={required} onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) { setOther(true); onChange(""); } else { setOther(false); onChange(v); }
        }}>
          <option value="">{blank}</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          <option value={OTHER}>Other...</option>
        </select>
      </WsField>
      {other && (
        <input id={id} aria-label={`${label}, other`} style={inputStyle} value={value} maxLength={120} placeholder="Type the area" autoFocus onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function targetValue(t: UploadTarget): string {
  return t.kind === "progress" ? "progress" : `${t.kind}:${t.id}`;
}

function parseValue(v: string): UploadTarget {
  if (v === "progress") return { kind: "progress" };
  const [k, ...rest] = v.split(":");
  const id = rest.join(":");
  if (k === "task") return { kind: "task", id: Number(id) };
  if (k === "do" || k === "gr" || k === "po") return { kind: k, id };
  return { kind: "progress" };
}

export function PhotoUploadDialog({ projectId, docs, tasks, areas, initial = { kind: "progress" }, onClose, onDone }: {
  projectId: number;
  docs: PhotoDocs;
  tasks: ReadonlyArray<{ id: number; label: string; state: string }>;
  areas: readonly string[];
  initial?: UploadTarget;
  onClose: () => void;
  onDone: (text: string) => void;
}): ReactElement {
  const [target, setTarget] = useState<UploadTarget>(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [area, setArea] = useState("");
  const [note, setNote] = useState("");
  const [markDone, setMarkDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const task = target.kind === "task" ? tasks.find((t) => t.id === target.id) : undefined;
  const onDoc = target.kind === "do" || target.kind === "gr" || target.kind === "po";

  async function submit(): Promise<void> {
    if (files.length === 0) { setError("Add at least one photo or video."); return; }
    if (target.kind === "task" && !task) { setError("Pick the site step."); return; }
    setBusy(true);
    setError(null);
    try {
      const n = files.length;
      const what = `${n} ${n === 1 ? "file" : "files"}`;
      if (target.kind === "progress" || target.kind === "task") {
        const items = await uploadAll(projectId, target.kind === "task" ? "step" : "progress", files, (d, t) => setProgress(`Uploading ${d} of ${t}...`));
        await betaMediaApi.record(projectId, { target: target.kind === "task" ? `task:${target.id}` : "progress", items, area: area.trim() || null, note: note.trim() || null });
        if (target.kind === "task" && markDone && task && task.state !== "done") {
          await renovationApi.completeTask(target.id, note.trim() || undefined);
          onDone(`${what} added and ${task.label} marked done.`);
        } else onDone(target.kind === "task" ? `${what} added to ${task?.label ?? "the site step"}.` : `${what} added to the site photos.`);
      } else {
        setProgress(`Uploading ${n === 1 ? "the file" : `${n} files`}...`);
        const type = target.kind === "do" ? "delivery_order" : target.kind === "gr" ? "goods_received" : "purchase_order";
        await betaMediaApi.attachToDoc(type, target.id, files, [area.trim(), note.trim()].filter(Boolean).join(" · ") || undefined);
        const list = target.kind === "do" ? docs.dos : target.kind === "gr" ? docs.grs : docs.pos;
        onDone(`${what} attached to ${list.find((d) => d.id === target.id)?.no ?? "the document"}.`);
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <WsDialog title="Add photos or videos" sub="Progress photos from site, or photos for a site step, a DO, a GR or a PO" onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <WsBtn onClick={onClose} disabled={busy}>Cancel</WsBtn>
          <WsBtn kind="teal" onClick={() => void submit()} disabled={busy || files.length === 0}>{busy ? progress ?? "Saving..." : "Add"}</WsBtn>
        </div>
      }>
      <WsField label="What are they for">
        <select aria-label="What are they for" style={inputStyle} value={targetValue(target)} onChange={(e) => { setTarget(parseValue(e.target.value)); setMarkDone(false); }}>
          <option value="progress">Progress (site team)</option>
          {tasks.length > 0 && <optgroup label="Site step">{tasks.map((t) => <option key={t.id} value={`task:${t.id}`}>{t.label}{t.state === "done" ? " (done)" : ""}</option>)}</optgroup>}
          {docs.dos.length > 0 && <optgroup label="Delivery order (POD)">{docs.dos.map((d) => <option key={d.id} value={`do:${d.id}`}>{d.no}</option>)}</optgroup>}
          {docs.grs.length > 0 && <optgroup label="Goods received">{docs.grs.map((d) => <option key={d.id} value={`gr:${d.id}`}>{d.no}</option>)}</optgroup>}
          {docs.pos.length > 0 && <optgroup label="Purchase order">{docs.pos.map((d) => <option key={d.id} value={`po:${d.id}`}>{d.no}</option>)}</optgroup>}
        </select>
      </WsField>
      <MediaPicker files={files} onChange={setFiles} label="Photos or videos" required onError={setError} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <AreaPick value={area} areas={areas} onChange={setArea} label="Area (optional)" />
        <WsField label={onDoc ? "Caption (optional)" : "Note (optional)"}>
          <textarea aria-label="Note" style={{ ...textareaStyle, minHeight: 40 }} rows={1} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </WsField>
      </div>
      {target.kind === "task" && task && task.state !== "done" && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: BETA.accent }} />
          Mark “{task.label}” done
        </label>
      )}
      {onDoc && <p style={{ fontSize: 12, color: BETA.muted }}>Saved on the document itself, so it also shows on its DO or GR card and on the document's page.</p>}
      {error && <p role="alert" style={{ fontSize: 13, color: WS.red }}>{error}</p>}
    </WsDialog>
  );
}
