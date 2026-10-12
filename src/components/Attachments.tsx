import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import Icon from './Icon';
import { cx } from '../lib/design-tokens';
import { errorMessage } from '../lib/api';

/* One look for every upload in the app: a quiet label with a count, then either a thumbnail grid whose last tile
   adds more (photos and videos), or a list of file rows ending in an "Add file" row (invoices, receipts, CSVs). */

export interface MediaItem { id: string; kind: string; url: string; fileName: string; mimeType?: string; stage?: string | null }

/** "Before · 2": the section label above an attachment area. `sub` is the quieter label of a column inside one. */
export function AttachmentLabel({ title, count, hint, sub }: { title: string; count?: number; hint?: ReactNode; sub?: boolean }) {
  const Tag = sub ? 'span' : 'h3';
  return (
    <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
      <Tag className={cx('m-0 text-ink', sub ? 'text-meta font-medium' : 'text-copy font-semibold')}>{title}</Tag>
      {count !== undefined && <span className={cx('text-muted-ink tabular-nums', sub ? 'text-meta' : 'text-copy')}>· {count}</span>}
      {hint && <span className="ml-auto text-meta text-muted-ink">{hint}</span>}
    </div>
  );
}

const DASHED = 'border border-dashed rounded-control transition-[border-color,background-color,color] duration-[var(--motion-fast)] outline-none';
const DASHED_IDLE = 'border-line-strong bg-page text-muted-ink hover:border-gold hover:bg-gold-tint hover:text-ink focus-visible:border-gold focus-visible:bg-gold-tint focus-visible:text-ink focus-visible:[box-shadow:var(--focus-ring)]';
const DASHED_OVER = 'border-gold bg-gold-tint text-ink';
/** Phones get three large tiles a row; wider panels fit as many as there is room for. */
const GRID = 'grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2';

function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx('w-5 h-5 rounded-full border-2 border-solid border-current [border-top-color:transparent] animate-spin', className)} />;
}

/** Dragging over a child fires dragleave on the parent; count enters so the highlight does not flicker. */
function useDropTarget(onFiles: (files: FileList) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => { e.preventDefault(); depth.current++; setOver(true); },
      onDragOver: (e: DragEvent) => { e.preventDefault(); },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
      onDrop: (e: DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); },
    },
  };
}

/* ---------- photos and videos ---------- */

interface Pending { key: string; name: string; preview: string | null; video: boolean; state: 'queued' | 'uploading' | 'done' | 'failed'; error?: string }

/** Thumbnails of the photos and videos already attached, then an "Add photo" tile. With `upload`, files picked or
 *  dropped go up one at a time (the caller's `upload` sends one file) and show on the grid while they do; refused
 *  files stay as a red tile saying why. Without `upload` the grid is read-only. */
export function MediaGallery({ items, upload, onDone, addLabel = 'Add photo', capture, emptyText, showStage }: {
  items: MediaItem[]; upload?: (file: File) => Promise<unknown>; onDone?: () => void; addLabel?: string;
  capture?: boolean; emptyText?: string; showStage?: boolean;
}) {
  const [view, setView] = useState<MediaItem | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // One standard for every photo and video upload (owner, Oct 2026). On a phone the add tile asks where from:
  // Take photo / Record video open the camera; after each shot the sheet comes back with "Take another", so
  // several can be shot in a row without leaving the job. Photo library picks many at once. Desktop goes
  // straight to the file picker and accepts drag-and-drop.
  const cameraPhoto = useRef<HTMLInputElement>(null);
  const cameraVideo = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<null | 'choose' | 'again'>(null);
  const [lastKind, setLastKind] = useState<'photo' | 'video'>('photo');
  const isTouch = typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia('(pointer: coarse)').matches;
  const openAdd = () => { if (isTouch) setSource('choose'); else input.current?.click(); };
  const busy = pending.some(p => p.state === 'queued' || p.state === 'uploading');

  // An uploaded tile stays until the reloaded list carries the file, so the grid does not blink.
  const shown = items.length;
  useEffect(() => {
    setPending(ps => {
      const keep = ps.filter(p => p.state !== 'done');
      ps.filter(p => p.state === 'done').forEach(p => p.preview && URL.revokeObjectURL(p.preview));
      return keep.length === ps.length ? ps : keep;
    });
  }, [shown]);

  async function send(list: FileList | File[]) {
    const all = Array.from(list);
    const files = all.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const skipped = all.length - files.length;
    setNotice(skipped ? (files.length ? `${skipped === 1 ? '1 file was' : `${skipped} files were`} not a photo or video and was skipped.` : 'Only photos and videos can be added.') : null);
    if (!files.length || !upload) return;
    const batch: Pending[] = files.map(f => ({
      key: crypto.randomUUID(), name: f.name, video: f.type.startsWith('video/'), state: 'queued',
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }));
    setPending(ps => [...ps, ...batch]);
    const mark = (key: string, next: Partial<Pending>) => setPending(ps => ps.map(p => (p.key === key ? { ...p, ...next } : p)));
    for (let i = 0; i < files.length; i++) {
      mark(batch[i].key, { state: 'uploading' });
      try { await upload(files[i]); mark(batch[i].key, { state: 'done' }); }
      catch (e) { mark(batch[i].key, { state: 'failed', error: errorMessage(e, 'Upload failed, try again.') }); }
    }
    onDone?.();
  }
  function dismiss(p: Pending) {
    if (p.preview) URL.revokeObjectURL(p.preview);
    setPending(ps => ps.filter(x => x.key !== p.key));
  }

  const drop = useDropTarget(f => void send(f), !!upload);
  const failed = pending.filter(p => p.state === 'failed');
  const active = pending.filter(p => p.state === 'queued' || p.state === 'uploading').length;
  const total = pending.filter(p => p.state !== 'failed').length;

  if (!upload && !items.length) return emptyText ? <span className="text-copy text-muted-ink">{emptyText}</span> : null;

  return (
    <div className="flex flex-col gap-2 min-w-0" {...drop.handlers}>
      <div className={GRID}>
        {items.map(m => (
          <button key={m.id} type="button" onClick={() => setView(m)} title={m.fileName} aria-label={`Open ${m.fileName}`}
            className="group relative aspect-square rounded-control overflow-hidden bg-sunken border-0 p-0 cursor-pointer outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-card),0_0_0_4px_var(--color-gold)]">
            {m.kind === 'video'
              ? <video src={`${m.url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover block bg-charcoal" />
              : <img src={m.url} alt={m.fileName} loading="lazy" className="w-full h-full object-cover block transition-transform duration-[var(--motion-standard)] group-hover:scale-[1.03]" />}
            <span aria-hidden className="absolute inset-0 rounded-control [box-shadow:inset_0_0_0_1px_var(--color-line-soft)]" />
            {m.kind === 'video' && (
              <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1 h-5 pl-1 pr-1.5 rounded-pill bg-[var(--color-surface-scrim)] text-white text-caption font-medium">
                <Icon name="Play" size="sm" style={{ width: 12, height: 12 }} />Video
              </span>
            )}
            {showStage && m.stage && <span className="absolute top-1.5 left-1.5 px-1.5 rounded-pill text-caption bg-[var(--color-surface-scrim)] text-white">{m.stage.charAt(0).toUpperCase() + m.stage.slice(1)}</span>}
            <span aria-hidden className="absolute top-1.5 right-1.5 w-6 h-6 grid place-items-center rounded-full bg-card text-ink shadow-[var(--shadow-raised)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--motion-fast)]">
              <Icon name="Maximize2" size="sm" style={{ width: 13, height: 13 }} />
            </span>
          </button>
        ))}

        {pending.map(p => (
          <div key={p.key} title={p.error ?? p.name}
            className={cx('relative aspect-square rounded-control overflow-hidden bg-sunken', p.state === 'failed' && 'border border-solid border-danger-line')}>
            {p.preview
              ? <img src={p.preview} alt={p.name} className={cx('w-full h-full object-cover block', p.state === 'failed' && 'opacity-40')} />
              : <span className="absolute inset-0 grid place-items-center bg-charcoal text-white"><Icon name="Play" size="lg" /></span>}
            {(p.state === 'queued' || p.state === 'uploading') && (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[var(--color-surface-scrim)] text-white text-caption font-medium">
                {p.state === 'uploading' ? <Spinner /> : <Icon name="Clock" size="sm" />}
                {p.state === 'uploading' ? 'Uploading' : 'Waiting'}
              </span>
            )}
            {p.state === 'failed' && (
              <>
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1.5 text-center text-danger text-caption font-medium bg-danger-bg/70">
                  <Icon name="CircleAlert" size="sm" />Not added
                </span>
                <button type="button" onClick={() => dismiss(p)} aria-label={`Dismiss ${p.name}`}
                  className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-card text-ink shadow-[var(--shadow-raised)] cursor-pointer hover:bg-muted">
                  <Icon name="X" size="sm" style={{ width: 13, height: 13 }} />
                </button>
              </>
            )}
          </div>
        ))}

        {upload && (
          <button type="button" onClick={openAdd}
            className={cx(DASHED, 'aspect-square flex flex-col items-center justify-center gap-1.5 p-2 cursor-pointer text-center', drop.over ? DASHED_OVER : DASHED_IDLE)}>
            <Icon name={drop.over ? 'Download' : 'ImagePlus'} size="base" />
            <span className="text-meta font-medium leading-tight">{drop.over ? 'Drop here' : addLabel}</span>
          </button>
        )}
      </div>

      {upload && (
        <>
          {/* Library: many at once, photos and videos. `capture` is kept for callers that want camera-only. */}
          <input ref={input} type="file" multiple accept="image/*,video/*" {...(capture ? { capture: 'environment' as const } : {})} className="hidden"
            onChange={e => { if (e.target.files?.length) void send(e.target.files); e.target.value = ''; }} />
          {/* Camera: one shot per open (the OS camera returns one file), then "Take another" re-opens it. */}
          <input ref={cameraPhoto} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { if (e.target.files?.length) { void send(e.target.files); setLastKind('photo'); setSource('again'); } e.target.value = ''; }} />
          <input ref={cameraVideo} type="file" accept="video/*" capture="environment" className="hidden"
            onChange={e => { if (e.target.files?.length) { void send(e.target.files); setLastKind('video'); setSource('again'); } e.target.value = ''; }} />
        </>
      )}
      {source && (
        <MediaSourceSheet again={source === 'again'} lastKind={lastKind} count={items.length + pending.filter(p => p.state !== 'failed').length}
          onPhoto={() => { setSource(null); cameraPhoto.current?.click(); }}
          onVideo={() => { setSource(null); cameraVideo.current?.click(); }}
          onLibrary={() => { setSource(null); input.current?.click(); }}
          onClose={() => setSource(null)} />
      )}
      {busy && <span className="text-meta text-muted-ink" aria-live="polite">Uploading {total - active + 1} of {total}…</span>}
      {notice && <span className="text-meta text-danger">{notice}</span>}
      {failed.map(p => <span key={p.key} className="text-meta text-danger [overflow-wrap:anywhere]">{p.name}: {p.error}</span>)}

      {view && <MediaViewer item={view} onClose={() => setView(null)} />}
    </div>
  );
}

function MediaViewer({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.fileName} className="fixed inset-0 z-[70] grid place-items-center p-4 bg-[rgba(21,21,21,0.86)]" onClick={onClose}>
      <div className="relative max-w-[min(960px,100%)] max-h-full flex flex-col gap-2" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-white text-copy">
          <span className="flex-1 truncate">{item.fileName}</span>
          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-control text-gold hover:bg-[rgba(255,255,255,0.1)]"><Icon name="ExternalLink" size="sm" />Open</a>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-control bg-[rgba(255,255,255,0.1)] text-white cursor-pointer"><Icon name="X" size="sm" /></button>
        </div>
        {item.kind === 'video'
          ? <video src={item.url} controls autoPlay className="max-w-full max-h-[80dvh] bg-black rounded-control" />
          : <img src={item.url} alt={item.fileName} className="max-w-full max-h-[80dvh] object-contain rounded-control" />}
      </div>
    </div>
  );
}

/* ---------- documents ---------- */

export interface FileRowItem { id: string; name: string; label?: string; size?: number | null; href?: string; onOpen?: () => void; onRemove?: () => void; removeLabel?: string }

/** "1.2 MB" / "340 KB". */
export function fileSizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileIcon(name: string) {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/.test(n)) return 'FileImage';
  if (/\.(csv|xlsx?)$/.test(n)) return 'FileSpreadsheet';
  return 'FileText';
}

/** Whether a dropped file is one the picker's `accept` would have offered (".csv,text/csv", "image/*,application/pdf"). */
function accepts(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase();
  return accept.split(',').map(a => a.trim().toLowerCase()).filter(Boolean).some(a =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a);
}

/** One attached file: icon, name, size, open and remove. */
export function FileRow({ file }: { file: FileRowItem }) {
  const open = file.href || file.onOpen;
  const meta = [file.label, file.size != null ? fileSizeLabel(file.size) : null].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-3 min-h-12 pl-3 pr-1.5 py-1.5 rounded-control border border-solid border-line bg-card">
      <span className="w-8 h-8 flex-none grid place-items-center rounded-[6px] bg-muted text-muted-ink"><Icon name={fileIcon(file.name)} size="sm" /></span>
      <span className="flex-1 min-w-0 flex flex-col">
        {file.href
          ? <a href={file.href} target="_blank" rel="noreferrer" className="text-copy font-medium text-ink truncate hover:underline underline-offset-2" title={file.name}>{file.name}</a>
          : <span className="text-copy font-medium text-ink truncate" title={file.name}>{file.name}</span>}
        {meta && <span className="text-meta text-muted-ink truncate">{meta}</span>}
      </span>
      {open && (file.href
        ? <a href={file.href} target="_blank" rel="noreferrer" aria-label={`Open ${file.name}`} className="w-9 h-9 flex-none grid place-items-center rounded-control text-muted-ink hover:bg-muted hover:text-ink"><Icon name="ExternalLink" size="sm" /></a>
        : <button type="button" onClick={file.onOpen} aria-label={`Open ${file.name}`} className="w-9 h-9 flex-none grid place-items-center rounded-control text-muted-ink cursor-pointer hover:bg-muted hover:text-ink"><Icon name="Download" size="sm" /></button>)}
      {file.onRemove && (
        <button type="button" onClick={file.onRemove} aria-label={file.removeLabel ?? `Remove ${file.name}`}
          className="w-9 h-9 flex-none grid place-items-center rounded-control text-muted-ink cursor-pointer hover:bg-danger-bg hover:text-danger">
          <Icon name="X" size="sm" />
        </button>
      )}
    </div>
  );
}

/** The dashed "Add file" row: click to browse or drop a file on it. Dropped files are held to `accept` as the
 *  picker would be. With `chosen`, a single-file picker shows what was picked and offers to change it. */
export function FileDropRow({ label = 'Add file', hint, accept, multiple, onPick, busy, chosen, disabled, ariaLabel }: {
  label?: string; hint?: ReactNode; accept?: string; multiple?: boolean; onPick: (files: FileList) => void;
  busy?: boolean; chosen?: string | null; disabled?: boolean; ariaLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  function take(files: FileList) {
    const ok = Array.from(files).every(f => accepts(f, accept));
    if (!ok) { setRefused('That kind of file is not accepted here.'); return; }
    if (!multiple && files.length > 1) { setRefused('Drop one file at a time.'); return; }
    setRefused(null); onPick(files);
  }
  const drop = useDropTarget(take, !busy && !disabled);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <button type="button" disabled={busy || disabled} onClick={() => input.current?.click()} aria-label={ariaLabel} {...drop.handlers}
        className={cx(DASHED, 'w-full min-h-12 flex items-center gap-3 px-3 py-2 text-left',
          busy || disabled ? 'border-line bg-page text-faint cursor-not-allowed' : cx('cursor-pointer', drop.over ? DASHED_OVER : DASHED_IDLE))}>
        <span className="w-8 h-8 flex-none grid place-items-center rounded-[6px] bg-card [box-shadow:inset_0_0_0_1px_var(--color-line)]">
          {busy ? <Spinner className="w-4 h-4" /> : <Icon name={chosen ? fileIcon(chosen) : drop.over ? 'Download' : 'Plus'} size="sm" />}
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className={cx('text-copy font-medium truncate', busy || disabled ? '' : 'text-ink')}>{busy ? 'Uploading…' : drop.over ? 'Drop to add' : chosen ?? label}</span>
          {hint && !busy && <span className="text-meta text-muted-ink truncate">{chosen ? 'Click or drop to replace' : hint}</span>}
        </span>
        {chosen && !busy && <span className="text-meta font-medium text-accent flex-none">Change</span>}
      </button>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden" aria-label={ariaLabel ?? label}
        onChange={e => { if (e.target.files?.length) { setRefused(null); onPick(e.target.files); } e.target.value = ''; }} />
      {refused && <span className="text-meta text-danger">{refused}</span>}
    </div>
  );
}

/** Attached documents as rows, then the "Add file" row when more can be added. */
export function FileList({ files, add, emptyText }: { files: FileRowItem[]; add?: Parameters<typeof FileDropRow>[0]; emptyText?: string }) {
  if (!files.length && !add) return emptyText ? <span className="text-copy text-muted-ink">{emptyText}</span> : null;
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {files.map(f => <FileRow key={f.id} file={f} />)}
      {add && <FileDropRow {...add} />}
    </div>
  );
}

/** A single cover photo: the empty state is one dashed tile to click or drop on; once there is a photo it fills the
 *  frame and a "Replace photo" chip appears on hover or focus. */
export function CoverPhotoDrop({ photo, onPick, busy, label = 'Add a photo', hint = 'Drop an image here, or click to browse', className }: {
  photo: string | null; onPick: (file: File) => void; busy?: boolean; label?: string; hint?: string; className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState(false);
  function take(files: FileList) {
    const f = files.item(0);
    if (!f) return;
    if (!accepts(f, 'image/*')) { setRefused(true); return; }
    setRefused(false); onPick(f);
  }
  const drop = useDropTarget(take, !busy);
  return (
    <div className={cx('group relative rounded-control overflow-hidden', className)} {...drop.handlers}>
      {photo ? (
        <>
          <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <span aria-hidden className="absolute inset-0 rounded-control [box-shadow:inset_0_0_0_1px_var(--color-line-soft)]" />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-pill bg-card text-ink text-meta font-medium shadow-[var(--shadow-raised)] cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-[var(--motion-fast)] outline-none focus-visible:[box-shadow:var(--focus-ring)]">
            <Icon name="ImagePlus" size="sm" />Replace photo
          </button>
          {drop.over && <span className="absolute inset-0 grid place-items-center bg-gold-tint/90 text-ink text-copy font-medium [box-shadow:inset_0_0_0_1px_var(--color-gold)] rounded-control">Drop to replace</span>}
        </>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className={cx(DASHED, 'absolute inset-0 w-full flex items-center justify-center gap-3 px-4 cursor-pointer text-left', drop.over ? DASHED_OVER : DASHED_IDLE)}>
          <span className="w-10 h-10 flex-none grid place-items-center rounded-full bg-card [box-shadow:inset_0_0_0_1px_var(--color-line)]">
            <Icon name={drop.over ? 'Download' : 'ImagePlus'} size="base" />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-copy font-medium text-ink">{drop.over ? 'Drop to add' : label}</span>
            <span className="text-meta text-muted-ink">{hint}</span>
          </span>
        </button>
      )}
      {busy && (
        <span className={cx('absolute inset-0 flex items-center justify-center gap-2 text-copy font-medium rounded-control',
          photo ? 'bg-[var(--color-surface-scrim)] text-white' : 'bg-page text-ink border border-dashed border-line-strong')}>
          <Spinner className="w-4 h-4" />Uploading…
        </span>
      )}
      {refused && <span className="absolute left-2.5 bottom-2.5 px-2 py-0.5 rounded-control bg-card text-danger text-meta shadow-[var(--shadow-raised)]">Only photos can be added here.</span>}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => { if (e.currentTarget.files?.length) take(e.currentTarget.files); e.currentTarget.value = ''; }} />
    </div>
  );
}

/** Where a photo or video comes from. After a camera shot it reopens as "Take another", so shooting a whole room
 *  is: shot, tap, shot, tap, Done. Rows are 52px for gloves and wet hands. */
export function MediaSourceSheet({ again, lastKind, count, onPhoto, onVideo, onLibrary, onClose }: {
  again: boolean; lastKind: 'photo' | 'video'; count: number;
  onPhoto: () => void; onVideo: () => void; onLibrary: () => void; onClose: () => void;
}) {
  const row = 'min-h-[52px] flex items-center gap-3 px-1 border-0 [border-bottom:1px_solid_var(--color-line-soft)] bg-transparent cursor-pointer text-left text-copy text-ink';
  return (
    <div role="dialog" aria-modal aria-label="Add photo or video" className="fixed inset-0 z-[70] flex flex-col justify-end">
      <div onClick={onClose} className="absolute inset-0 bg-[var(--color-surface-scrim)]" />
      <div className="relative bg-card rounded-t-[20px] pt-2.5 pb-[calc(16px+env(safe-area-inset-bottom))] px-4 flex flex-col">
        <span aria-hidden className="w-[38px] h-1 rounded-full bg-line self-center mb-3" />
        {again ? (
          <>
            <span className="text-heading font-semibold">{lastKind === 'video' ? 'Video added' : 'Photo added'}</span>
            <span className="text-meta text-muted-ink mb-2">{count} on this job so far. Uploads keep going in the background.</span>
            <button type="button" onClick={lastKind === 'video' ? onVideo : onPhoto} className={cx(row, 'font-semibold')}>
              <Icon name={lastKind === 'video' ? 'Video' : 'Camera'} size="sm" /><span className="flex-1">{lastKind === 'video' ? 'Record another' : 'Take another'}</span>
            </button>
            <button type="button" onClick={lastKind === 'video' ? onPhoto : onVideo} className={row}>
              <Icon name={lastKind === 'video' ? 'Camera' : 'Video'} size="sm" /><span className="flex-1">{lastKind === 'video' ? 'Take a photo' : 'Record a video'}</span>
            </button>
            <button type="button" onClick={onLibrary} className={row}><Icon name="Images" size="sm" /><span className="flex-1">From photo library</span></button>
            <button type="button" onClick={onClose} className="mt-3 h-12 rounded-control border-0 bg-ink text-white text-copy font-semibold cursor-pointer">Done</button>
          </>
        ) : (
          <>
            <span className="text-heading font-semibold mb-2">Add photo or video</span>
            <button type="button" onClick={onPhoto} className={row}><Icon name="Camera" size="sm" /><span className="flex-1">Take photo</span></button>
            <button type="button" onClick={onVideo} className={row}><Icon name="Video" size="sm" /><span className="flex-1">Record video</span></button>
            <button type="button" onClick={onLibrary} className={row}>
              <Icon name="Images" size="sm" /><span className="flex-1">From photo library</span><span className="text-meta text-muted-ink">Pick several</span>
            </button>
            <button type="button" onClick={onClose} className="mt-3 h-12 rounded-control border border-solid border-line bg-card text-ink text-copy font-semibold cursor-pointer">Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
