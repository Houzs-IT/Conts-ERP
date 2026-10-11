import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { Field } from '../Field';
import { DateField, MoneyInput, PercentInput } from '../inputs';
import ChannelMark from '../ChannelMark';
import { date, dateShort, count, plural, rmShort, rmRange, amount } from '../../lib/format';
import { Select } from '../Select';
import Icon from '../Icon';
import { UnitPicker } from '../booking/UnitPicker';
import { CHANNEL } from '../../lib/vocabulary';
import { COMMISSION, upliftOver } from '../../lib/pricing';
import type { BookingChannel } from '../../lib/types';
import { type CalendarUnit } from './types';
import { runBulk, type BulkBody, type BulkResult } from './bulkRates';
import { errorMessage } from '../../lib/api';

function CentreModal({ title, sub, onClose, onSave, saveLabel, canSave, disabledReason = 'Fill the fields first', children }: { title: string; sub?: string; onClose: () => void; onSave: () => void; saveLabel: string; canSave: boolean; disabledReason?: string; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSave) onSave(); }}>
          <div className="pt-[22px] px-[22px] pb-1"><h2 className="m-0 text-title font-semibold">{title}</h2>{sub && <p className="mt-[5px] mx-0 mb-0 text-copy text-muted-ink">{sub}</p>}</div>
          <div className="px-[22px] py-4 flex flex-col gap-[14px]">{children}</div>
          <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page rounded-b-card flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSave} disabledReason={disabledReason}>{saveLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SetPriceModal({ m, onClose, onSave }: { m: { unit: CalendarUnit; channel: string; dayIso: string; current: number }; onClose: () => void; onSave: (rm: number) => void }) {
  const [sen, setSen] = useState<number | null>(m.current > 0 ? m.current : null);
  const label = m.channel === 'web' ? 'Direct price' : CHANNEL[m.channel as BookingChannel].label;
  return (
    <CentreModal title="Set price" sub={`${m.unit.unitNumber} · ${label} · ${date(m.dayIso)}`} onClose={onClose} saveLabel="Set price" canSave={sen != null && sen >= 0} disabledReason="Enter the price first" onSave={() => { if (sen != null) onSave(sen / 100); }}>
      <MoneyInput label="Price (RM / night)" valueSen={sen} onChangeSen={setSen} required help="Sent to the connected channel for this night. Reservations already made keep their original price." />
    </CentreModal>
  );
}

export type BlockKind = 'maintenance' | 'owner_stay' | 'other';
const BLOCK_KINDS: { key: BlockKind; label: string; help: string }[] = [
  { key: 'maintenance', label: 'Repair', help: 'Repairs or works. Shown as blocked.' },
  { key: 'owner_stay', label: 'Owner stay', help: 'The owner is staying. Shown as an owner stay.' },
  { key: 'other', label: 'Other', help: 'Any other reason. Add a note.' },
];

export function BlockWizard({ units, initial, onClose, onSave }: {
  units: CalendarUnit[]; initial: { unitId?: string; from?: string; to?: string; kind?: BlockKind };
  onClose: () => void; onSave: (v: { unitId: string; from: string; to: string; kind: BlockKind; reason: string }) => void;
}) {
  const [unit, setUnit] = useState(initial.unitId ?? '');
  const [fromD, setFromD] = useState(initial.from ?? ''); const [toD, setToD] = useState(initial.to ?? '');
  const [kind, setKind] = useState<BlockKind>(initial.kind ?? 'maintenance');
  const [reason, setReason] = useState('');
  const valid = !!unit && fromD !== '' && toD !== '' && toD > fromD && (kind !== 'other' || reason.trim() !== '');
  return (
    <CentreModal title="Block nights" sub="Nobody can book these nights on any channel." onClose={onClose} saveLabel="Block nights" canSave={valid}
      disabledReason={kind === 'other' && !reason.trim() ? 'Add a note saying why' : 'Pick the unit and dates first'}
      onSave={() => onSave({ unitId: unit, from: fromD, to: toD, kind, reason: reason.trim() })}>
      <UnitPicker units={units} value={unit} onChange={setUnit} />
      <div className="grid grid-cols-2 gap-3">
        <DateField label="From" value={fromD} onChange={setFromD} />
        <DateField label="To (checkout day)" value={toD} min={fromD || undefined} onChange={setToD} />
      </div>
      <fieldset className="m-0 p-0 border-none flex flex-col gap-[7px]">
        <legend className="p-0 mb-[7px] text-meta font-medium text-muted-ink">Reason</legend>
        <div role="radiogroup" aria-label="Reason" className="grid grid-cols-3 gap-2">
          {BLOCK_KINDS.map(k => (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
              className={`h-10 px-2 rounded-control cursor-pointer font-sans text-copy border border-solid ${kind === k.key ? 'font-semibold border-gold bg-gold-tint text-ink' : 'font-medium border-line bg-card text-muted-ink'}`}>
              {k.label}
            </button>
          ))}
        </div>
        <span className="text-meta text-muted-ink">{BLOCK_KINDS.find(k => k.key === kind)!.help}</span>
      </fieldset>
      <Field label={kind === 'other' ? 'Note' : 'Note (optional)'} placeholder={kind === 'owner_stay' ? 'e.g. Owner and family' : 'e.g. Plumbing works'} value={reason} onChange={e => setReason(e.target.value)}
        help="Shown on the blocked nights. A unit linked to the channels has these nights blocked there too." />
    </CentreModal>
  );
}

/* ------------------------------------------------------------------ */
/* Rate update: three steps in one dialog                              */
/* ------------------------------------------------------------------ */

const PRICE_CHANNELS: ('web' | 'airbnb' | 'booking_com' | 'agoda')[] = ['web', 'airbnb', 'booking_com', 'agoda'];
const CH_LABEL: Record<string, string> = { web: 'Direct', airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda' };
/** Monday first, as the operators read a week. Values are JavaScript weekdays (0 = Sunday). */
const WEEK: { d: number; label: string }[] = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' }, { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MIN_STAY_OPTIONS = [{ value: '', label: 'Keep as is' }, { value: '1', label: '1 night (no minimum)' },
  ...[2, 3, 4, 5, 6, 7, 10, 14, 21, 30].map(n => ({ value: String(n), label: `${n} nights` }))];

export interface RatePricing {
  baseRate: Record<string, number>;
  weekendRate?: Record<string, number | null>;
  savedUplifts?: Record<string, number>;
  upliftShares?: Record<string, number>;
}
export type RateUpdateValue = BulkBody;
interface Range { from: string; to: string }
type Review = { state: 'checking' | 'ready' | 'saving' | 'failed'; result?: BulkResult; error?: string; progress?: [number, number] };
type PriceMode = 'keep' | 'set' | 'up' | 'down';

const addDayIso = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const weekdayIso = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const span = (xs: number[], f: (n: number) => string) => {
  if (!xs.length) return '—';
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return lo === hi ? f(lo) : `${f(lo)}–${amount(hi, { cents: false })}`;
};

/** Up to this many units on the board, Rate update starts with all of them ticked. */
const PRESELECT_MAX = 12;

export function RateUpdate({ units, pricing, initial, onClose, onDone, building, preselect, loadingAll }: {
  units: CalendarUnit[]; pricing: RatePricing; initial: { unitIds?: string[]; from?: string; to?: string; step?: 2 | 3 };
  onClose: () => void;
  /** Every unit saved. The dialog does the saving itself, a few units per request, after showing old and new. */
  onDone: (v: RateUpdateValue, r: BulkResult) => void;
  /** The building the board is showing: the picker starts on it, but every unit can be picked. */
  building?: string; preselect?: string[]; loadingAll?: boolean;
}) {
  const [step, setStepRaw] = useState<1 | 2 | 3 | 4>(initial.step ?? (initial.unitIds?.length && initial.from ? 3 : initial.unitIds?.length ? 2 : 1));
  const [review, setReview] = useState<Review | null>(null);
  // Units already saved by an attempt that then failed part-way: a retry leaves them alone.
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [batch] = useState(() => crypto.randomUUID());
  const busy = review?.state === 'saving' || review?.state === 'checking';
  // Going back to change anything starts the check over; the check then shows already-saved units at their new price.
  const setStep = (n: 1 | 2 | 3 | 4) => { if (busy) return; if (n < 4) { setReview(null); setSaved(new Set()); } setStepRaw(n); };
  const [weekendSen, setWeekendSen] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial.unitIds ?? preselect ?? (units.length <= PRESELECT_MAX ? units.map(u => u.id) : [])));
  const [q, setQ] = useState('');
  const [onlyBuilding, setOnlyBuilding] = useState(building ?? '');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ranges, setRanges] = useState<Range[]>([{ from: initial.from ?? '', to: initial.to ?? initial.from ?? '' }]);
  const [days, setDays] = useState<Set<number>>(new Set(ALL_DAYS));
  const [mode, setMode] = useState<PriceMode>('set');
  const [priceSen, setPriceSen] = useState<number | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [chanOff, setChanOff] = useState<Record<string, boolean>>({});
  const [minStay, setMinStay] = useState('');
  const [stop, setStop] = useState<'same' | 'close' | 'open'>('same');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; units: CalendarUnit[] }>();
    for (const u of units) { const k = u.propertyId ?? u.propertyName; const g = m.get(k) ?? { name: u.propertyName, units: [] }; g.units.push(u); m.set(k, g); }
    return [...m.entries()].map(([id, g]) => ({ id, ...g }));
  }, [units]);
  const needle = q.trim().toLowerCase();
  const inBuilding = onlyBuilding ? groups.filter(g => g.id === onlyBuilding) : groups;
  const shown = needle ? inBuilding.map(g => ({ ...g, units: g.units.filter(u => `${g.name} ${u.unitNumber}`.toLowerCase().includes(needle)) })).filter(g => g.units.length) : inBuilding;
  const chosen = units.filter(u => sel.has(u.id));
  const toggle = (ids: string[], on: boolean) => setSel(s => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });

  // Nights: every chosen weekday of every range, counted once even where ranges overlap.
  const rangeOk = (r: Range) => r.from !== '' && r.to !== '' && r.to >= r.from;
  const nightSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of ranges) if (rangeOk(r)) for (let d = r.from, k = 0; d <= r.to && k < 500; d = addDayIso(d), k++) if (days.has(weekdayIso(d))) s.add(d);
    return s;
  }, [ranges, days]);
  const nights = nightSet.size;
  const allWeek = days.size === 7;

  // Channel rows: the web rate always; a booking site only for units connected to it.
  const linkedCount = (ch: string) => (ch === 'web' ? chosen.length : chosen.filter(u => u.linked?.includes(ch as BookingChannel)).length);
  const pricing_ = mode !== 'keep';
  const channels = PRICE_CHANNELS.filter(ch => linkedCount(ch) > 0 && !chanOff[ch]);
  const pctMax = mode === 'down' ? 90 : 300;
  const valueOk = !pricing_ || (mode === 'set' ? priceSen != null && priceSen > 0 : pct != null && pct > 0 && pct <= pctMax);
  const num = pct ?? 0;
  const changesSomething = pricing_ || minStay !== '' || stop !== 'same';

  // The example the table prices: a weekday night of each chosen unit at its standard web rate, moved as asked.
  const exampleWeb = (u: CalendarUnit) => {
    const base = pricing.baseRate[u.id] ?? 0;
    if (mode === 'set') return priceSen ?? 0;
    if (mode === 'up' || mode === 'down') return Math.max(100, Math.round(base * (1 + (mode === 'up' ? num : -num) / 100) / 100) * 100);
    return base;
  };
  const rowFor = (ch: typeof PRICE_CHANNELS[number]) => {
    const us = ch === 'web' ? chosen : chosen.filter(u => u.linked?.includes(ch as BookingChannel));
    const ups = us.map(u => upliftOver(ch, exampleWeb(u), pricing.savedUplifts?.[`${u.id}:${ch}`], pricing.upliftShares?.[ch]));
    const guest = us.map((u, i) => exampleWeb(u) + ups[i]);
    const keep = ch === 'web' ? guest : guest.map(g => Math.round(g * (1 - COMMISSION[ch as 'airbnb'] / 100)));
    return { n: us.length, ups, guest, keep };
  };

  const step1Ok = chosen.length > 0;
  const step2Ok = ranges.every(rangeOk) && nights > 0;
  const weekendOk = mode !== 'set' || weekendSen == null || weekendSen > 0;
  const step3Ok = changesSomething && valueOk && weekendOk && (!pricing_ || channels.length > 0);
  const total = chosen.length * nights;
  const saveLabel = pricing_ ? `Save and send ${count(total)} ${total === 1 ? 'price' : 'prices'}` : 'Save';

  function value(): RateUpdateValue {
    const lines = ranges.map(r => ({
      from: r.from, to: r.to,
      ...(mode === 'set' ? { baseRate: priceSen ?? 0, ...(weekendSen && (days.has(5) || days.has(6)) ? { weekendRate: weekendSen } : {}) } : mode === 'up' ? { adjustPct: num } : mode === 'down' ? { adjustPct: -num } : {}),
      ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
      ...(stop !== 'same' ? { stopSell: stop === 'close' } : {}),
    }));
    return { unitIds: chosen.map(u => u.id), channels: pricing_ ? channels : [], weekdays: allWeek ? null : [...days], lines };
  }
  /** Step 4: ask the server what each unit's prices are now and would become, without saving anything. */
  async function check() {
    setStepRaw(4);
    setReview({ state: 'checking', progress: [0, chosen.length] });
    try {
      const result = await runBulk(value(), { dryRun: true, nights, batch, onProgress: (d, t) => setReview(r => (r ? { ...r, progress: [d, t] } : r)) });
      setReview({ state: 'ready', result });
    } catch (e) {
      setReview({ state: 'failed', error: errorMessage(e, 'Could not work out the current prices. Try again in a moment.') });
    }
  }
  async function save() {
    const v = value();
    const before = review?.result;
    setReview({ state: 'saving', result: before, progress: [saved.size, v.unitIds.length] });
    const done = new Set(saved);
    try {
      const r = await runBulk(v, { dryRun: false, nights, batch, skip: saved,
        onProgress: (d) => setReview(x => (x ? { ...x, progress: [saved.size + d, v.unitIds.length] } : x)) });
      onDone(v, r);
    } catch (e) {
      for (const id of (e as { done?: string[] }).done ?? []) done.add(id);
      setSaved(done);
      setReview({ state: 'failed', result: before, error: `${done.size ? `${plural(done.size, 'unit')} of ${count(v.unitIds.length)} saved. ` : 'Nothing saved. '}${errorMessage(e, 'Try again in a moment.')}` });
    }
  }

  const unitsSummary = chosen.length === 0 ? 'None yet'
    : (() => {
      const bs = [...new Set(chosen.map(u => u.propertyName))];
      const names = chosen.slice(0, 3).map(u => u.unitNumber).join(', ');
      return `${bs.length === 1 ? bs[0] : plural(bs.length, 'building')}: ${names}${chosen.length > 3 ? ` and ${chosen.length - 3} more` : ''}`;
    })();
  const daysLabel = allWeek ? 'Every night' : `Only ${WEEK.filter(w => days.has(w.d)).map(w => w.label).join(', ')}`;
  const rangesLabel = ranges.filter(rangeOk).map(r => (r.from === r.to ? dateShort(r.from) : `${dateShort(r.from)} – ${date(r.to)}`)).join('; ') || 'None yet';
  const linkedSites = (['airbnb', 'booking_com', 'agoda'] as const).filter(ch => linkedCount(ch) > 0);
  const siteSummary = linkedSites.map(ch => `${CH_LABEL[ch]}: ${plural(linkedCount(ch), 'unit')}`).join(' · ')
    + (linkedSites.length < 3 ? `${linkedSites.length ? '. ' : ''}Not connected, so not changed: ${(['airbnb', 'booking_com', 'agoda'] as const).filter(ch => !linkedSites.includes(ch)).map(ch => CH_LABEL[ch]).join(', ')}.` : '');

  const stepChip = (n: 1 | 2 | 3 | 4, label: string, ok: boolean) => (
    <li key={n}>
      <button type="button" disabled={n === 4 && !(step1Ok && step2Ok && step3Ok)} onClick={() => (n === 4 ? (review ? setStepRaw(4) : void check()) : setStep(n))} aria-current={step === n ? 'step' : undefined}
        className={`h-8 px-3 rounded-full border-none cursor-pointer font-sans text-meta font-medium whitespace-nowrap ${step === n ? 'bg-black text-white' : ok ? 'bg-success-bg text-success' : 'bg-muted text-muted-ink'}`}>
        {n} {label}
      </button>
    </li>
  );
  const summaryBlock = (n: 1 | 2 | 3, title: string, body: ReactNode) => (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink">{n} · {title}</span>
      <div className="text-copy text-ink">{body}</div>
      {step !== n && <button type="button" onClick={() => setStep(n)} className="self-start p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-[var(--color-text-accent)]">Change</button>}
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Update prices" className="fixed inset-0 z-[60] grid place-items-center p-0 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={() => { if (!busy) onClose(); }} className="absolute inset-0" />
      <div className="relative w-full h-full sm:h-auto sm:max-h-[min(860px,92vh)] max-w-[980px] flex flex-col bg-card sm:rounded-card shadow-[var(--shadow-overlay)] overflow-hidden">
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex flex-wrap items-start justify-between gap-3 [border-bottom:1px_solid_var(--color-line)]">
          <div className="min-w-0">
            <h2 className="m-0 text-title font-semibold">Update prices</h2>
            <p className="m-0 mt-1 text-meta text-muted-ink">Only the channels each unit is connected to are changed.</p>
          </div>
          <ol className="m-0 p-0 list-none flex gap-1.5 flex-wrap">
            {stepChip(1, `Units${chosen.length ? ` · ${count(chosen.length)}` : ''}`, step1Ok)}
            {stepChip(2, `Dates${nights ? ` · ${plural(nights, 'night')}` : ''}`, step2Ok)}
            {stepChip(3, 'Prices', step3Ok)}
            {stepChip(4, 'Check', review?.state === 'ready')}
          </ol>
        </div>

        <div className="flex-1 min-h-0 grid md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden md:flex flex-col gap-4 p-5 bg-page [border-right:1px_solid_var(--color-line)] overflow-y-auto">
            {summaryBlock(1, 'Units', unitsSummary)}
            {summaryBlock(2, 'Dates', <>{rangesLabel}<div className="text-meta text-muted-ink">{daysLabel}</div></>)}
            <div className="mt-auto p-3 rounded-card bg-card border border-solid border-line flex flex-col gap-1">
              <span className="text-caption text-muted-ink">Preview before saving</span>
              <span className="text-heading font-semibold [font-variant-numeric:tabular-nums]">{plural(chosen.length, 'unit')} × {plural(nights, 'night')} = {plural(total, 'price')}</span>
              {chosen.length > 0 && <span className="text-meta text-muted-ink">{siteSummary}</span>}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
            {step === 1 && (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or building" aria-label="Search unit or building"
                    className="field-input flex-1 min-w-[180px]" />
                  <Select label="Building" value={onlyBuilding} onChange={setOnlyBuilding} className="w-[200px] max-sm:w-full"
                    options={[{ value: '', label: `All buildings (${count(units.length)} units)` }, ...groups.map(g => ({ value: g.id, label: `${g.name} (${g.units.length})` }))]} />
                  <span className="flex-none text-meta text-muted-ink whitespace-nowrap">Selected {count(chosen.length)}</span>
                  {chosen.length > 0 && <Button size="sm" variant="tertiary" type="button" onClick={() => setSel(new Set())}>Clear</Button>}
                </div>
                <div className="flex flex-col border border-solid border-line rounded-card overflow-hidden">
                  {loadingAll && <div className="px-3 py-2 text-meta text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">Loading the other buildings' units…</div>}
                  {shown.length === 0 && <div className="p-4 text-copy text-muted-ink">{needle ? `No unit matches “${q}”.` : 'No units in this building.'}</div>}
                  {shown.map(g => {
                    const ids = g.units.map(u => u.id);
                    const on = ids.filter(id => sel.has(id)).length;
                    const expanded = !!needle || open[g.id] || false;
                    return (
                      <div key={g.id} className="[border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                        <div className="flex items-center gap-2 px-3 min-h-11 bg-muted/50">
                          <input type="checkbox" aria-label={`All of ${g.name}`} checked={on === ids.length} ref={el => { if (el) el.indeterminate = on > 0 && on < ids.length; }}
                            onChange={() => toggle(ids, on !== ids.length)} className="w-4 h-4 accent-[var(--color-brand-black)] cursor-pointer" />
                          <button type="button" onClick={() => setOpen(o => ({ ...o, [g.id]: !expanded }))} aria-expanded={expanded}
                            className="flex-1 min-w-0 flex items-center gap-2 h-11 p-0 bg-transparent border-none cursor-pointer font-sans text-left text-ink">
                            <span className="flex-1 min-w-0 text-copy font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{g.name}</span>
                            <span className="flex-none text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{on ? `${on} of ${g.units.length}` : g.units.length}</span>
                            <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size="sm" />
                          </button>
                        </div>
                        {expanded && g.units.map(u => (
                          <label key={u.id} className="flex items-center gap-2.5 pl-9 pr-3 min-h-10 cursor-pointer hover:bg-muted/40 [border-top:1px_solid_var(--color-line-soft)]">
                            <input type="checkbox" checked={sel.has(u.id)} onChange={e => toggle([u.id], e.target.checked)} className="w-4 h-4 accent-[var(--color-brand-black)] cursor-pointer" />
                            <span className="flex-1 min-w-0 text-copy text-ink whitespace-nowrap overflow-hidden text-ellipsis">{u.unitNumber}</span>
                            <span className="flex-none flex items-center gap-1">{(u.linked ?? []).map(c => <ChannelMark key={c} ch={c} size={14} />)}</span>
                            <span className="flex-none w-[72px] text-right text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{pricing.baseRate[u.id] ? rmShort(pricing.baseRate[u.id]) : 'No price'}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-col gap-3">
                  {ranges.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                      <DateField label={i === 0 ? 'First night' : `First night (range ${i + 1})`} value={r.from} onChange={v => setRanges(rs => rs.map((x, j) => (j === i ? { ...x, from: v, to: x.to && x.to >= v ? x.to : v } : x)))} />
                      <DateField label="Last night" value={r.to} min={r.from || undefined} onChange={v => setRanges(rs => rs.map((x, j) => (j === i ? { ...x, to: v } : x)))} />
                      {ranges.length > 1
                        ? <Button size="md" variant="tertiary" type="button" aria-label={`Remove range ${i + 1}`} onClick={() => setRanges(rs => rs.filter((_, j) => j !== i))}><Icon name="X" size="sm" /></Button>
                        : <span className="w-10" />}
                    </div>
                  ))}
                  {ranges.length < 20 && <div className="self-start"><Button size="sm" variant="secondary" type="button" icon={<Icon name="Plus" size="sm" />} onClick={() => setRanges(rs => [...rs, { from: '', to: '' }])}>Add another range</Button></div>}
                </div>
                <fieldset className="m-0 p-0 border-none flex flex-col gap-2">
                  <legend className="p-0 mb-2 text-meta font-medium text-muted-ink">Days of the week</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEK.map(w => {
                      const on = days.has(w.d);
                      return (
                        <button key={w.d} type="button" aria-pressed={on} onClick={() => setDays(s => { const n = new Set(s); if (on) n.delete(w.d); else n.add(w.d); return n; })}
                          className={`h-10 min-w-[52px] px-3 rounded-control cursor-pointer font-sans text-copy border border-solid ${on ? 'font-semibold border-gold bg-gold-tint text-ink' : 'font-medium border-line bg-card text-muted-ink'}`}>{w.label}</button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {[{ l: 'Every night', d: ALL_DAYS }, { l: 'Fri and Sat only', d: [5, 6] }, { l: 'Sun to Thu', d: [0, 1, 2, 3, 4] }].map(p => (
                      <button key={p.l} type="button" onClick={() => setDays(new Set(p.d))} className="p-0 bg-transparent border-none cursor-pointer font-sans text-meta font-medium text-[var(--color-text-accent)]">{p.l}</button>
                    ))}
                  </div>
                </fieldset>
                <p className="m-0 text-copy text-ink">{nights ? `${plural(nights, 'night')} will change${allWeek ? '' : ` (${daysLabel.toLowerCase()})`}.` : 'Pick the dates and at least one day of the week.'}</p>
              </>
            )}

            {step === 3 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Nightly price (Direct)" showLabel size="md" value={mode} onChange={v => setMode(v as PriceMode)}
                    options={[{ value: 'set', label: 'Set to this price' }, { value: 'up', label: 'Raise the current price by %' }, { value: 'down', label: 'Lower the current price by %' }, { value: 'keep', label: 'Keep the prices' }]} />
                  {pricing_ && (mode === 'set' ? (
                    <MoneyInput label="Price (RM / night)" valueSen={priceSen} onChangeSen={setPriceSen} placeholder="e.g. 420.00"
                      error={priceSen != null && !valueOk ? 'Enter a price above RM 0.' : undefined} />
                  ) : (
                    <PercentInput label="Percentage" value={pct} onChange={setPct} min={0} max={pctMax} placeholder="e.g. 10"
                      error={pct != null && !valueOk ? `Enter 1 to ${pctMax}.` : undefined} />
                  ))}
                  {mode === 'set' && (days.has(5) || days.has(6)) && (
                    <MoneyInput label="Weekend price, Fri and Sat (optional)" valueSen={weekendSen} onChangeSen={setWeekendSen} placeholder="Same as the nightly price"
                      help="Leave empty to charge the nightly price every night." error={!weekendOk ? 'Enter a price above RM 0, or leave it empty.' : undefined} />
                  )}
                </div>

                <div className="flex-none border border-solid border-line rounded-card overflow-x-auto">
                  <div className="min-w-[520px]">
                    <div className="grid grid-cols-[minmax(150px,1.3fr)_1fr_1fr_1.2fr] gap-3 px-3.5 py-2.5 bg-muted text-meta font-semibold text-muted-ink">
                      <span>Channel</span><span>Markup</span><span>Guest sees</span><span>We receive</span>
                    </div>
                    {PRICE_CHANNELS.map(ch => {
                      const n = linkedCount(ch);
                      const disabled = n === 0;
                      const on = !disabled && !chanOff[ch];
                      const r = rowFor(ch);
                      const markup = ch === 'web' ? 'None' : (() => {
                        const shares = r.ups.map((u, i) => (r.guest[i] - u > 0 ? Math.round((u / (r.guest[i] - u)) * 100) : 0));
                        return new Set(r.ups).size === 1 ? `+ ${rmShort(r.ups[0])}` : new Set(shares).size === 1 ? `+ ${shares[0]}%` : `+ ${span(r.ups, rmShort)}`;
                      })();
                      return (
                        <div key={ch} className={`grid grid-cols-[minmax(150px,1.3fr)_1fr_1fr_1.2fr] gap-3 items-center px-3.5 min-h-12 [border-top:1px_solid_var(--color-line-soft)] ${on || (!pricing_ && !disabled) ? 'text-ink' : 'text-faint'}`}>
                          <label className={`flex items-center gap-2 min-w-0 ${disabled || !pricing_ ? '' : 'cursor-pointer'}`}>
                            {pricing_ && <input type="checkbox" checked={on} disabled={disabled} onChange={e => setChanOff(o => ({ ...o, [ch]: !e.target.checked }))} className="w-4 h-4 accent-[var(--color-brand-black)]" aria-label={`Change ${CH_LABEL[ch]}`} />}
                            <ChannelMark ch={ch === 'web' ? 'direct' : ch} size={18} muted={disabled} />
                            <span className="min-w-0 flex flex-col">
                              <span className="text-copy whitespace-nowrap">{CH_LABEL[ch]}</span>
                              {/* vocab-ok: COMMISSION is the constant's name; the text reads service fee */ ch !== 'web' && <span className="text-caption text-muted-ink">{disabled ? 'Not connected' : n < chosen.length ? `${n} of ${chosen.length} units connected` : `${COMMISSION[ch]}% service fee`}</span>}
                            </span>
                          </label>
                          {disabled ? <><span className="text-copy">Not connected</span><span className="text-copy">—</span><span className="text-copy">—</span></> : <>
                            <span className="text-copy [font-variant-numeric:tabular-nums]">{markup}</span>
                            <span className="text-copy font-semibold [font-variant-numeric:tabular-nums]">{span(r.guest, rmShort)}</span>
                            <span className="text-copy [font-variant-numeric:tabular-nums]">{span(r.keep, rmShort)}{ch !== 'web' && <span className="text-caption text-muted-ink"> after {COMMISSION[ch]}%</span>}</span>
                          </>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="m-0 -mt-2 text-meta text-muted-ink">
                  {pricing_ ? 'Shown for a weekday night. Each channel adds its own markup on top of the nightly price; channels a unit is not connected to are never changed.' : 'Current weekday prices. No price changes; only the minimum nights or blocked nights below change.'}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Select label="Minimum nights" showLabel size="md" value={minStay} onChange={setMinStay} options={MIN_STAY_OPTIONS} />
                  <Select label="Blocked" showLabel size="md" value={stop} onChange={v => setStop(v as typeof stop)}
                    options={[{ value: 'same', label: 'Keep as is' }, { value: 'close', label: 'Block nights (cannot be booked)' }, { value: 'open', label: 'Available' }]} />
                </div>
              </>
            )}

            {step === 4 && <ReviewPanel review={review} units={units} unitCount={chosen.length} nights={nights}
              restrictions={[minStay !== '' ? `Minimum nights: ${minStay === '1' ? 'none' : `${minStay} nights`}` : '', stop === 'close' ? 'Blocked: nobody can book' : stop === 'open' ? 'Blocked: opened for booking' : ''].filter(Boolean)} />}
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 [border-top:1px_solid_var(--color-line)] bg-page flex flex-wrap items-center justify-between gap-3">
          <span className="text-meta text-muted-ink [font-variant-numeric:tabular-nums]">{plural(chosen.length, 'unit')} × {plural(nights, 'night')} = {plural(total, 'price')}</span>
          <div className="flex gap-2 ml-auto">
            {step > 1 && <Button size="md" variant="secondary" type="button" disabled={busy} disabledReason="Working" icon={<Icon name="ChevronLeft" size="sm" />} onClick={() => setStep((step - 1) as 1 | 2 | 3)}>Back</Button>}
            <Button size="md" variant="secondary" type="button" onClick={onClose} disabled={busy} disabledReason="Saving">Cancel</Button>
            {step < 3
              ? <Button size="md" variant="primary" type="button" disabled={step === 1 ? !step1Ok : !step2Ok} disabledReason={step === 1 ? 'Pick at least one unit' : 'Pick the dates and days'} onClick={() => setStep((step + 1) as 2 | 3)}>Next</Button>
              : step === 3
                ? <Button size="md" variant="primary" type="button" disabled={!step1Ok || !step2Ok || !step3Ok}
                    disabledReason={!step1Ok ? 'Pick at least one unit' : !step2Ok ? 'Pick the dates and days' : !changesSomething ? 'Set a price, minimum nights or blocked nights' : !valueOk || !weekendOk ? 'Enter a valid price' : 'Pick at least one channel'}
                    onClick={() => void check()}>Check changes</Button>
                : review?.state === 'failed' && !review.result
                  ? <Button size="md" variant="primary" type="button" onClick={() => void check()}>Check again</Button>
                  : <Button size="md" variant="primary" type="button" loading={busy} disabled={!review?.result} disabledReason="Working out the current prices"
                      onClick={() => void save()}>{review?.state === 'failed' ? (saved.size ? 'Save the rest' : 'Try again') : saveLabel}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** What the save will do, from the server's own dry run: per unit and channel, the price now and after. */
function ReviewPanel({ review, units, unitCount, nights, restrictions }: { review: Review | null; units: CalendarUnit[]; unitCount: number; nights: number; restrictions: string[] }) {
  const SHOW = 200;
  if (!review || review.state === 'checking') {
    const [d, t] = review?.progress ?? [0, unitCount];
    return <p className="m-0 text-copy text-muted-ink" role="status">Working out the current prices… {t > 1 ? `${count(d)} of ${plural(t, 'unit')}` : ''}</p>;
  }
  const r = review.result;
  const name = (id: string) => units.find(u => u.id === id)?.unitNumber ?? id;
  const rows = (r?.changes ?? []).slice().sort((a, b) => name(a.unitId).localeCompare(name(b.unitId)) || PRICE_CHANNELS.indexOf(a.channel as 'web') - PRICE_CHANNELS.indexOf(b.channel as 'web'));
  const skipped = Object.entries(r?.skipped ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="flex flex-col gap-3">
      {review.state === 'failed' && <div role="alert" className="px-3 py-2.5 rounded-control bg-critical-bg text-danger text-copy">{review.error}</div>}
      {review.state === 'saving' && review.progress && (
        <p className="m-0 text-copy text-ink" role="status">Saving… {count(review.progress[0])} of {plural(review.progress[1], 'unit')} done. Keep this open until it finishes.</p>
      )}
      {r && (
        <>
          <p className="m-0 text-copy text-ink">
            <span className="font-semibold">{plural(unitCount, 'unit')} × {plural(nights, 'night')}</span>
            {r.written ? ` · ${plural(r.written, 'price')} to save` : ''}. Nothing is saved until you press Save. Linked channels are updated in the background afterwards.
          </p>
          {restrictions.length > 0 && <ul className="m-0 pl-5 text-copy text-ink">{restrictions.map(x => <li key={x}>{x}</li>)}</ul>}
          {skipped.length > 0 && <p className="m-0 text-meta text-muted-ink">Not connected, left alone: {skipped.map(([c, n]) => `${CH_LABEL[c] ?? c} on ${plural(n, 'unit')}`).join(', ')}.</p>}
          {rows.length > 0 && (
            <div className="border border-solid border-line rounded-card overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-copy [font-variant-numeric:tabular-nums]">
                <thead>
                  <tr className="bg-muted text-meta text-muted-ink text-left">
                    <th className="px-3 py-2 font-semibold">Unit</th><th className="px-3 py-2 font-semibold">Channel</th>
                    <th className="px-3 py-2 font-semibold text-right">Nights</th><th className="px-3 py-2 font-semibold text-right">Now</th><th className="px-3 py-2 font-semibold text-right">New</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, SHOW).map(c => {
                    const same = c.oldMin === c.newMin && c.oldMax === c.newMax;
                    return (
                      <tr key={`${c.unitId}:${c.channel}`} className="[border-top:1px_solid_var(--color-line-soft)]">
                        <td className="px-3 py-2 whitespace-nowrap">{name(c.unitId)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{CH_LABEL[c.channel] ?? c.channel}</td>
                        <td className="px-3 py-2 text-right">{count(c.nights)}</td>
                        <td className="px-3 py-2 text-right text-muted-ink whitespace-nowrap">{rmRange(c.oldMin, c.oldMax)}</td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap ${same ? 'text-muted-ink' : 'font-semibold text-ink'}`}>{same ? 'No change' : rmRange(c.newMin, c.newMax)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > SHOW && <p className="m-0 px-3 py-2 text-meta text-muted-ink [border-top:1px_solid_var(--color-line-soft)]">And {plural(rows.length - SHOW, 'more row')}.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
