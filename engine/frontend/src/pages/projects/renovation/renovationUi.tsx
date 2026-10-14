/* Small building blocks shared by the renovation screens. */

import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { api } from "../../../api/client";
import { Button } from "../../../components/Button";
import { cn } from "../../../lib/utils";
import { TONE_CLASS, type Tone } from "./renovationModel";

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}

export function Dialog({ title, onClose, children, footer, wide = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("w-full bg-surface rounded-t-xl sm:rounded-xl shadow-xl max-h-[90vh] overflow-y-auto", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-ink-secondary hover:text-ink"><X size={18} /></button>
        </div>
        <div className="px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Asks why something is being skipped. Refuses fewer than 3 characters before
    sending; the server checks the same rule. */
export function SkipReasonDialog({
  what,
  onCancel,
  onConfirm,
}: {
  what: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const tooShort = reason.trim().length < 3;
  async function submit() {
    if (tooShort) { setError("Give a reason of at least 3 characters."); return; }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Skip ${what}`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Skipping..." : "Skip"}</Button>
        </>
      }
    >
      <label className="block text-sm text-ink-secondary mb-1" htmlFor="skip-reason">Why is it skipped? This is recorded with your name and the time.</label>
      <textarea
        id="skip-reason"
        ref={ref}
        value={reason}
        onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
        rows={3}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
        placeholder="e.g. Customer bought the appliances himself"
      />
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block text-ink-secondary mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm";
/** Compact field for dense record cards (key log, design steps, procurement dates). */
export const smallInput = "w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-60";
/** Compact Button size (cn has no tailwind-merge, so the base h-9 / px-4 need the important prefix). */
export const smallBtn = "!h-7 !px-2.5 !text-xs";

/** Signature pad. `onChange(true)` fires on the first real stroke and is the only
    signal that someone signed: an untouched canvas still exports a valid (blank)
    PNG, so the parent must never send the canvas without this flag. */
export function SignaturePad({ canvasRef, onChange, label }: {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  onChange: (signed: boolean) => void;
  label: string;
}) {
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const drew = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#16695f"; }
  }, [canvasRef]);
  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    drew.current = false;
    onChange(false);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-ink-secondary">{label}</span>
        <button type="button" onClick={clear} className="text-xs text-primary">Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="block w-full h-28 rounded-md border border-border bg-white"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          last.current = point(e);
          if (!drew.current) { drew.current = true; onChange(true); }
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          const p = point(e);
          if (ctx && last.current) { ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
          last.current = p;
        }}
        onPointerUp={() => { drawing.current = false; last.current = null; }}
        onPointerLeave={() => { drawing.current = false; last.current = null; }}
      />
    </div>
  );
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Signature could not be read"))), "image/png"));
}

export interface GpsFix { lat: number; lng: number; accuracyM: number | null; atIso: string }

/** One location reading; null when denied or unavailable (never blocks). */
export function readGps(timeoutMs = 8000): Promise<GpsFix | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom says always present; older/embedded browsers lack it
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- some browsers/emulators omit accuracy; store null, not undefined
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null, atIso: new Date(p.timestamp).toISOString() }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** An auth-protected R2 image (the browser's <img> cannot carry the bearer). */
export function AuthImage({ path, alt, className, onClick }: { path: string; alt: string; className?: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    api.fetchBlobUrl(path).then((u) => { made = u; if (live) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  if (failed) return <div className={cn("flex items-center justify-center bg-surface-dim text-xs text-ink-secondary", className)}>Photo unavailable</div>;
  if (!url) return <div className={cn("animate-pulse bg-surface-dim", className)} />;
  return onClick
    ? <button type="button" onClick={onClick} className="block"><img src={url} alt={alt} className={cn("object-cover", className)} /></button>
    : <img src={url} alt={alt} className={cn("object-cover", className)} />;
}
