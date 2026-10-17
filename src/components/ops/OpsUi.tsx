import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { MediaSourceSheet } from '../Attachments';
import { cx } from '../../lib/design-tokens';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { SearchSelect } from '../Select';
import { time, weekdayDate, dateTimeShort } from '../../lib/format';
import { useToast } from '../Toast';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { UnitPicker } from '../UnitPicker';
import type { RosterUnit } from '../../lib/useUnitRoster';
import { DateField, DateTimeField } from '../inputs';

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

/** One row of choices that reads as tabs: [Today][Tomorrow][Pick date]. Drawn like Metric's Segmented pill switch,
 *  but kept as a tablist because these swap the whole view. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label}
      className={cx('inline-flex items-center p-[3px] gap-[2px] rounded-control bg-muted max-w-full overflow-x-auto [scrollbar-width:none] flex-none', className)}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={cx('h-8 px-3 rounded-[6px] cursor-pointer text-copy whitespace-nowrap transition-colors duration-[var(--motion-fast)]',
              on ? 'bg-card text-ink font-medium shadow-[var(--shadow-card)]' : 'text-muted-ink hover:text-ink')}>
            {o.label}
          </button>
        );
      })}
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
    // A picker inside the dialog closes itself on Escape and marks the key handled; only then is the dialog left open.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [busy, onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 bg-[var(--color-surface-scrim)]">
      <div className="absolute inset-0" onClick={busy ? undefined : onClose} />
      <div ref={ref} style={{ maxWidth: width }} className="relative w-full max-h-[calc(100dvh-32px)] flex flex-col bg-card rounded-card overflow-hidden shadow-[var(--shadow-overlay)]">
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

/** The X at the top of a detail panel (shown as a drawer on narrow screens): the shared drawer close button. */
export { CloseButton } from '../CloseButton';

/* ---------- proof photos and videos: drawn by components/Attachments ---------- */

export type { MediaItem } from '../Attachments';

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
  const [saving, setSaving] = useState(false);
  async function add() {
    const label = adding.trim();
    if (!label || saving) return;
    if (items.some(x => x.label.trim().toLowerCase() === label.toLowerCase())) { setError('That item is already on the list.'); return; }
    setSaving(true);
    try { const r = await api.post<{ data: ChecklistItem[] }>(`/housekeeping/tasks/${taskId}/checklist`, { label }); onChange(r.data); setAdding(''); setError(null); }
    catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); }
    finally { setSaving(false); }
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
          <Button size="sm" variant="secondary" type="button" loading={saving} onClick={() => void add()} disabled={!adding.trim()} disabledReason="Write the item first.">Add</Button>
        </div>
      )}
      {error && <span className="text-meta text-danger mt-1">{error}</span>}
    </div>
  );
}

/* ---------- who does a repair ---------- */

export interface Technician { name: string; kind: 'in_house' | 'contractor'; role: string | null }
export const KIND_WORD: Record<'in_house' | 'contractor', string> = { in_house: 'In-house', contractor: 'Contractor' };

/** Who can be given a job: the company's own people and every contractor used before (GET /maintenance/technicians).
 *  The kind (in-house or contractor) follows from who is picked; a contractor not on the list is typed once. */
export function useTechnicians(on = true) {
  const r = useApi<{ data: Technician[] }>(on ? '/maintenance/technicians' : null);
  return r.data?.data ?? [];
}

export function AssigneePicker({ value, onChange, techs, autoFocus }: { value: string; onChange: (name: string) => void; techs: Technician[]; autoFocus?: boolean }) {
  const known = techs.some(t => t.name === value);
  const [typing, setTyping] = useState(!!value && !known && techs.length > 0);
  const kind = techs.find(t => t.name.toLowerCase() === value.trim().toLowerCase())?.kind ?? (value.trim() ? 'contractor' : null);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {typing ? (
        <input className={INPUT} value={value} onChange={e => onChange(e.target.value)} placeholder="Contractor or company name" aria-label="New contractor name" maxLength={80} autoFocus={autoFocus} />
      ) : (
        <SearchSelect label="Technician or contractor" value={known ? value : ''} onChange={onChange} size="md" placeholder="Search technicians and contractors"
          options={techs.map(t => ({ value: t.name, label: t.name, group: t.kind === 'in_house' ? 'In-house' : 'Contractors' }))} />
      )}
      <span className="text-meta text-muted-ink flex gap-1.5 flex-wrap items-center">
        {kind && <span>{KIND_WORD[kind]}{kind === 'in_house' ? ', a staff account' : ''}.</span>}
        <button type="button" className="text-accent cursor-pointer font-medium" onClick={() => { setTyping(!typing); onChange(''); }}>
          {typing ? 'Pick from the list' : 'New contractor'}
        </button>
      </span>
    </div>
  );
}

/* ---------- damage report: opens a Maintenance job linked to the unit (and the clean) ---------- */

export const CATEGORY: Record<string, string> = { plumbing: 'Plumbing', electrical: 'Electrical', aircon: 'Aircon', furniture: 'Furniture', appliance: 'Appliance', other: 'Other' };

interface CatalogItem { id: string; code: string; name: string; category: string; active: boolean }
const FIELD = ['housekeeper', 'technician'];

/** The one maintenance job form (owner, Oct 2026). "Add maintenance job" on Maintenance and "Report damage" from a
 *  clean are the same form and send the same fields; from a clean the unit is filled in and locked, and the job is
 *  linked to the cleaning task. The office also picks the catalog item (or Other), who does it and a first repair
 *  window here (request M6); the quote and who pays are decided in the job. Cleaners and technicians see the problem
 *  fields only. */
export function MaintenanceJobForm({ unit, units, taskId, onClose, onDone }: {
  /** Fixed unit (from a clean or a unit page). Leave out to pick one. */
  unit?: { id: string; label: string };
  /** Units to pick from when `unit` is not given. */
  units?: RosterUnit[];
  taskId?: string; onClose: () => void; onDone: (id: string) => void;
}) {
  const { user } = useSession();
  const office = !!user && !FIELD.includes(user.role) && user.role !== 'owner';
  const [f, setF] = useState({ unitId: unit?.id ?? '', skuId: '', title: '', category: '', jobType: 'normal' as 'normal' | 'urgent' | 'pass_key', severity: 'minor' as 'minor' | 'major', dueOn: '', needsParts: false, detail: '', assignee: '', from: '', to: '', windowNote: '' });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ unitId?: string; title?: string; category?: string; window?: string; form?: string }>({});
  const picked = usePickedMedia();
  const toast = useToast();
  const techs = useTechnicians(office);
  const catalog = useApi<{ data: CatalogItem[] }>(office ? '/maintenance/skus?active=1' : null);
  const items = (catalog.data?.data ?? []).filter(s => s.active);
  const fromClean = !!taskId;
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));

  function pickItem(id: string) {
    const s = items.find(x => x.id === id);
    // The item fills the kind of problem and, when nothing is written yet, what is wrong; both can still be changed.
    set({ skuId: id, ...(s ? { category: CATEGORY[s.category] ? s.category : 'other', title: f.title.trim() ? f.title : s.name } : {}) });
    if (s) setError(x => ({ ...x, category: undefined, title: undefined }));
  }
  /** A window's end three hours after its start, the same day, when the start is picked first. */
  const endFor = (start: string) => `${start.slice(0, 11)}${String(Math.min(23, Number(start.slice(11, 13)) + 3)).padStart(2, '0')}${start.slice(13)}`;
  async function submit() {
    const bad = { unitId: f.unitId ? undefined : 'Pick the unit.', title: f.title.trim() ? undefined : 'Say what is wrong.', category: f.category ? undefined : 'Pick the kind of problem.',
      window: (f.from || f.to) && !(f.from && f.to) ? 'Give the window a start and an end, or leave both empty.' : f.from && f.to && f.to <= f.from ? 'The window must end after it starts.' : undefined };
    if (bad.unitId || bad.title || bad.category || bad.window) { setError(bad); return; }
    setBusy(true); setError({});
    let id: string, overlaps = 0;
    try {
      const r = await api.post<{ id: string; overlaps?: unknown[] }>('/maintenance/issues', {
        unitId: f.unitId, title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category,
        // Job type (staff comment sheet): the office has Pass key too; a cleaner reporting damage says Normal or Urgent.
        ...(office ? { jobType: f.jobType, severity: f.severity, ...(f.dueOn ? { dueOn: f.dueOn } : {}), ...(f.needsParts ? { needsParts: true } : {}) } : { urgency: f.jobType === 'urgent' ? 'urgent' : 'normal' }),
        reportSource: fromClean ? 'cleaner' : 'staff', sourceTaskId: taskId, source: 'web',
        ...(office && f.skuId && f.skuId !== 'other' ? { skuId: f.skuId } : {}),
        ...(office && f.assignee.trim() ? { assigneeName: f.assignee.trim() } : {}),
        ...(office && f.from && f.to ? { window: { startsAt: f.from, endsAt: f.to, note: f.windowNote.trim() || undefined } } : {}),
      });
      id = r.id; overlaps = r.overlaps?.length ?? 0;
    } catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      const win = fields.windowStartsAt || fields.windowEndsAt;
      setError({ unitId: fields.unitId, title: fields.title, category: fields.category, window: win,
        form: fields.unitId || fields.title || fields.category || win ? undefined : errorMessage(e, 'Not saved. Try again.') });
      setBusy(false); return;
    }
    if (overlaps) toast({ tone: 'warning', title: 'The repair window overlaps a reservation.', body: `It overlaps ${overlaps} ${overlaps === 1 ? 'reservation' : 'reservations'}. Make sure the guest agreed.` });
    // The job is saved; a photo that fails is named, not a reason to undo it.
    if (picked.files.length) {
      setSending(true);
      const failed = await picked.send(id);
      if (failed.length) toast({ tone: 'warning', title: 'Job added, but some photos were not.', body: `Not added: ${failed.join(', ')}. Add them in the job's photos, under The problem.` });
    }
    onDone(id);
  }
  const label = fromClean ? 'Report damage' : 'Add maintenance job';
  return (
    <OpsModal title={label} sub={unit ? `${unit.label}. Opens a Maintenance job on this unit.` : office ? 'The unit, the problem and, if known, who fixes it and when. The quote and who pays are set in the job.' : 'Pick the unit and say what is wrong.'}
      onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>{label}</Button></>}>
      {!unit && (
        <FormRow label="Unit" error={error.unitId} hint="Grouped by building. Type the building or the unit, e.g. agile 13a.">
          <UnitPicker units={units ?? []} value={f.unitId} error={error.unitId} onChange={v => { set({ unitId: v }); setError(x => ({ ...x, unitId: undefined })); }} />
        </FormRow>
      )}
      {office && (
        <FormRow label="Item (optional)" hint={items.length ? 'From the maintenance catalog. Pick Other when it is not on the list.' : catalog.data ? 'The catalog is empty. Add items under Item catalog on Maintenance.' : undefined}>
          <SearchSelect label="Item" size="md" value={f.skuId} onChange={pickItem} placeholder="Search items by name or code" allLabel="No item"
            options={[...items.map(s => ({ value: s.id, label: s.name, hint: s.code, group: CATEGORY[s.category] ?? 'Other' })), { value: 'other', label: 'Other (not on the list)', group: 'Not in the catalog' }]} />
        </FormRow>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Problem category" error={error.category}>
          <select className={INPUT} value={f.category} onChange={e => { set({ category: e.target.value }); setError(x => ({ ...x, category: undefined })); }}>
            <option value="" disabled>Pick one</option>
            {Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormRow>
        <FormRow label={office ? 'Job type' : 'Urgency'} hint={f.jobType === 'urgent' ? 'Affects the next guest; done first.' : f.jobType === 'pass_key' ? 'Hand over or collect a key.' : office ? 'Done in date order.' : undefined}>
          <select className={INPUT} value={f.jobType} onChange={e => set({ jobType: e.target.value as 'normal' | 'urgent' | 'pass_key' })}>
            <option value="normal">Normal</option><option value="urgent">Urgent</option>
            {office && <option value="pass_key">Pass key</option>}
          </select>
        </FormRow>
      </div>
      {office && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Severity" hint="Management's approval rules can ask the owner first for major jobs.">
            <select className={INPUT} value={f.severity} onChange={e => set({ severity: e.target.value as 'minor' | 'major' })}>
              <option value="minor">Minor</option><option value="major">Major</option>
            </select>
          </FormRow>
          <FormRow label="Due (optional)" hint="Normal jobs are worked one by one in this order.">
            <DateField aria-label="Due date" className={INPUT} value={f.dueOn} onChange={v => set({ dueOn: v })} />
          </FormRow>
        </div>
      )}
      {office && (
        <label className="flex items-center gap-2 text-copy cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-black" checked={f.needsParts} onChange={e => set({ needsParts: e.target.checked })} />
          Needs parts or stock (tick Parts arrived on the job when they come)
        </label>
      )}
      <FormRow label="What is wrong" error={error.title}>
        <input className={INPUT} value={f.title} onChange={e => { set({ title: e.target.value }); setError(x => ({ ...x, title: undefined })); }} placeholder="e.g. Aircon not cooling, guest complained" maxLength={160} />
      </FormRow>
      <FormRow label="Details (optional)">
        <textarea className={TEXTAREA} value={f.detail} onChange={e => set({ detail: e.target.value })} placeholder="Where it is, what you saw" maxLength={2000} />
      </FormRow>
      {office && (
        <FormRow label="Who fixes it (optional)" hint="An in-house technician or a contractor. Leave empty to assign later.">
          <AssigneePicker value={f.assignee} onChange={v => set({ assignee: v })} techs={techs} />
        </FormRow>
      )}
      {office && (
        <FormRow label="Repair window (optional)" error={error.window} hint="When the technician may enter, Malaysia time. Leave empty to plan it later.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <DateTimeField aria-label="Window from" className={INPUT} value={f.from}
              onChange={v => { set({ from: v, ...(v && !f.to ? { to: endFor(v) } : {}) }); setError(x => ({ ...x, window: undefined })); }} />
            <DateTimeField aria-label="Window to" className={INPUT} value={f.to} min={f.from || undefined}
              onChange={v => { set({ to: v }); setError(x => ({ ...x, window: undefined })); }} />
          </div>
          {f.from && <input className={cx(INPUT, 'mt-2')} value={f.windowNote} onChange={e => set({ windowNote: e.target.value })} maxLength={300} placeholder="Note for the window (optional), e.g. Between guests" aria-label="Window note" />}
        </FormRow>
      )}
      <ProblemPhotos picked={picked} sending={sending} />
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
}

/** Kept so existing callers (Cleaning, Field today) need no change: the same form with the unit fixed. */
export function ReportDamageModal({ unitId, unitLabel, taskId, onClose, onDone }: {
  unitId: string; unitLabel: string; taskId?: string; onClose: () => void; onDone: (id: string) => void;
}) {
  return <MaintenanceJobForm unit={{ id: unitId, label: unitLabel }} taskId={taskId} onClose={onClose} onDone={onDone} />;
}

/* ---------- photos of the problem, picked before the job exists and sent once it does ---------- */

export interface PickedMedia { key: string; file: File; preview: string | null; video: boolean; state: 'ready' | 'uploading' | 'done' | 'failed'; error?: string }

/** The photos and videos picked in a create form. Previews are freed when the form closes. */
export function usePickedMedia() {
  const [files, setFiles] = useState<PickedMedia[]>([]);
  const live = useRef(files);
  live.current = files;
  useEffect(() => () => live.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []);
  const add = (list: FileList | File[]) => {
    const media = Array.from(list).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    setFiles(fs => [...fs, ...media.map(f => ({ key: crypto.randomUUID(), file: f, video: f.type.startsWith('video/'), state: 'ready' as const, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null }))]);
    return Array.from(list).length - media.length;
  };
  const remove = (key: string) => setFiles(fs => { const f = fs.find(x => x.key === key); if (f?.preview) URL.revokeObjectURL(f.preview); return fs.filter(x => x.key !== key); });
  /** Sends every picked file as a Before photo of the job, one request each, in order. Returns the names that failed;
   *  the job itself is already saved, so a failed photo never undoes it. */
  async function send(issueId: string): Promise<string[]> {
    const failed: string[] = [];
    for (const f of live.current) {
      if (f.state === 'done') continue;
      setFiles(fs => fs.map(x => (x.key === f.key ? { ...x, state: 'uploading' } : x)));
      try {
        await uploadTo(`/maintenance/issues/${issueId}/photos`, { kind: 'before' })(f.file);
        setFiles(fs => fs.map(x => (x.key === f.key ? { ...x, state: 'done' } : x)));
      } catch (e) {
        failed.push(f.file.name);
        setFiles(fs => fs.map(x => (x.key === f.key ? { ...x, state: 'failed', error: errorMessage(e, 'Not added.') } : x)));
      }
    }
    return failed;
  }
  return { files, add, remove, send };
}

/** "Photos of the problem" in a create form: thumbnails of what was picked, a remove button on each, and an add tile.
 *  While sending, each tile shows waiting, uploading, added or not added. */
export function ProblemPhotos({ picked, sending }: { picked: ReturnType<typeof usePickedMedia>; sending: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const vid = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<null | 'choose' | 'again'>(null);
  const [lastKind, setLastKind] = useState<'photo' | 'video'>('photo');
  const isTouch = typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia('(pointer: coarse)').matches;
  const [skipped, setSkipped] = useState(0);
  const done = picked.files.filter(f => f.state === 'done').length;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-meta font-medium text-muted-ink">Photos of the problem (optional)</span>
      <div className="grid grid-cols-4 max-[420px]:grid-cols-3 gap-2">
        {picked.files.map(f => (
          <div key={f.key} title={f.error ?? f.file.name} className={cx('relative aspect-square rounded-control overflow-hidden bg-sunken', f.state === 'failed' && 'border border-solid border-danger-line')}>
            {f.preview ? <img src={f.preview} alt={f.file.name} className={cx('w-full h-full object-cover block', f.state === 'failed' && 'opacity-40')} />
              : <span className="absolute inset-0 grid place-items-center bg-charcoal text-white"><Icon name="Play" size="base" /></span>}
            {f.state === 'uploading' && <span className="absolute inset-0 grid place-items-center bg-[var(--color-surface-scrim)] text-white text-caption font-medium">Uploading</span>}
            {f.state === 'done' && <span className="absolute right-1 bottom-1 w-5 h-5 grid place-items-center rounded-full bg-card text-success"><Icon name="Check" size="sm" style={{ width: 12, height: 12 }} /></span>}
            {f.state === 'failed' && <span className="absolute inset-0 grid place-items-center text-danger text-caption font-medium text-center px-1">Not added</span>}
            {!sending && f.state !== 'done' && (
              <button type="button" onClick={() => picked.remove(f.key)} aria-label={`Remove ${f.file.name}`}
                className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-card text-ink shadow-[var(--shadow-raised)] cursor-pointer hover:bg-muted">
                <Icon name="X" size="sm" style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        ))}
        {!sending && (
          <button type="button" onClick={() => (isTouch ? setSource('choose') : input.current?.click())}
            className="aspect-square flex flex-col items-center justify-center gap-1 p-1.5 rounded-control border border-dashed border-line-strong bg-page text-muted-ink cursor-pointer text-center hover:border-gold hover:text-ink">
            <Icon name="ImagePlus" size="base" />
            <span className="text-meta font-medium leading-tight">Add photos</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" multiple accept="image/*,video/*" className="hidden" aria-label="Photos of the problem"
        onChange={e => { if (e.target.files?.length) setSkipped(picked.add(e.target.files)); e.target.value = ''; }} />
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { if (e.target.files?.length) { setSkipped(picked.add(e.target.files)); setLastKind('photo'); setSource('again'); } e.target.value = ''; }} />
      <input ref={vid} type="file" accept="video/*" capture="environment" className="hidden"
        onChange={e => { if (e.target.files?.length) { setSkipped(picked.add(e.target.files)); setLastKind('video'); setSource('again'); } e.target.value = ''; }} />
      {source && <MediaSourceSheet again={source === 'again'} lastKind={lastKind} count={picked.files.length}
        onPhoto={() => { setSource(null); cam.current?.click(); }} onVideo={() => { setSource(null); vid.current?.click(); }}
        onLibrary={() => { setSource(null); input.current?.click(); }} onClose={() => setSource(null)} />}
      {sending && picked.files.length > 0 && <span className="text-meta text-muted-ink" aria-live="polite">Uploading photos: {done} of {picked.files.length} added.</span>}
      {!sending && skipped > 0 && <span className="text-meta text-danger">{skipped === 1 ? '1 file was' : `${skipped} files were`} not a photo or video and was left out.</span>}
      {!sending && !picked.files.length && <span className="text-meta text-muted-ink">Saved as the job's Before photos. Photos and videos.</span>}
    </div>
  );
}
