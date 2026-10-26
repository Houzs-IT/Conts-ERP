/* Beta Drawings, the sets as the owner's mockup draws them (24 Oct 2026): a 2D set is a row of sheet pictures, each
   with its name, a Changed / Same badge against the approved set, its history, and its own Replace and Remove; a 3D
   set is a list of link cards (name, where it points, Open, Copy link). Thumbnails come from the stored file through
   the staff file route: a photo as it is, a PDF's first page drawn by pdf.js, anything else a drawing icon. */

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { api } from "../../api/client";
import { useDialog } from "../../hooks/useDialog";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi } from "../projects/renovation/simpleApi";
import { WS, WsBadge, WsBtn, WsDialog, TONE_QUIET, TONE_WAIT } from "./BetaWsUi";
import { useGuarded, type ViewedFile } from "./betaShared";
import { dayMonthYear } from "./renovationBetaModel";
import { linkHost, removedSheetsOf, sheetsApi, type SetSheet, type SheetKind } from "./renovationBetaSheets";
import { BETA } from "./renovationBetaTheme";

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const PDF = /\.pdf$/i;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ---------- Thumbnail ---------- */

function DrawingIcon(): ReactElement {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={BETA.muted} strokeWidth="1.3" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 10h8v11M11 14h10M15 3v6" />
    </svg>
  );
}

/** A PDF's first page as a picture, drawn once per key. */
const pdfThumbs = new Map<string, Promise<string>>();
function pdfThumb(projectId: number, key: string): Promise<string> {
  const hit = pdfThumbs.get(key);
  if (hit) return hit;
  const made = (async () => {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const url = await api.fetchBlobUrl(simpleApi.fileUrl(projectId, key));
    try {
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      try {
        const page = await doc.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 420 / Math.max(vp1.width, vp1.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return canvas.toDataURL("image/png");
      } finally {
        await doc.destroy();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
  made.catch(() => pdfThumbs.delete(key));
  pdfThumbs.set(key, made);
  return made;
}

export function SheetThumb({ projectId, sheet }: { projectId: number; sheet: { key: string | null; fileName: string; contentType: string | null } }): ReactElement {
  const key = sheet.key;
  const isImage = !!key && (IMAGE.test(key) || (sheet.contentType ?? "").startsWith("image/"));
  const isPdf = !!key && (PDF.test(key) || sheet.contentType === "application/pdf");
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!key || (!isImage && !isPdf)) return;
    let live = true;
    let made: string | null = null;
    setSrc(null);
    setFailed(false);
    (isImage ? api.fetchBlobUrl(simpleApi.fileUrl(projectId, key)).then((u) => { made = u; return u; }) : pdfThumb(projectId, key))
      .then((u) => { if (live) setSrc(u); else if (made) URL.revokeObjectURL(made); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [projectId, key, isImage, isPdf]);
  const box: CSSProperties = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF" };
  if (src && !failed) return <img src={src} alt="" style={{ ...box, objectFit: "contain", display: "block" }} />;
  return <div style={box} aria-busy={!failed && (isImage || isPdf) ? true : undefined}><DrawingIcon /></div>;
}

/* ---------- 2D sheet grid ---------- */

export interface SheetGridEdit {
  kind: SheetKind;
  onReplace: (name: string) => void;
  onChanged: () => void;
  onDone: (t: string) => void;
}

/** The sheets of a set as pictures. `changed` marks each against the approved set (null: no badges). */
export function SheetGrid({ projectId, sheets, changed, onView, onError, edit }: {
  projectId: number; sheets: SetSheet[]; changed: Map<string, boolean> | null; onView: (f: ViewedFile) => void; onError: (t: string) => void;
  edit: SheetGridEdit | null;
}): ReactElement {
  const dialog = useDialog();
  const { busy, run } = useGuarded();
  const [open, setOpen] = useState<string | null>(null);
  const view = (x: { key: string | null; url: string | null; fileName: string }): void => {
    if (x.url) window.open(x.url, "_blank", "noopener");
    else if (x.key) onView({ key: x.key, name: x.fileName });
  };
  async function rename(x: SetSheet): Promise<void> {
    if (!edit) return;
    const to = await dialog.prompt({ title: `Rename ${x.name}`, message: "The new name is used in every version of this sheet.", defaultValue: x.name, required: true, confirmLabel: "Rename" });
    if (to == null || to.trim().replace(/\s+/g, " ") === x.name) return;
    try {
      const r = await sheetsApi.rename(projectId, x.name, to, edit.kind);
      edit.onChanged();
      edit.onDone(`${x.name} renamed to ${r.name}.`);
    } catch (e) { onError(errorText(e)); }
  }
  async function remove(x: SetSheet): Promise<void> {
    if (!edit) return;
    const ok = await dialog.confirm({
      title: `Remove ${x.name} from the set?`, message: "It leaves the set and the set PDF. Its files are kept under Removed sheets and it can be put back.",
      confirmLabel: "Remove sheet", danger: true,
    });
    if (!ok) return;
    try {
      await sheetsApi.remove(projectId, x.name, edit.kind);
      edit.onChanged();
      edit.onDone(`${x.name} removed from the set.`);
    } catch (e) { onError(errorText(e)); }
  }
  const nChanged = changed ? [...changed.values()].filter(Boolean).length : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {changed && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, fontSize: 13, color: WS.text2 }}>
          <span style={{ fontWeight: 600, color: BETA.ink }}>Sheets in the new set</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, border: `2px solid ${WS.amberBtn}`, borderRadius: 3 }} />Changed · {nChanged}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, border: `1px solid ${BETA.border}`, borderRadius: 3 }} />Same as approved · {sheets.length - nChanged}</span>
        </div>
      )}
      <ul aria-label="Sheets" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        {sheets.map((x) => {
          const isNew = changed?.get(x.name) ?? false;
          const editable = edit != null && x.fromSheet;
          return (
            <li key={x.name} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <button type="button" onClick={() => view(x)} title={`Open ${x.name} large`}
                style={{ position: "relative", aspectRatio: "4 / 3", padding: 4, borderRadius: 8, overflow: "hidden", cursor: "zoom-in", background: "#FFFFFF",
                  border: isNew ? `2px solid ${WS.amberBtn}` : `1px solid ${BETA.line}` }}>
                <SheetThumb projectId={projectId} sheet={x} />
                {changed && (
                  <span style={{ position: "absolute", top: 6, left: 6, padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: isNew ? WS.amberBtn : "rgba(255,255,255,0.92)", color: isNew ? "#FFFFFF" : WS.text2 }}>
                    {isNew ? "Changed" : "Same"}
                  </span>
                )}
                <span className="sr">Open {x.name}</span>
              </button>
              <div style={{ fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>{x.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: BETA.muted }}>
                <span>V{x.version}</span>
                {x.history.length > 1 && (
                  <button type="button" className="link" style={{ fontSize: 12 }} aria-expanded={open === x.name} onClick={() => setOpen(open === x.name ? null : x.name)}>
                    {x.history.length - 1} older<span className="sr"> of {x.name}</span>
                  </button>
                )}
              </div>
              {open === x.name && (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
                  {x.history.slice(1).map((h) => (
                    <li key={`${h.version}-${h.key ?? h.url}`}>
                      <button type="button" className="link" style={{ fontSize: 12 }} onClick={() => view(h)}>V{h.version} · {h.fileName}</button>
                    </li>
                  ))}
                </ul>
              )}
              {editable && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <WsBtn size="sm" disabled={busy} onClick={() => edit.onReplace(x.name)}>Replace<span className="sr"> {x.name}</span></WsBtn>
                  <WsBtn kind="danger" size="sm" disabled={busy} onClick={() => void run(() => remove(x))}>Remove<span className="sr"> {x.name}</span></WsBtn>
                  <button type="button" className="link" style={{ fontSize: 12 }} disabled={busy} onClick={() => void run(() => rename(x))}>Rename<span className="sr"> {x.name}</span></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Removed sheets or links of a kind, each with Open and Put back. */
export function RemovedList({ projectId, removed, kind, onView, onChanged, onDone, onError }: {
  projectId: number; removed: ReturnType<typeof removedSheetsOf>; kind: SheetKind; onView: (f: ViewedFile) => void;
  onChanged: () => void; onDone: (t: string) => void; onError: (t: string) => void;
}): ReactElement | null {
  const [show, setShow] = useState(false);
  const { busy, run } = useGuarded();
  if (removed.length === 0) return null;
  const word = kind === "3d" ? "links" : "sheets";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className="link" aria-expanded={show} onClick={() => setShow(!show)} style={{ alignSelf: "flex-start" }}>Removed {word} ({removed.length})</button>
      {show && (
        <ul aria-label={`Removed ${word}`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {removed.map((r) => (
            <li key={r.name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, color: WS.text2 }}>
              <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                <span style={{ fontWeight: 600, color: BETA.ink }}>{r.name}</span> · removed {dayMonthYear(r.removedAt.slice(0, 10))} · {plural(r.history.length, "file")}
              </span>
              {r.history[0] && (
                <button type="button" className="link" onClick={() => {
                  const h = r.history[0]!;
                  if (h.url) window.open(h.url, "_blank", "noopener"); else if (h.key) onView({ key: h.key, name: h.fileName });
                }}>Open<span className="sr"> {r.name}</span></button>
              )}
              <WsBtn size="sm" disabled={busy} onClick={() => void run(async () => {
                try { await sheetsApi.restore(projectId, r.name, kind); onChanged(); onDone(`${r.name} is back in the set.`); } catch (e) { onError(errorText(e)); }
              })}>Put back<span className="sr"> {r.name}</span></WsBtn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The changed sheets side by side with what the approved set has, so the client's change can be checked page by page. */
export function CompareDialog({ projectId, next, approved, onClose }: { projectId: number; next: SetSheet[]; approved: SetSheet[]; onClose: () => void }): ReactElement {
  const before = new Map(approved.map((s) => [s.name.toLowerCase(), s]));
  const pairs = next.map((s) => ({ s, a: before.get(s.name.toLowerCase()) ?? null })).filter(({ s, a }) => !a || a.key !== s.key || a.url !== s.url);
  const gone = approved.filter((a) => !next.some((s) => s.name.toLowerCase() === a.name.toLowerCase()));
  const cell: CSSProperties = { aspectRatio: "4 / 3", border: `1px solid ${BETA.line}`, borderRadius: 8, overflow: "hidden", padding: 4, background: "#FFFFFF" };
  return (
    <WsDialog title="Compare with approved set" sub={`${plural(pairs.length, "sheet")} changed${gone.length ? `, ${gone.length} not in the new set` : ""}`} onClose={onClose} wide>
      {pairs.length === 0 && gone.length === 0 && <p>The new set is the same as the approved set.</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {pairs.map(({ s, a }) => (
          <li key={s.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: BETA.muted, marginBottom: 4 }}>{a ? `Approved · V${a.version}` : "Approved · not in the set"}</div>
                <div style={cell}>{a ? <SheetThumb projectId={projectId} sheet={a} /> : null}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: WS.amber, marginBottom: 4, fontWeight: 600 }}>New · V{s.version}</div>
                <div style={{ ...cell, border: `2px solid ${WS.amberBtn}` }}><SheetThumb projectId={projectId} sheet={s} /></div>
              </div>
            </div>
          </li>
        ))}
        {gone.map((a) => <li key={a.name} style={{ fontSize: 13, color: WS.text2 }}>{a.name}: in the approved set, not in the new one.</li>)}
      </ul>
    </WsDialog>
  );
}

/* ---------- 3D link cards ---------- */

function CubeIcon(): ReactElement {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={WS.blue} strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}

/** The links (and any 3D files) of a 3D set as cards: name, where it points, Open, Copy link; a 3D render file opens large. */
export function LinkCards({ projectId, links, changed, onView, onError, edit }: {
  projectId: number; links: SetSheet[]; changed: Map<string, boolean> | null; onView: (f: ViewedFile) => void; onError: (t: string) => void;
  edit: SheetGridEdit | null;
}): ReactElement {
  const dialog = useDialog();
  const { busy, run } = useGuarded();
  const [copied, setCopied] = useState<string | null>(null);
  const urls = links.filter((x) => x.url);
  const files = links.filter((x) => !x.url && x.key);
  async function copy(x: SetSheet): Promise<void> {
    try { await navigator.clipboard.writeText(x.url ?? ""); setCopied(x.name); window.setTimeout(() => setCopied((c) => (c === x.name ? null : c)), 2000); }
    catch { onError("The link could not be copied. Open it and copy it from the address bar."); }
  }
  async function remove(x: SetSheet): Promise<void> {
    if (!edit) return;
    const ok = await dialog.confirm({ title: `Remove ${x.name} from the 3D set?`, message: "It is kept under Removed links and can be put back.", confirmLabel: "Remove link", danger: true });
    if (!ok) return;
    try { await sheetsApi.remove(projectId, x.name, "3d"); edit.onChanged(); edit.onDone(`${x.name} removed from the 3D set.`); } catch (e) { onError(errorText(e)); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {urls.length > 0 && (
        <ul aria-label="3D links" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {urls.map((x) => {
            const isNew = changed?.get(x.name) ?? false;
            return (
              <li key={x.name} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 10, background: BETA.surface, border: isNew ? `2px solid ${WS.amberBtn}` : `1px solid ${BETA.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <span style={{ flex: "none", width: 48, height: 48, borderRadius: 10, background: BETA.blueSoft, display: "flex", alignItems: "center", justifyContent: "center" }}><CubeIcon /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{x.name}</div>
                    <div style={{ fontSize: 13, color: BETA.muted }}>{linkHost(x.url ?? "")} · V{x.version}</div>
                  </div>
                  {changed && <WsBadge tone={isNew ? TONE_WAIT : TONE_QUIET}>{isNew ? "New" : "Same"}</WsBadge>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <WsBtn kind="teal" size="sm" onClick={() => window.open(x.url ?? "", "_blank", "noopener")}>Open<span className="sr"> {x.name}</span></WsBtn>
                  <WsBtn size="sm" onClick={() => void copy(x)}>{copied === x.name ? "Copied" : "Copy link"}<span className="sr"> of {x.name}</span></WsBtn>
                  {edit && x.fromSheet && <WsBtn kind="danger" size="sm" disabled={busy} onClick={() => void run(() => remove(x))}>Remove<span className="sr"> {x.name}</span></WsBtn>}
                </div>
                {x.history.length > 1 && <div style={{ fontSize: 12, color: BETA.muted }}>Earlier: {x.history.slice(1).map((h) => `V${h.version}`).join(", ")}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {files.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: BETA.muted, fontWeight: 600, marginBottom: 8 }}>3D renders</div>
          <ul aria-label="3D renders" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {files.map((x) => (
              <li key={x.name} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <button type="button" onClick={() => x.key && onView({ key: x.key, name: x.fileName })} style={{ aspectRatio: "4 / 3", padding: 4, border: `1px solid ${BETA.line}`, borderRadius: 8, overflow: "hidden", background: "#FFFFFF", cursor: "zoom-in" }}>
                  <SheetThumb projectId={projectId} sheet={x} /><span className="sr">Open {x.name}</span>
                </button>
                <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{x.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
