/* Beta Drawings, the sets as the owner's mockup draws them (24 Oct 2026): a 2D set is a row of sheet pictures, each
   with its name, a Changed / Same badge against the approved set, its history, and its own Replace and Remove; a 3D
   set is a "3D PDF" list and a "3D links" list (name, address, Open, Copy for client). Thumbnails come from the stored file through
   the staff file route: a photo as it is, a PDF's first page drawn by pdf.js, anything else a drawing icon. */

import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { api } from "../../api/client";
import { useDialog } from "../../hooks/useDialog";
import { errorText } from "../projects/renovation/renovationModel";
import { simpleApi } from "../projects/renovation/simpleApi";
import { WS, WsBadge, WsBtn, WsDialog, WsPdfTile, TONE_QUIET, TONE_WAIT } from "./BetaWsUi";
import { useGuarded, type ViewedFile } from "./betaShared";
import { dayMonthYear } from "./renovationBetaModel";
import { removedSheetsOf, sheetsApi, sizeText, type SetSheet, type SheetKind } from "./renovationBetaSheets";
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

const MENU_ITEM: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", minHeight: 32, padding: "0 12px",
  border: 0, background: "transparent", font: "inherit", fontSize: 13, textAlign: "left", cursor: "pointer", color: BETA.ink, whiteSpace: "nowrap",
};

/** A small button that opens a floating panel; closes on outside click and Escape. */
function Popover({ label, srLabel, align = "left", iconOnly = false, children }: {
  label: string; srLabel: string; align?: "left" | "right"; iconOnly?: boolean; children: (close: () => void) => ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => { if (!(e.target instanceof Node) || !box.current?.contains(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative", flex: "none" }}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 28, padding: iconOnly ? "0 8px" : "0 8px 0 6px", border: `1px solid ${BETA.border}`, borderRadius: 6,
          background: BETA.surface, font: "inherit", fontSize: iconOnly ? 16 : 12, fontWeight: 600, lineHeight: 1, color: BETA.ink, cursor: "pointer" }}>
        {label}{!iconOnly && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>}
        <span className="sr"> {srLabel}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: 32, [align]: 0, zIndex: 30, minWidth: 150, padding: "4px 0", background: BETA.surface, border: `1px solid ${BETA.line}`,
          borderRadius: 8, boxShadow: "0 8px 24px rgba(23,32,31,.14)" }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

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
  const view = (x: SetSheet): void => {
    if (x.url) window.open(x.url, "_blank", "noopener");
    else if (x.key) onView({ key: x.key, name: x.name, versions: x.history.flatMap((h) => (h.key ? [{ version: h.version, key: h.key, fileName: h.fileName, uploadedOn: h.uploadedOn }] : [])) });
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
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, fontSize: 12, color: WS.text2 }}>
          <span style={{ fontWeight: 600 }}>Sheets in the new set</span>
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
              <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: "anywhere" }}>{x.name}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 12, color: BETA.muted }}>
                <span>V{x.version}{x.history.length > 1 ? ` · ${x.history.length} versions` : ""}</span>
                {editable && (
                  <Popover label="⋯" srLabel={`Actions for ${x.name}`} align="right" iconOnly>
                    {(close) => (
                      <div role="menu" style={{ display: "flex", flexDirection: "column" }}>
                        <button type="button" role="menuitem" style={MENU_ITEM} disabled={busy} onClick={() => { close(); edit.onReplace(x.name); }}>Replace</button>
                        <button type="button" role="menuitem" style={MENU_ITEM} disabled={busy} onClick={() => { close(); void run(() => rename(x)); }}>Rename</button>
                        <button type="button" role="menuitem" style={{ ...MENU_ITEM, color: WS.red }} disabled={busy} onClick={() => { close(); void run(() => remove(x)); }}>Remove</button>
                      </div>
                    )}
                  </Popover>
                )}
              </div>
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={BETA.accent} strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}

const boxStyle: CSSProperties = { border: `1px solid ${BETA.line}`, borderRadius: 10, overflow: "hidden" };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${WS.rowLine}` };

/** A 3D set as the client's mockup draws it: a "3D PDF" list (file, size, Open) and a "3D links" list (name, address, Open, Copy for client). */
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
  const newBadge = (x: SetSheet): ReactElement | null => {
    if (!changed) return null;
    const isNew = changed.get(x.name) ?? false;
    return <WsBadge tone={isNew ? TONE_WAIT : TONE_QUIET}>{isNew ? "New" : "Same"}</WsBadge>;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {files.length > 0 && (
        <div style={boxStyle}>
          <div style={{ padding: "12px 16px", background: WS.head, fontWeight: 600 }}>3D PDF</div>
          <ul aria-label="3D PDF" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {files.map((x) => (
              <li key={x.name} style={rowStyle}>
                {PDF.test(x.key ?? "") || x.contentType === "application/pdf"
                  ? <WsPdfTile />
                  : <span style={{ flex: "none", width: 44, height: 36, borderRadius: 4, overflow: "hidden", border: `1px solid ${BETA.line}` }}><SheetThumb projectId={projectId} sheet={x} /></span>}
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{x.fileName}</div>
                  <div style={{ fontSize: 12, color: BETA.muted }}>{(x.size ? sizeText(x.size) : null) ?? "File"}</div>
                </div>
                {newBadge(x)}
                <WsBtn kind="teal" size="sm" onClick={() => x.key && onView({ key: x.key, name: x.name, versions: x.history.flatMap((h) => (h.key ? [{ version: h.version, key: h.key, fileName: h.fileName, uploadedOn: h.uploadedOn }] : [])) })}>Open<span className="sr"> {x.name}</span></WsBtn>
              </li>
            ))}
          </ul>
        </div>
      )}
      {urls.length > 0 && (
        <div style={boxStyle}>
          <div style={{ padding: "12px 16px", background: WS.head, fontWeight: 600 }}>3D links</div>
          <ul aria-label="3D links" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {urls.map((x) => (
              <li key={x.name} style={rowStyle}>
                <CubeIcon />
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{x.name}</div>
                  <div style={{ fontSize: 12, color: BETA.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.url ?? ""}>{x.url}</div>
                </div>
                {newBadge(x)}
                <WsBtn kind="teal" size="sm" onClick={() => window.open(x.url ?? "", "_blank", "noopener")}>Open<span className="sr"> {x.name}</span></WsBtn>
                <WsBtn size="sm" onClick={() => void copy(x)}>{copied === x.name ? "Copied" : "Copy for client"}<span className="sr"> {x.name}</span></WsBtn>
                {edit && x.fromSheet && <WsBtn kind="danger" size="sm" disabled={busy} onClick={() => void run(() => remove(x))}>Remove<span className="sr"> {x.name}</span></WsBtn>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
