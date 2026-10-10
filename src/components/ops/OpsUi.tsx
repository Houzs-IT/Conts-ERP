import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';
import { api, errorMessage } from '../../lib/api';
import { time, weekdayDate, dateTimeShort } from '../../lib/format';

/* ---------- small pieces shared by Cleaning, Maintenance, Today and the field app ---------- */

/** The status of one clean; its words and colour are entity "cleaning" in lib/status.ts. */
export type CleanStatus = 'done' | 'cleaning' | 'ready' | 'guest_in' | 'unassigned' | 'waiting' | 'unplanned';
export const KIND_LABEL: Record<string, string> = { turnover: 'Standard', light_clean: 'Light', deep_clean: 'Deep' };

/** "1 h 20 m" / "45 min". */
export function minutesLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`;
}

/** Time left until an instant. Red under two hours, struck through once past. */
export function TimeLeft({ at, now, done }: { at: string | null | undefined; now: number; done?: boolean }) {
  if (!at || done) return <span className="text-faint">—</span>;
  const min = (Date.parse(at) - now) / 60000;
  if (min <= 0) return <span className="text-danger font-semibold">Guest due now</span>;
  return <span className={cx('[font-variant-numeric:tabular-nums]', min < 120 ? 'text-danger font-semibold' : 'text-ink')}>{minutesLabel(min)}</span>;
}

/** HH:MM in Malaysia from an ISO instant. */
export const hm = (iso: string | null | undefined) => (iso ? time(iso) : '');
/** "Sat 10 Oct" for a YYYY-MM-DD day. */
export const dayLabel = (day: string) => weekdayDate(day);
/** "10 Oct 14:00" from an ISO instant. */
export const stamp = (iso: string | null | undefined) => (iso ? dateTimeShort(iso) : '');
/** YYYY-MM-DD in Malaysia, offset by days. */
export const mytDay = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);

/** One row of choices that reads as tabs: [Today][Tomorrow][Pick date]. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex border border-solid border-line rounded-control overflow-hidden bg-card flex-none', className)}>
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}
          className={cx('h-9 px-3.5 text-copy cursor-pointer whitespace-nowrap [&+&]:[border-left:1px_solid_var(--color-line)]',
            o.value === value ? 'bg-black text-white font-medium' : 'bg-card text-ink hover:bg-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pill tabs with counts: Open 7 · Awaiting owner approval 1 · Done · History. */
export function PillTabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
      {tabs.map(t => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}
          className={cx('h-9 px-3.5 rounded-pill text-copy font-medium cursor-pointer whitespace-nowrap border border-solid flex-none',
            t.value === value ? 'bg-black text-white border-black' : 'bg-card text-ink border-line hover:bg-muted')}>
          {t.label}{t.count !== undefined && <span className={cx('ml-1.5 [font-variant-numeric:tabular-nums]', t.value === value ? 'text-gold' : 'text-muted-ink')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A form dialog: title, body, and the buttons at the bottom right (secondary left of primary). */
export function OpsModal({ title, sub, children, footer, onClose, busy, width = 480 }: {
  title: string; sub?: ReactNode; children: ReactNode; footer: ReactNode; onClose: () => void; busy?: boolean; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [busy, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 bg-[rgba(21,21,21,0.44)]">
      <div className="absolute inset-0" onClick={busy ? undefined : onClose} />
      <div ref={ref} style={{ maxWidth: width }} className="relative w-full max-h-[calc(100dvh-32px)] flex flex-col bg-card rounded-card overflow-hidden [box-shadow:0_12px_32px_rgba(21,21,21,0.16)]">
        <div className="px-[22px] pt-5 pb-3 flex flex-col gap-1">
          <h2 className="m-0 text-title font-semibold">{title}</h2>
          {sub && <div className="text-copy text-muted-ink">{sub}</div>}
        </div>
        <div className="px-[22px] pb-4 overflow-y-auto flex flex-col gap-3.5">{children}</div>
        <div className="px-[22px] py-3.5 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-2 flex-wrap">{footer}</div>
      </div>
    </div>
  );
}

/** Label above a control, error under it. */
export function FormRow({ label, children, error, hint }: { label: string; children: ReactNode; error?: string | null; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-meta font-medium text-muted-ink">{label}</span>
      {children}
      {error ? <span className="text-meta text-danger">{error}</span> : hint ? <span className="text-meta text-muted-ink">{hint}</span> : null}
    </label>
  );
}
export const INPUT = 'h-10 w-full box-border px-3 rounded-control border border-solid border-line bg-card text-copy text-ink';
export const TEXTAREA = 'w-full box-border px-3 py-2 rounded-control border border-solid border-line bg-card text-copy text-ink min-h-[76px] resize-y';

/** The X at the top of a detail panel (shown as a drawer on narrow screens). */
export function CloseButton({ onClick, label = 'Close details' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="w-9 h-9 flex-none grid place-items-center rounded-control border border-solid border-line bg-card text-muted-ink cursor-pointer hover:bg-muted">
      <Icon name="X" size="sm" />
    </button>
  );
}

/* ---------- proof photos and videos ---------- */

export interface MediaItem { id: string; kind: string; url: string; fileName: string; mimeType?: string; stage?: string | null }

/** Thumbnails: photos as images, videos as a play tile. Click opens the file full size. */
export function MediaGrid({ items, cols = 4 }: { items: MediaItem[]; cols?: number }) {
  const [view, setView] = useState<MediaItem | null>(null);
  if (!items.length) return null;
  return (
    <>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {items.map(m => (
          <button key={m.id} type="button" onClick={() => setView(m)} title={m.fileName}
            className="relative aspect-square rounded-[6px] overflow-hidden bg-sunken border-0 p-0 cursor-pointer">
            {m.kind === 'video'
              ? <span className="absolute inset-0 grid place-items-center bg-charcoal text-white"><Icon name="Play" size="lg" /><span className="absolute bottom-1 left-1 right-1 text-caption truncate text-[var(--color-text-on-dark)]">Video</span></span>
              : <img src={m.url} alt={m.fileName} loading="lazy" className="w-full h-full object-cover block" />}
            {m.stage && <span className="absolute top-1 left-1 px-1.5 rounded-pill text-caption bg-[rgba(21,21,21,0.7)] text-white capitalize">{m.stage}</span>}
          </button>
        ))}
      </div>
      {view && (
        <div role="dialog" aria-modal="true" aria-label={view.fileName} className="fixed inset-0 z-[70] grid place-items-center p-4 bg-[rgba(21,21,21,0.86)]" onClick={() => setView(null)}>
          <div className="relative max-w-[min(960px,100%)] max-h-full flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-white text-copy">
              <span className="flex-1 truncate">{view.fileName}</span>
              <a href={view.url} target="_blank" rel="noreferrer" className="text-gold">Open</a>
              <button type="button" onClick={() => setView(null)} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-control bg-[rgba(255,255,255,0.1)] text-white cursor-pointer"><Icon name="X" size="sm" /></button>
            </div>
            {view.kind === 'video'
              ? <video src={view.url} controls autoPlay className="max-w-full max-h-[80dvh] bg-black rounded-control" />
              : <img src={view.url} alt={view.fileName} className="max-w-full max-h-[80dvh] object-contain rounded-control" />}
          </div>
        </div>
      )}
    </>
  );
}

/** Drop zone and picker for any number of photos and videos. Files go up one at a time; the caller's `upload`
 *  sends one file. Says how far it got and which files were refused, and why. */
export function MediaDrop({ upload, onDone, label = 'Add photos or videos', capture, compact }: {
  upload: (file: File) => Promise<unknown>; onDone: () => void; label?: string; capture?: boolean; compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function send(list: FileList | File[]) {
    const files = Array.from(list).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const skipped = Array.from(list).length - files.length;
    if (!files.length) { setErrors(skipped ? ['Only photos and videos can be added.'] : []); return; }
    setErrors(skipped ? [`${skipped} file${skipped === 1 ? ' was' : 's were'} not a photo or video and were skipped.`] : []);
    setProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try { await upload(files[i]); }
      catch (e) { failed.push(`${files[i].name}: ${errorMessage(e, 'upload failed, try again.')}`); }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (failed.length) setErrors(x => [...x, ...failed]);
    onDone();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void send(e.dataTransfer.files); }}
        className={cx('flex items-center justify-center gap-2 rounded-control border border-dashed text-copy text-muted-ink text-center',
          compact ? 'min-h-11 px-3' : 'min-h-[72px] px-4 py-3 flex-col', over ? 'border-gold bg-gold-tint' : 'border-line-strong bg-card')}>
        {progress ? (
          <span className="text-ink">Uploading {progress.done} of {progress.total}…</span>
        ) : (
          <>
            {!compact && <span>Drop photos or videos here, or</span>}
            <Button size="sm" variant="secondary" type="button" icon={<Icon name="ImagePlus" size="sm" />} onClick={() => input.current?.click()}>{label}</Button>
          </>
        )}
        <input ref={input} type="file" multiple accept="image/*,video/*" {...(capture ? { capture: 'environment' as const } : {})} className="hidden"
          onChange={e => { if (e.target.files?.length) void send(e.target.files); e.target.value = ''; }} />
      </div>
      {errors.map((e, i) => <span key={i} className="text-meta text-danger">{e}</span>)}
    </div>
  );
}

/** Uploads one file to an endpoint as multipart `file` plus extra fields. */
export function uploadTo(path: string, extra: Record<string, string> = {}) {
  return (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return api.post(path, fd);
  };
}

/* ---------- checklist ---------- */

export interface ChecklistItem { key: string; label: string; done: boolean; doneBy: string | null; custom: boolean }

export function Checklist({ taskId, items, readOnly, onChange }: { taskId: string; items: ChecklistItem[]; readOnly?: boolean; onChange: (items: ChecklistItem[]) => void }) {
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function toggle(it: ChecklistItem) {
    const optimistic = items.map(x => x.key === it.key ? { ...x, done: !x.done } : x);
    onChange(optimistic);
    try { const r = await api.post<{ data: ChecklistItem[] }>(`/housekeeping/tasks/${taskId}/checklist`, { key: it.key, done: !it.done }); onChange(r.data); setError(null); }
    catch (e) { onChange(items); setError(errorMessage(e, 'Not saved. Try again.')); }
  }
  async function add() {
    const label = adding.trim();
    if (!label) return;
    try { const r = await api.post<{ data: ChecklistItem[] }>(`/housekeeping/tasks/${taskId}/checklist`, { label }); onChange(r.data); setAdding(''); setError(null); }
    catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); }
  }
  return (
    <div className="flex flex-col">
      {items.map(it => (
        <label key={it.key} className={cx('flex items-center gap-2.5 min-h-9 text-copy', readOnly ? 'cursor-default' : 'cursor-pointer')}>
          <input type="checkbox" checked={it.done} disabled={readOnly} onChange={() => void toggle(it)} className="w-[18px] h-[18px] accent-black flex-none" />
          <span className={cx('flex-1', it.done && 'text-muted-ink line-through')}>{it.label}</span>
        </label>
      ))}
      {!readOnly && (
        <div className="flex gap-2 mt-1.5">
          <input value={adding} onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
            placeholder="Add an item, e.g. Replace kettle" aria-label="Add a checklist item" className={cx(INPUT, 'h-9')} />
          <Button size="sm" variant="secondary" type="button" onClick={() => void add()} disabled={!adding.trim()} disabledReason="Write the item first.">Add</Button>
        </div>
      )}
      {error && <span className="text-meta text-danger mt-1">{error}</span>}
    </div>
  );
}

/* ---------- damage report: opens a Maintenance job linked to the unit (and the clean) ---------- */

export const CATEGORY: Record<string, string> = { plumbing: 'Plumbing', electrical: 'Electrical', aircon: 'Aircon', furniture: 'Furniture', appliance: 'Appliance', other: 'Other' };

export function ReportDamageModal({ unitId, unitLabel, taskId, onClose, onDone }: {
  unitId: string; unitLabel: string; taskId?: string; onClose: () => void; onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!title.trim()) { setError('Say what is broken.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: string }>('/maintenance/issues', {
        unitId, title: title.trim(), detail: detail.trim() || undefined, category, urgency,
        reportSource: taskId ? 'cleaner' : 'staff', sourceTaskId: taskId, source: 'web',
      });
      onDone(r.id);
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title="Report damage" sub={`${unitLabel}. Opens a Maintenance job on this unit.`} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>Report damage</Button></>}>
      <FormRow label="What is broken" error={error}>
        <input className={INPUT} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Shower head leaking" maxLength={160} />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Category">
          <select className={INPUT} value={category} onChange={e => setCategory(e.target.value)}>
            {Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormRow>
        <FormRow label="Urgency">
          <select className={INPUT} value={urgency} onChange={e => setUrgency(e.target.value as 'normal' | 'urgent')}>
            <option value="normal">Normal</option><option value="urgent">Urgent (affects the next guest)</option>
          </select>
        </FormRow>
      </div>
      <FormRow label="Details (optional)">
        <textarea className={TEXTAREA} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Where it is, what you saw" maxLength={2000} />
      </FormRow>
    </OpsModal>
  );
}
