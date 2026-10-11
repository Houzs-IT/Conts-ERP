import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { UnitPicker } from '../UnitPicker';
import { DateTimeField, MoneyInput } from '../inputs';
import { useToast } from '../Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { cx } from '../../lib/design-tokens';
import { plural, rm } from '../../lib/format';
import { OpsModal, FormRow, INPUT, TEXTAREA, CATEGORY, hm, dayLabel, mytDay, uploadTo, type MediaItem } from './OpsUi';
import { TemplatePicker, AssigneeFields, assigneeOf, assigneeBody, useTemplates, useTechnicians, type Assignee, type RepairTemplate } from './RepairTemplates';

type ChargeTo = 'owner' | 'the_conts' | 'guest_deposit';
const PAYER: Record<ChargeTo, string> = { owner: 'Owner (on the statement)', the_conts: 'Company', guest_deposit: 'Guest (from the deposit)' };
const SOURCE: Record<string, string> = { guest: 'Guest', cleaner: 'Cleaner', inspection: 'Inspection', staff: 'Office' };

/** What a job opened from somewhere else starts with: a clean's "Report damage" gives the unit, the clean, its photos,
 *  a note and "reported by cleaner". */
export interface JobPrefill { unitId?: string; sourceTaskId?: string; reportSource?: string; detail?: string; taskPhotos?: MediaItem[]; title?: string }

interface Slot { startsAt: string; endsAt: string; label: string }
/** "2026-10-13T11:00" (Malaysia) from an ISO instant, for the date-time fields. */
const local = (iso: string) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16);
const slotDay = (iso: string) => { const d = local(iso).slice(0, 10); return d === mytDay(0) ? 'Today' : d === mytDay(1) ? 'Tomorrow' : dayLabel(d); };

/**
 * The New job form, shared by Maintenance ("New job") and Cleaning ("Report damage"): the unit (building first, then
 * the unit), a template that fills the rest, what is wrong, photos and videos, a repair window (the times the unit has no
 * guest are offered), who does it, and whether the unit comes off sale. Everything a template fills stays editable.
 */
export function NewJobForm({ onClose, onDone, money, threshold, prefill, title = 'New job' }: {
  onClose: () => void; onDone: (id: string) => void; money: boolean; threshold: number; prefill?: JobPrefill; title?: string;
}) {
  const toast = useToast();
  const templates = useTemplates();
  const techs = useTechnicians();
  const [unitId, setUnitId] = useState(prefill?.unitId ?? '');
  const [f, setF] = useState({ title: prefill?.title ?? '', category: 'other', urgency: 'normal', reportSource: prefill?.reportSource ?? 'staff', detail: prefill?.detail ?? '', chargeTo: 'owner' as ChargeTo });
  const [who, setWho] = useState<Assignee>({ kind: '', technicianId: '', contractor: '' });
  const [templateId, setTemplateId] = useState('');
  const [blocksUnit, setBlocksUnit] = useState(false);
  const [quoteSen, setQuoteSen] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [taskPhotoIds, setTaskPhotoIds] = useState<string[]>(() => (prefill?.taskPhotos ?? []).map(m => m.id));
  const [win, setWin] = useState({ from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ unitId?: string; title?: string; assignee?: string; window?: string; form?: string }>({});
  const free = useApi<{ slots: Slot[] }>(unitId ? `/maintenance/free-times?unitId=${encodeURIComponent(unitId)}&days=14` : null);
  const tpl = templates.data?.data.find(t => t.id === templateId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map(file => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null })), [files]);
  useEffect(() => () => previews.forEach(p => p.url && URL.revokeObjectURL(p.url)), [previews]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));

  function pickTemplate(t: RepairTemplate | null) {
    setTemplateId(t?.id ?? '');
    if (!t) return;
    setF(x => ({ ...x, title: t.name, category: t.category, urgency: t.urgency }));
    setWho(assigneeOf(t));
    setBlocksUnit(t.blocksUnit);
    if (money) setQuoteSen(t.estimatedCost);
    setError({});
  }

  async function save() {
    const who_ = assigneeBody(who);
    const winBad = (win.from || win.to) && (!win.from || !win.to) ? 'Pick both the start and the end, or neither.' : win.from && win.to <= win.from ? 'The end must be after the start.' : undefined;
    const bad = { unitId: unitId ? undefined : 'Pick the unit.', title: f.title.trim() ? undefined : 'Say what is wrong.', assignee: who_.error ?? undefined, window: winBad };
    if (bad.unitId || bad.title || bad.assignee || bad.window) { setError(bad); return; }
    setBusy(true); setError({});
    let id: string;
    try {
      const r = await api.post<{ id: string }>('/maintenance/issues', {
        unitId, title: f.title.trim(), detail: f.detail.trim() || undefined, category: f.category, urgency: f.urgency, reportSource: f.reportSource,
        ...who_.body, templateId: templateId || undefined, blocksUnit, sourceTaskId: prefill?.sourceTaskId, taskPhotoIds: prefill?.sourceTaskId ? taskPhotoIds : undefined,
        quotedAmount: money && quoteSen != null ? quoteSen : undefined, chargeTo: f.chargeTo,
      });
      id = r.id;
    } catch (e) {
      const fields = e instanceof ApiFailure ? e.fields ?? {} : {};
      const assignee = fields.assigneeUserId ?? fields.assigneeName;
      setError({ unitId: fields.unitId ?? fields.unitNumber, title: fields.title, assignee, form: fields.unitId || fields.unitNumber || fields.title || assignee ? undefined : errorMessage(e, 'Not saved. Try again.') });
      setBusy(false);
      return;
    }
    // The job exists now; a window or a file that fails is reported, and can be added again on the job.
    const problems: string[] = [];
    if (win.from && win.to) {
      try { await api.post(`/maintenance/issues/${id}/windows`, { startsAt: win.from, endsAt: win.to }); }
      catch (e) { problems.push(`The repair window was not saved: ${errorMessage(e, 'try again on the job.')}`); }
    }
    let sent = 0;
    for (const file of files) {
      try { await uploadTo(`/maintenance/issues/${id}/photos`, { kind: 'before' })(file); sent++; }
      catch (e) { problems.push(`${file.name}: ${errorMessage(e, 'upload failed.')}`); }
    }
    if (problems.length) toast({ tone: 'warning', title: 'Job opened, with problems.', body: problems.join(' ') });
    else if (sent) toast({ tone: 'success', title: `Job opened with ${plural(sent, 'file')}.` });
    onDone(id);
  }

  const slots = (free.data?.slots ?? []).slice(0, 8);
  return (
    <OpsModal title={title} sub={prefill?.sourceTaskId ? 'From the clean. Opens a Maintenance job on this unit.' : 'A repair on one unit.'} onClose={onClose} busy={busy} width={600}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Open job</Button></>}>
      <UnitPicker value={unitId} onChange={v => { setUnitId(v); setWin({ from: '', to: '' }); setError(x => ({ ...x, unitId: undefined })); }} error={error.unitId} label="Unit" disabled={!!prefill?.unitId} />
      <TemplatePicker templates={templates.data?.data ?? null} value={templateId} onPick={pickTemplate} />
      {tpl && (
        <div className="rounded-control bg-muted p-2.5 text-meta text-muted-ink flex flex-col gap-0.5">
          <span>{tpl.steps.length ? `Checklist of ${plural(tpl.steps.length, 'step')}` : 'No checklist'}{tpl.parts.length ? ` · items: ${tpl.parts.map(p => `${p.qty} x ${p.name}`).join(', ')}` : ''}</span>
          {tpl.instructions && <span className="text-ink">{tpl.instructions}</span>}
        </div>
      )}
      <FormRow label="What is wrong" error={error.title}>
        <input className={INPUT} value={f.title} onChange={e => { set('title', e.target.value); setError(x => ({ ...x, title: undefined })); }} placeholder="e.g. Aircon not cooling, guest complained" maxLength={160} />
      </FormRow>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <FormRow label="Category"><select className={INPUT} value={f.category} onChange={e => set('category', e.target.value)}>{Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
        <FormRow label="Urgency"><select className={INPUT} value={f.urgency} onChange={e => set('urgency', e.target.value)}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></FormRow>
        <FormRow label="Reported by"><select className={INPUT} value={f.reportSource} onChange={e => set('reportSource', e.target.value)}>{Object.entries(SOURCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormRow>
      </div>
      <FormRow label="Description (optional)"><textarea className={TEXTAREA} value={f.detail} onChange={e => set('detail', e.target.value)} maxLength={2000} placeholder="Where it is, what was seen" /></FormRow>

      <section className="flex flex-col gap-2">
        <span className="text-meta font-medium text-muted-ink">Photos and videos (optional)</span>
        {(prefill?.taskPhotos?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-meta text-muted-ink">From the clean: tick the ones that show the damage.</span>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {prefill!.taskPhotos!.map(m => {
                const on = taskPhotoIds.includes(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} title={m.fileName} onClick={() => setTaskPhotoIds(x => on ? x.filter(i => i !== m.id) : [...x, m.id])}
                    className={cx('relative aspect-square rounded-[6px] overflow-hidden border-2 border-solid p-0 cursor-pointer bg-sunken', on ? 'border-gold' : 'border-transparent opacity-60')}>
                    {m.kind === 'video' ? <span className="absolute inset-0 grid place-items-center bg-charcoal text-white"><Icon name="Play" size="sm" /></span> : <img src={m.url} alt={m.fileName} className="w-full h-full object-cover block" />}
                    {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gold grid place-items-center text-white"><Icon name="Check" size="sm" /></span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {files.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {previews.map((p, i) => (
              <div key={`${p.file.name}-${i}`} className="relative aspect-square rounded-[6px] overflow-hidden bg-sunken">
                {p.url ? <img src={p.url} alt={p.file.name} className="w-full h-full object-cover block" /> : <span className="absolute inset-0 grid place-items-center bg-charcoal text-white"><Icon name="Play" size="sm" /></span>}
                <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => setFiles(x => x.filter((_, n) => n !== i))}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full grid place-items-center bg-[rgba(21,21,21,0.7)] text-white cursor-pointer"><Icon name="X" size="sm" /></button>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" variant="secondary" className="self-start" type="button" icon={<Icon name="ImagePlus" size="sm" />} onClick={() => fileInput.current?.click()}>Add photos or videos</Button>
        <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden"
          onChange={e => { const add = Array.from(e.target.files ?? []).filter(x => x.type.startsWith('image/') || x.type.startsWith('video/')); setFiles(x => [...x, ...add]); e.target.value = ''; }} />
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-meta font-medium text-muted-ink">Repair window (optional): when the technician may enter, Malaysia time</span>
        {unitId && (free.loading && !free.data ? <span className="text-meta text-muted-ink">Looking for times with no guest in the unit…</span>
          : slots.length ? (
            <div className="flex gap-1.5 flex-wrap">
              {slots.map(s => {
                const on = win.from === local(s.startsAt) && win.to === local(s.endsAt);
                return (
                  <button key={s.startsAt} type="button" aria-pressed={on} onClick={() => { setWin({ from: local(s.startsAt), to: local(s.endsAt) }); setError(x => ({ ...x, window: undefined })); }}
                    className={cx('min-h-9 px-2.5 rounded-control border border-solid text-meta text-left cursor-pointer', on ? 'bg-black text-white border-black' : 'bg-card border-line hover:bg-muted')}>
                    <b className="tabular-nums">{slotDay(s.startsAt)} {hm(s.startsAt)}–{hm(s.endsAt)}</b> <span className={on ? '' : 'text-muted-ink'}>· {s.label}</span>
                  </button>
                );
              })}
            </div>
          ) : <span className="text-meta text-muted-ink">No time without a guest in the next 14 days, 09:00 to 18:00. Agree a time with the guest and type it below.</span>)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="From" error={error.window}><DateTimeField aria-label="Window from" className={INPUT} value={win.from} onChange={v => setWin(x => ({ ...x, from: v }))} /></FormRow>
          <FormRow label="To"><DateTimeField aria-label="Window to" className={INPUT} value={win.to} min={win.from || undefined} onChange={v => setWin(x => ({ ...x, to: v }))} /></FormRow>
        </div>
      </section>

      <AssigneeFields label="Assign to (optional)" value={who} onChange={v => { setWho(v); setError(x => ({ ...x, assignee: undefined })); }} technicians={techs.data} error={error.assignee} />
      <label className="flex items-center gap-2 text-copy min-h-8 cursor-pointer">
        <input type="checkbox" className="w-4 h-4 accent-black" checked={blocksUnit} onChange={e => setBlocksUnit(e.target.checked)} />
        Block the unit until fixed
      </label>
      <div className="grid grid-cols-2 gap-3">
        {money && <FormRow label="Quote, RM (optional)" hint={quoteSen != null && quoteSen > threshold && f.chargeTo === 'owner' ? `Above ${rm(threshold, { cents: false })}: the owner approves first.` : undefined}>
          <MoneyInput className={INPUT} valueSen={quoteSen} onChangeSen={setQuoteSen} maxSen={100_000_000} aria-label="Quote in RM" /></FormRow>}
        <FormRow label="Who pays"><select className={INPUT} value={f.chargeTo} onChange={e => set('chargeTo', e.target.value as ChargeTo)}>{(Object.keys(PAYER) as ChargeTo[]).map(p => <option key={p} value={p}>{PAYER[p]}</option>)}</select></FormRow>
      </div>
      {error.form && <span className="text-meta text-danger" role="alert">{error.form}</span>}
    </OpsModal>
  );
}
