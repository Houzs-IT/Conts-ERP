import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { Popover } from '../calendar/DatePicker';
import { useToast } from '../Toast';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import { plural } from '../../lib/format';
import type { Cleaner } from '../../lib/useCleaners';
import { OpsModal, FormRow, TEXTAREA, uploadTo } from './OpsUi';

/* Pieces of the Cleaning board: the multi-cleaner picker, the expected-arrival editor and the one-step damage report. */

export interface CrewMember { id: string; name: string }

/** Names on a job, short: "Aina", "Aina, Bala", "Aina +2". */
export function crewLabel(crew: CrewMember[], fallback: string | null): string {
  if (!crew.length) return fallback ?? '';
  if (crew.length <= 2) return crew.map(c => c.name).join(', ');
  return `${crew[0].name} +${crew.length - 1}`;
}

/** Tick any number of cleaners. `onSave` gets the ticked ids; with `modes` the person also picks add or replace. */
export function CleanerChecklist({ cleaners, initial, onSave, onCancel, busy, modes, saveLabel = 'Save' }: {
  cleaners: Cleaner[]; initial: string[]; busy?: boolean; modes?: boolean; saveLabel?: string;
  onSave: (ids: string[], mode: 'add' | 'replace') => void; onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [q, setQ] = useState('');
  const shown = cleaners.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  return (
    <div className="flex flex-col gap-2 w-[260px] max-w-full">
      {cleaners.length > 8 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cleaners" aria-label="Search cleaners" autoFocus
          className="h-9 md:h-8 px-2.5 rounded-control border border-solid border-line bg-card text-copy outline-none" />
      )}
      <div role="group" aria-label="Cleaners" className="flex flex-col max-h-[280px] overflow-y-auto -mx-1">
        {shown.map(c => (
          <label key={c.id} className="flex items-center gap-2.5 px-1 h-10 md:h-8 rounded-control hover:bg-muted cursor-pointer text-copy">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4 accent-black flex-none" />
            <span className="flex-1 min-w-0 truncate">{c.name}</span>
            <span className="text-caption text-muted-ink whitespace-nowrap">{c.employmentType === 'outsourced' ? (c.vendorName ?? 'Outsourced') : `${c.busy} today`}</span>
          </label>
        ))}
        {!shown.length && <span className="px-1 py-2 text-meta text-muted-ink">No cleaner by that name.</span>}
      </div>
      {modes && (
        <div className="flex flex-col gap-1 text-meta">
          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} className="accent-black" />Add to whoever is already on each job</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-black" />Replace the cleaners on each job</label>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1 [border-top:1px_solid_var(--color-line-soft)]">
        <span className="text-meta text-muted-ink">{picked.length ? plural(picked.length, 'cleaner') : 'Nobody'}</span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={modes && !picked.length} disabledReason="Tick at least one cleaner." onClick={() => onSave(picked, mode)}>{saveLabel}</Button>
        </span>
      </div>
    </div>
  );
}

/** The cleaners cell of a row: names (or Unassigned), a click opens the picker by it. */
export function CrewCell({ taskId, crew, fallback, cleaners, phone, onSaved, disabled }: {
  taskId: string; crew: CrewMember[]; fallback: string | null; cleaners: Cleaner[]; phone: boolean; onSaved: () => void; disabled?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<CrewMember[] | null>(null);
  useEffect(() => { setShown(null); }, [crew]);
  const now = shown ?? crew;
  const label = crewLabel(now, fallback);
  async function save(ids: string[]) {
    setBusy(true);
    try {
      const r = await api.put<{ cleaners: CrewMember[] }>(`/housekeeping/tasks/${taskId}/cleaners`, { cleanerIds: ids });
      setShown(r.cleaners); setOpen(false);
      toast({ tone: 'success', title: r.cleaners.length ? `Cleaners: ${r.cleaners.map(c => c.name).join(', ')}.` : 'No cleaner on this job now.' });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Cleaners not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    setBusy(false);
  }
  if (disabled) return <span className={cx('truncate', !label && 'text-muted-ink')} title={now.map(c => c.name).join(', ') || undefined}>{label || '—'}</span>;
  return (
    <span className="relative inline-flex min-w-0 max-w-full" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <button type="button" data-popover-trigger onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog"
        title={now.length ? `${now.map(c => c.name).join(', ')} · change` : 'Pick cleaners'}
        className={cx('min-w-0 max-w-full inline-flex items-center gap-1 h-7 px-1.5 -mx-1.5 rounded-control border-none bg-transparent hover:bg-muted cursor-pointer font-sans text-copy text-left',
          label ? 'text-ink' : 'text-danger font-medium')}>
        <span className="truncate">{label || 'Unassigned'}</span>
        <Icon name="ChevronDown" size="sm" color="var(--color-text-muted)" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} phone={phone} align="right" label="Cleaners on this job">
        <CleanerChecklist cleaners={cleaners} initial={now.map(c => c.id)} busy={busy} onCancel={() => setOpen(false)} onSave={ids => void save(ids)} />
      </Popover>
    </span>
  );
}

/** The arriving guest's expected arrival: shows "ETA 16:30" when recorded, and lets staff set or clear it. */
export function EtaEditor({ reservationId, eta, checkInTime, phone, onSaved, compact, children }: {
  reservationId: string; eta: string | null; checkInTime: string; phone: boolean; onSaved: () => void; compact?: boolean; children?: ReactNode;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(eta ?? '');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setShown(undefined); }, [eta]);
  useEffect(() => { if (open) { setValue((shown === undefined ? eta : shown) ?? ''); window.setTimeout(() => input.current?.focus(), 0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = shown === undefined ? eta : shown;
  async function save(t: string | null) {
    setBusy(true);
    try {
      await api.put(`/reservations/${reservationId}/arrival`, { time: t });
      setShown(t); setOpen(false);
      toast({ tone: 'success', title: t ? `Expected arrival ${t} saved.` : 'Expected arrival cleared.', body: t ? 'Clean by and time left now count to it.' : `Back to the check-in time, ${checkInTime}.` });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Arrival time not saved.', body: errorMessage(e, 'Try again in a moment.') }); }
    setBusy(false);
  }
  return (
    <span className="relative inline-flex" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <button type="button" data-popover-trigger onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="dialog"
        title={now ? `Guest expected at ${now}. Change` : 'Record when the guest expects to arrive'}
        className={cx('inline-flex items-center gap-1 rounded-pill border border-solid cursor-pointer font-sans whitespace-nowrap [font-variant-numeric:tabular-nums]',
          compact ? 'h-6 px-1.5 text-caption' : 'h-8 px-2.5 text-meta',
          now ? 'bg-gold-tint border-gold text-[var(--color-text-accent)] font-semibold' : 'bg-card border-line text-muted-ink hover:bg-muted font-medium')}>
        {children ?? (now ? `ETA ${now}` : <><Icon name="Clock" size="sm" />ETA</>)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} phone={phone} label="Expected arrival">
        <form className="flex flex-col gap-2.5 w-[230px] max-w-full" onSubmit={e => { e.preventDefault(); if (/^\d{2}:\d{2}$/.test(value)) void save(value); }}>
          <span className="text-copy font-semibold">Expected arrival</span>
          <span className="text-meta text-muted-ink">The time the guest said they will come. Check-in time stays {checkInTime}.</span>
          <input ref={input} type="time" value={value} onChange={e => setValue(e.target.value)} aria-label="Expected arrival time"
            className="h-10 px-2.5 rounded-control border border-solid border-line bg-card text-copy [font-variant-numeric:tabular-nums]" />
          <div className="flex items-center justify-between gap-2">
            {now ? <button type="button" onClick={() => void save(null)} disabled={busy} className="p-0 border-none bg-transparent cursor-pointer font-sans text-meta text-danger">Clear</button> : <span />}
            <span className="flex gap-1.5">
              <Button size="sm" variant="secondary" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!/^\d{2}:\d{2}$/.test(value)} disabledReason="Pick a time.">Save</Button>
            </span>
          </div>
        </form>
      </Popover>
    </span>
  );
}

/** One step: a short note and photos. Opens a Maintenance job on the unit, linked to this cleaning job. */
export function QuickDamageModal({ unitId, unitLabel, taskId, onClose, onDone }: {
  unitId: string; unitLabel: string; taskId: string; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => { if (list) setFiles(f => [...f, ...Array.from(list).filter(x => x.type.startsWith('image/') || x.type.startsWith('video/'))]); };
  async function submit() {
    const text = note.trim();
    if (!text) { setError('Say what is damaged.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ id: string }>('/maintenance/issues', {
        unitId, title: text.split('\n')[0].slice(0, 160), detail: text.length > 160 || text.includes('\n') ? text : undefined,
        category: 'other', urgency: 'normal', reportSource: 'cleaner', sourceTaskId: taskId, source: 'web',
      });
      const failed: string[] = [];
      for (const f of files) {
        try { await uploadTo(`/maintenance/issues/${r.id}/photos`, { kind: 'before' })(f); } catch { failed.push(f.name); }
      }
      if (failed.length) setError(`Reported, but ${plural(failed.length, 'photo')} did not upload: ${failed.join(', ')}. Add them on the Maintenance job.`);
      else onDone();
      if (failed.length) setBusy(false);
    } catch (e) { setError(errorMessage(e, 'Not saved. Try again.')); setBusy(false); }
  }
  return (
    <OpsModal title="Report damage" sub={`${unitLabel}. Opens a Maintenance job on this unit.`} onClose={onClose} busy={busy}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>Report</Button></>}>
      <FormRow label="What is damaged" error={error}>
        <textarea className={TEXTAREA} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Aircon leaking in the bedroom" maxLength={2000} autoFocus />
      </FormRow>
      <div className="flex flex-col gap-2">
        <span className="text-meta text-muted-ink">Photos or videos</span>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" type="button" icon={<Icon name="Camera" size="sm" />} onClick={() => camera.current?.click()}>Take photo</Button>
          <Button size="sm" variant="secondary" type="button" icon={<Icon name="ImagePlus" size="sm" />} onClick={() => pick.current?.click()}>From gallery</Button>
        </div>
        <input ref={camera} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <input ref={pick} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        {files.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-1 text-meta">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <Icon name={f.type.startsWith('video/') ? 'Video' : 'Image'} size="sm" color="var(--color-text-muted)" />
                <span className="flex-1 min-w-0 truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(x => x.filter((_, j) => j !== i))} className="w-7 h-7 grid place-items-center border-none bg-transparent cursor-pointer text-muted-ink"><Icon name="X" size="sm" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </OpsModal>
  );
}
