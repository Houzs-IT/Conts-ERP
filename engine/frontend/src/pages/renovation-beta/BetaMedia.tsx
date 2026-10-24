/* One way to show photos and videos everywhere in Beta (owner, 24 Oct 2026): defect cards and tickets, Site & photos,
   the site measure, the DO and GR tabs. A card shows a fixed 4:3 thumbnail:
     1 item   one cover
     2 items  side by side (a before / after pair)
     3+       one on top, up to three equal tiles under it, "+N" on the last tile
   A row (MediaStrip) shows equal square tiles in one line, as many as fit, "+N" on the last. A click opens the gallery: arrows, swipe on a
   phone, Esc to close, videos play with controls, "2 / 5", and a download link. A video is a dark tile with a play
   mark (its frames are not fetched for a thumbnail: a phone video can be 90 MB). A file that cannot be shown is a
   plain tile, never a broken-image icon. Files stream through the signed-in API, so each is fetched as a blob. */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, Play, X } from "lucide-react";
import { api } from "../../api/client";
import { BETA } from "./renovationBetaTheme";

export type MediaKind = "image" | "video" | "file";

export interface MediaItem {
  id: string;
  /** API path that streams the file. */
  path: string;
  kind: MediaKind;
  name: string;
  /** "Before", "After", "POD" ... shown on the tile. */
  label?: string | null;
  /** ISO time, shown in the gallery. */
  at?: string | null;
  /** A line under the item in the gallery (area, note). */
  caption?: string | null;
  /** Seconds, when known. */
  duration?: number | null;
}

export const MEDIA_RADIUS = 10;
export const MEDIA_GAP = 4;
const TILE_BG = "#E9EEED";
const VIDEO_BG = "#1E2A29";

/* Blob URLs by path, so a photo shown on a card and again in the gallery is fetched once per page. */
const blobs = new Map<string, Promise<string>>();
function blobUrl(path: string): Promise<string> {
  let p = blobs.get(path);
  if (!p) {
    p = api.fetchBlobUrl(path);
    p.catch(() => blobs.delete(path));
    blobs.set(path, p);
    if (blobs.size > 300) {
      const first = blobs.keys().next().value;
      if (first !== undefined) blobs.delete(first);
    }
  }
  return p;
}

function useBlob(path: string, on: boolean): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!on) return;
    let live = true;
    setState({ url: null, failed: false });
    blobUrl(path).then((url) => { if (live) setState({ url, failed: false }); }, () => { if (live) setState({ url: null, failed: true }); });
    return () => { live = false; };
  }, [path, on]);
  return state;
}

export function durationText(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

const labelChip: CSSProperties = {
  position: "absolute", left: 6, top: 6, padding: "1px 7px", borderRadius: 8, background: "rgba(23,32,31,.78)", color: "#FFFFFF",
  fontSize: 11, fontWeight: 700, letterSpacing: ".02em", pointerEvents: "none",
  maxWidth: "calc(100% - 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

function labelTone(label: string): string {
  if (/^after/i.test(label)) return "#1A6B66";
  return "rgba(23,32,31,.78)";
}

/** One tile filling its box: a photo, a video's play tile, or a plain tile for anything else or a file that failed. */
export function MediaTile({ item, onClick, overlay, showLabel = true }: { item: MediaItem; onClick?: () => void; overlay?: string | null; showLabel?: boolean }): ReactElement {
  const { url, failed } = useBlob(item.path, item.kind === "image");
  const [broken, setBroken] = useState(false);
  const box: CSSProperties = { position: "relative", width: "100%", height: "100%", overflow: "hidden", background: item.kind === "video" ? VIDEO_BG : TILE_BG, display: "block" };
  let inner: ReactElement;
  if (item.kind === "image" && url && !broken && !failed) {
    inner = <img src={url} alt="" onError={() => setBroken(true)} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />;
  } else if (item.kind === "image" && !failed && !broken) {
    inner = <span aria-hidden="true" style={{ display: "block", width: "100%", height: "100%" }} />;
  } else if (item.kind === "video") {
    const d = durationText(item.duration);
    inner = (
      <span style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 20, background: "rgba(255,255,255,.92)", color: VIDEO_BG }}>
          <Play size={18} fill="currentColor" />
        </span>
        {d && <span style={{ position: "absolute", right: 6, bottom: 6, padding: "1px 6px", borderRadius: 6, background: "rgba(0,0,0,.6)", color: "#FFFFFF", fontSize: 11, fontWeight: 600 }}>{d}</span>}
      </span>
    );
  } else {
    // A PDF, or a photo that could not be read: a quiet tile with an icon, never the file name spilling over.
    const Icon = item.kind === "file" ? FileText : ImageOff;
    inner = (
      <span style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 4, color: BETA.muted, fontSize: 11, fontWeight: 600 }}>
        <Icon size={20} aria-hidden="true" />
        <span>{item.kind === "file" ? (/\.pdf$/i.test(item.name) ? "PDF" : "File") : "No preview"}</span>
      </span>
    );
  }
  const a11y = `${item.label ? `${item.label}: ` : ""}${item.kind === "video" ? "video" : item.kind === "image" ? "photo" : "file"} ${item.name}`;
  const content = (
    <>
      {inner}
      {showLabel && item.label && <span style={{ ...labelChip, background: labelTone(item.label) }}>{item.label}</span>}
      {overlay && (
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(23,32,31,.55)", color: "#FFFFFF", fontSize: 22, fontWeight: 700 }}>{overlay}</span>
      )}
    </>
  );
  if (!onClick) return <span style={box} role="img" aria-label={a11y}>{content}</span>;
  return (
    <button type="button" onClick={onClick} aria-label={`Open ${a11y}${overlay ? ` (${overlay} more)` : ""}`} title={item.name}
      style={{ ...box, padding: 0, border: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}>
      {content}
    </button>
  );
}

/** The card thumbnail, always the same box (4:3) whatever the count or the photos' shape, each tile cropped to fill:
    one item covers it; two sit side by side (a before / after pair); three or more put the first on top and up to
    three equal tiles in a row under it, "+N" on the last. Opens the gallery on a click. */
export function MediaGrid({ items, label, ratio = "4 / 3", interactive = true }: { items: readonly MediaItem[]; label: string; ratio?: string; interactive?: boolean }): ReactElement | null {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;
  const tile = (i: number, style: CSSProperties, overlay?: string): ReactElement => (
    <div key={items[i].id} style={{ minWidth: 0, minHeight: 0, overflow: "hidden", ...style }}>
      <MediaTile item={items[i]} overlay={overlay} onClick={interactive ? () => setOpen(i) : undefined} />
    </div>
  );
  const n = items.length;
  const grid: CSSProperties = { display: "grid", gap: MEDIA_GAP, width: "100%", aspectRatio: ratio, borderRadius: MEDIA_RADIUS, overflow: "hidden" };
  let body: ReactElement;
  if (n === 1) body = <div style={{ ...grid, gridTemplateColumns: "1fr" }}>{tile(0, {})}</div>;
  else if (n === 2) body = <div style={{ ...grid, gridTemplateColumns: "1fr 1fr" }}>{tile(0, {})}{tile(1, {})}</div>;
  else {
    const small = Math.min(n - 1, 3);
    const more = n - 1 - small;
    body = (
      <div style={{ ...grid, gridTemplateColumns: Array.from({ length: small }, () => "1fr").join(" "), gridTemplateRows: "2fr 1fr" }}>
        {tile(0, { gridColumn: "1 / -1" })}
        {Array.from({ length: small }, (_, k) => tile(k + 1, {}, k === small - 1 && more > 0 ? `+${more}` : undefined))}
      </div>
    );
  }
  return (
    <div role="group" aria-label={`${label}: ${n} ${n === 1 ? "item" : "items"}`} style={{ width: "100%" }}>
      {body}
      {open != null && <MediaLightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** How many tiles of `size` fit across the element, never more than `max`; `max` until it is measured. */
function useFit(size: number, gap: number, max: number): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState<number | null>(null);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((e) => { const w = e[0]?.contentRect.width; if (w) setWidth(w); });
    ro.observe(el);
    obs.current = ro;
  }, []);
  const fit = width == null ? max : Math.max(1, Math.floor((width + gap) / (size + gap)));
  return [ref, Math.min(max, fit)];
}

/** One row of equal square tiles, as many as fit (at most `max`), the last one "+N" when more are left: the DO and GR
    rows and the Site & photos timeline. Every tile is the same size and cropped to fill, so a portrait POD and a
    landscape room photo sit level. A click opens the gallery at that item. */
export function MediaStrip({ items, label, size = 72, max = 8 }: { items: readonly MediaItem[]; label: string; size?: number; max?: number }): ReactElement | null {
  const [open, setOpen] = useState<number | null>(null);
  const [ref, fit] = useFit(size, 6, max);
  if (items.length === 0) return null;
  const shown = items.length > fit ? items.slice(0, fit) : items;
  const more = items.length - shown.length;
  return (
    <div ref={ref} style={{ minWidth: 0, width: "100%" }}>
      <ul aria-label={`${label}: ${items.length} ${items.length === 1 ? "item" : "items"}`} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 6, minWidth: 0 }}>
        {shown.map((m, i) => (
          <li key={m.id} style={{ flex: `0 0 ${size}px`, width: size, height: size, borderRadius: 8, overflow: "hidden" }}>
            <MediaTile item={m} onClick={() => setOpen(i)} showLabel={size >= 64} overlay={more > 0 && i === shown.length - 1 ? `+${more}` : null} />
          </li>
        ))}
      </ul>
      {open != null && <MediaLightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function when(at: string | null | undefined): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The gallery: one item large, arrows and swipe between items, Esc closes. */
export function MediaLightbox({ items, index, onIndex, onClose }: { items: readonly MediaItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }): ReactElement | null {
  const item = items.at(index);
  const n = items.length;
  const go = useCallback((d: number) => { if (n > 1) onIndex((index + d + n) % n); }, [index, n, onIndex]);
  const { url, failed } = useBlob(item?.path ?? "", !!item);
  const [broken, setBroken] = useState(false);
  const start = useRef<number | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setBroken(false); }, [index]);
  useEffect(() => {
    const keys = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); } else if (e.key === "ArrowLeft") go(-1); else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [go, onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);
  if (!item) return null;
  const firstX = (list: TouchEvent["touches"]): number | null => (list.length > 0 ? list[0].clientX : null);
  const onTouchStart = (e: TouchEvent): void => { start.current = firstX(e.touches); };
  const onTouchEnd = (e: TouchEvent): void => {
    const x = firstX(e.changedTouches);
    if (start.current != null && x != null && Math.abs(x - start.current) > 40) go(x < start.current ? 1 : -1);
    start.current = null;
  };
  const navBtn = (side: "left" | "right"): CSSProperties => ({
    position: "absolute", top: "50%", [side]: 8, transform: "translateY(-50%)", width: 44, height: 44, borderRadius: 22, border: 0,
    background: "rgba(255,255,255,.14)", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  });
  const line = [item.label, item.caption, when(item.at)].filter(Boolean).join(" · ");
  const bad = failed || broken;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${item.label ? `${item.label}: ` : ""}${item.name}`} onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,14,14,.92)", display: "flex", flexDirection: "column", color: "#FFFFFF", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", minHeight: 56 }}>
        <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} aria-live="polite">{index + 1} / {n}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
        {url && !bad && (
          <a href={url} download={item.name} onClick={(e) => e.stopPropagation()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", borderRadius: 8, background: "rgba(255,255,255,.14)", color: "#FFFFFF", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            <Download size={16} aria-hidden="true" />Download
          </a>
        )}
        <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close"
          style={{ width: 40, height: 40, borderRadius: 20, border: 0, background: "rgba(255,255,255,.14)", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={20} />
        </button>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 56px" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {bad ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 32, borderRadius: 12, background: "rgba(255,255,255,.08)", fontSize: 14 }}>
              <ImageOff size={28} aria-hidden="true" />This file cannot be shown.
            </div>
          ) : !url ? (
            <div style={{ fontSize: 14, opacity: 0.8 }}>{item.kind === "video" ? "Loading the video..." : "Loading..."}</div>
          ) : item.kind === "image" ? (
            <img src={url} alt={item.name} onError={() => setBroken(true)} style={{ maxWidth: "100%", maxHeight: "calc(100vh - 140px)", objectFit: "contain", borderRadius: 6 }} />
          ) : item.kind === "video" ? (
            <video src={url} controls playsInline autoPlay onError={() => setBroken(true)} style={{ maxWidth: "100%", maxHeight: "calc(100vh - 140px)", borderRadius: 6, background: "#000" }} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 32, borderRadius: 12, background: "rgba(255,255,255,.08)" }}>
              <FileText size={32} aria-hidden="true" />
              <a href={url} target="_blank" rel="noopener" style={{ color: "#FFFFFF", fontWeight: 600 }}>Open the file</a>
            </div>
          )}
        </div>
        {n > 1 && <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); go(-1); }} style={navBtn("left")}><ChevronLeft size={24} /></button>}
        {n > 1 && <button type="button" aria-label="Next" onClick={(e) => { e.stopPropagation(); go(1); }} style={navBtn("right")}><ChevronRight size={24} /></button>}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ minHeight: 44, padding: "8px 16px 14px", textAlign: "center", fontSize: 13, opacity: 0.9 }}>{line || " "}</div>
    </div>,
    document.body,
  );
}

/* ---------- Picking files to upload ---------- */

export const MEDIA_ACCEPT = "image/*,video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm,.heic,.heif";
export const PHOTO_MAX_MB = 15;
export const VIDEO_MAX_MB = 95;
export const MEDIA_LIMIT_TEXT = `Photos or videos (MP4, MOV, WebM). Photos up to ${PHOTO_MAX_MB} MB, videos up to ${VIDEO_MAX_MB} MB.`;

/** The type the server is told; some phones leave a video's type blank. */
export function fileMime(f: File): string {
  const t = (f.type || "").toLowerCase();
  if (t) return t === "image/jpg" ? "image/jpeg" : t;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext] ?? "";
}

/** Why a file cannot be added, or null. */
export function mediaRefusal(f: File): string | null {
  const m = fileMime(f);
  const video = /^video\/(mp4|quicktime|webm|3gpp)$/.test(m);
  if (!video && !/^image\//.test(m)) return `${f.name}: add a photo or a video (MP4, MOV or WebM).`;
  const cap = video ? VIDEO_MAX_MB : PHOTO_MAX_MB;
  if (f.size > cap * 1024 * 1024) return `${f.name} is over ${cap} MB.`;
  return null;
}

/** Local previews of files picked but not uploaded yet. */
export function usePickedPreviews(files: readonly File[]): MediaItem[] {
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    const made = files.map((f, i) => ({ f, i, url: URL.createObjectURL(f) }));
    setItems(made.map(({ f, i, url }) => ({ id: `pick-${i}-${f.name}`, path: url, kind: fileMime(f).startsWith("video/") ? "video" : "image", name: f.name })));
    return () => made.forEach((m) => URL.revokeObjectURL(m.url));
  }, [files]);
  return items;
}

/** A tile for a picked file (shown from the device, not the server). */
export function PickedTile({ item, onRemove }: { item: MediaItem; onRemove?: () => void }): ReactElement {
  return (
    <span style={{ position: "relative", display: "block", width: "100%", height: "100%", borderRadius: MEDIA_RADIUS, overflow: "hidden", background: item.kind === "video" ? VIDEO_BG : TILE_BG }}>
      {item.kind === "image" ? <img src={item.path} alt={item.name} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}><Play size={20} fill="currentColor" aria-hidden="true" /><span className="sr">Video {item.name}</span></span>}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${item.name}`}
          style={{ position: "absolute", right: 4, top: 4, width: 26, height: 26, borderRadius: 13, border: 0, background: "rgba(23,32,31,.8)", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={14} />
        </button>
      )}
    </span>
  );
}

/** "Add photos or videos": a drop box that takes several files at once, the picks as tiles, and the size limits. */
export function MediaPicker({ files, onChange, label = "Photos or videos", required = false, onError }: {
  files: File[]; onChange: (files: File[]) => void; label?: string; required?: boolean; onError?: (text: string | null) => void;
}): ReactElement {
  const previews = usePickedPreviews(files);
  function add(list: FileList | null): void {
    if (!list) return;
    const picked = Array.from(list);
    const bad = picked.map(mediaRefusal).find(Boolean) ?? null;
    onError?.(bad);
    onChange([...files, ...picked.filter((f) => !mediaRefusal(f))].slice(0, 20));
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 64, padding: 8, border: `1.5px dashed #A9B4B2`, borderRadius: MEDIA_RADIUS, textAlign: "center", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
        {label}{required ? "" : " (optional)"}
        <span style={{ fontSize: 12, fontWeight: 400, color: BETA.muted }}>{files.length ? `${files.length} picked · tap to add more` : "Tap to take or choose several"}</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: BETA.muted }}>{MEDIA_LIMIT_TEXT}</span>
        <input type="file" multiple accept={MEDIA_ACCEPT} className="sr" aria-label={label} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </label>
      {previews.length > 0 && (
        <ul aria-label={`${label} picked`} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6 }}>
          {previews.map((m, i) => (
            <li key={m.id} style={{ aspectRatio: "1 / 1" }}><PickedTile item={m} onRemove={() => onChange(files.filter((_, j) => j !== i))} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
