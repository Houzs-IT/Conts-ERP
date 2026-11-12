import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Select } from '../../components/Select';
import { MoneyInput, PercentInput } from '../../components/inputs';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/States';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { channel as CH } from '../../theme';
import { rm, plural, count, buildingName } from '../../lib/format';
import { TONE, cx } from '../../lib/design-tokens';
import { SearchBox } from '../finance/listKit';
import { LEVEL_LABEL, type Level, type PricedUnit, type SaleChannel } from './types';
import type { LevelPrices } from '../../lib/pricing';

/* ------------------------------------------------------------------ *
 * Pricing > Batch edit: pick units (filter by building), say what to
 * change, see old -> new for every unit (a dry run on the server), then
 * save once. Date ranges stay on the Calendar's Change prices.
 * ------------------------------------------------------------------ */

type Action = 'set' | 'pct' | 'clear' | 'percent' | 'amount' | 'default';
interface Op { channel: SaleChannel; level?: Level; action: Action; value?: number | null }
interface Row { channel: SaleChannel; what: string; value: number | null }
interface PriceLine { channel: SaleChannel; level: Level; from: number | null; to: number | null }
interface UnitResult {
  unitId: string; unitNumber: string; propertyName: string; error: string | null;
  before: Record<SaleChannel, LevelPrices>; after: Record<SaleChannel, LevelPrices> | null;
  changes: { prices: PriceLine[]; rules: { channel: string }[]; eve: { from: boolean; to: boolean } | null } | null;
}
interface BatchResult { units: UnitResult[]; changed: number; errors: number; queued?: number }

const CHANNEL_OPTIONS: { value: SaleChannel; label: string }[] = [
  { value: 'web', label: 'Direct' }, { value: 'airbnb', label: 'Airbnb' }, { value: 'booking_com', label: 'Booking.com' }, { value: 'agoda', label: 'Agoda' },
];
const label = (c: SaleChannel) => (c === 'web' ? 'Direct' : CH[c].label);
const lc = (l: Level) => LEVEL_LABEL[l].toLowerCase();

/** What each channel can be told to do, encoded "action:level". */
function whatOptions(c: SaleChannel): { value: string; label: string }[] {
  const per = (l: Level, prefix: string) => [
    { value: `set:${l}`, label: `${prefix}${lc(l)}: set to` },
    { value: `pct:${l}`, label: `${prefix}${lc(l)}: change by %` },
    ...(l === 'base' ? [] : [{ value: `clear:${l}`, label: `${prefix}${lc(l)}: clear (use the price below)` }]),
  ];
  if (c === 'web') return (['base', 'weekend', 'holiday'] as Level[]).flatMap(l => per(l, ''));
  return [
    { value: 'percent:', label: '% above the direct price' },
    { value: 'amount:', label: 'RM above the direct price' },
    { value: 'default:', label: 'Back to the default markup' },
    ...(['base', 'weekend', 'holiday'] as Level[]).flatMap(l => per(l, 'Fixed ')),
  ];
}
const kind = (what: string) => what.split(':')[0] as Action;
const needsMoney = (a: Action) => a === 'set' || a === 'amount';
const needsPct = (a: Action) => a === 'pct' || a === 'percent';

function toOp(r: Row): Op {
  const [action, level] = r.what.split(':') as [Action, string];
  return { channel: r.channel, action, ...(level ? { level: level as Level } : {}), ...(needsMoney(action) || needsPct(action) ? { value: r.value } : {}) };
}
const rowOk = (r: Row) => { const a = kind(r.what); return needsMoney(a) ? r.value != null && (a === 'amount' ? r.value >= 0 : r.value > 0) : needsPct(a) ? r.value != null && r.value !== 0 || (a === 'percent' && r.value === 0) : true; };
const money = (s: number | null) => (s == null ? 'not set' : rm(s, { cents: false }));

export function BatchEdit({ units, onSaved }: { units: PricedUnit[]; onSaved: () => void }) {
  const toast = useToast();
  const [building, setBuilding] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>([{ channel: 'web', what: 'set:holiday', value: null }]);
  const [eve, setEve] = useState<'' | 'on' | 'off'>('');
  const [preview, setPreview] = useState<BatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const buildings = useMemo(() => [...new Set(units.map(u => u.propertyName))].sort((a, b) => a.localeCompare(b)), [units]);
  const shown = useMemo(() => units.filter(u => (!building || u.propertyName === building) && (!q.trim() || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q.trim().toLowerCase()))), [units, building, q]);
  const allShown = shown.length > 0 && shown.every(u => picked.has(u.unitId));
  const ops = rows.map(toOp);
  const ready = picked.size > 0 && (rows.length > 0 || eve !== '') && rows.every(rowOk);
  const body = (dryRun: boolean) => ({ unitIds: [...picked], ops, ...(eve ? { holidayEve: eve === 'on' } : {}), dryRun });

  const edit = (i: number, patch: Partial<Row>) => { setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); setPreview(null); };

  async function runPreview() {
    setBusy(true);
    try { setPreview(await api.post<BatchResult>('/pricing/batch', body(true))); }
    catch (e) { toast({ tone: 'critical', title: 'Could not preview.', body: errorMessage(e, 'Check the changes and try again.') }); }
    finally { setBusy(false); }
  }
  function askSave() {
    if (!preview) return;
    setConfirm({
      title: `Save prices for ${plural(preview.changed, 'unit')}?`,
      body: 'The new prices apply to every night without a custom price, and connected channels are sent them once. Custom prices set on the Calendar stay as they are.',
      meta: `${plural(preview.changed, 'unit')} change · ${plural(picked.size - preview.changed, 'unit')} already at these prices`,
      confirmLabel: 'Save prices', busyLabel: 'Saving…',
      onConfirm: async () => {
        try {
          const r = await api.post<BatchResult>('/pricing/batch', body(false));
          toast({ tone: 'success', title: `Prices saved for ${plural(r.changed, 'unit')}.`, body: r.queued ? `${plural(r.queued, 'connected unit')} sent their new prices to the channels.` : 'No connected unit needed sending.' });
          setPreview(null); onSaved();
        } catch (e) { toast({ tone: 'critical', title: 'Prices not saved.', body: errorMessage(e, 'Nothing was changed. Try again.') }); }
        setConfirm(null);
      },
    });
  }

  return (
    <div className="flex gap-4 items-start flex-wrap">
      <Card style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 420 }}>
        <div className="py-3 px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2">
          <SearchBox label="Search units" placeholder="Search unit or building" value={q} onChange={setQ} />
          <Select label="Building" value={building} onChange={setBuilding} placeholder={`All buildings · ${buildings.length}`} options={buildings.map(b => ({ value: b, label: buildingName(b) }))} />
          <label className="flex items-center gap-2 px-1 text-meta cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ink" checked={allShown} ref={el => { if (el) el.indeterminate = !allShown && shown.some(u => picked.has(u.unitId)); }}
              onChange={() => { setPicked(p => { const n = new Set(p); shown.forEach(u => (allShown ? n.delete(u.unitId) : n.add(u.unitId))); return n; }); setPreview(null); }} />
            <span className="font-semibold">Select all shown · {count(shown.length)}</span>
            <span className="ml-auto text-muted-ink">{count(picked.size)} picked</span>
          </label>
        </div>
        <ul className="m-0 p-0 list-none max-h-[52vh] overflow-y-auto overscroll-contain [scrollbar-width:thin]" aria-label="Units">
          {shown.length === 0 && <li><EmptyState bare kind="filtered" title="No units match." action={{ label: 'Clear filters', onClick: () => { setQ(''); setBuilding(''); } }} /></li>}
          {shown.map(u => (
            <li key={u.unitId}>
              <label className="flex items-center gap-3 py-2.5 px-4 cursor-pointer [border-bottom:1px_solid_var(--color-line-soft)] hover:bg-page">
                <input type="checkbox" className="w-4 h-4 accent-ink" checked={picked.has(u.unitId)}
                  onChange={e => { setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(u.unitId); else n.delete(u.unitId); return n; }); setPreview(null); }} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-copy font-semibold">{u.unitNumber}</span>
                  <span className="text-caption text-muted-ink truncate">{buildingName(u.propertyName)}</span>
                </span>
                <span className="text-caption text-muted-ink tabular-nums text-right">
                  {u.baseRate > 0 ? rm(u.baseRate, { cents: false }) : <span className={TONE.critical.text}>No price</span>}
                  {u.holidayRate ? <><br />hol. {rm(u.holidayRate, { cents: false })}</> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <Card style={{ flex: '2 1 460px', minWidth: 0 }}>
        <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-0.5">
          <span className="text-heading font-semibold">What to change</span>
          <span className="text-meta text-muted-ink">Applies to every picked unit. For specific dates use <Link to="/reservations/calendar" className="text-ink underline underline-offset-2">Change prices on the Calendar</Link>.</span>
        </div>
        <div className="py-4 px-5 flex flex-col gap-3">
          {rows.map((r, i) => {
            const a = kind(r.what);
            return (
              <div key={i} className="grid gap-2 grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)_150px_auto] items-end">
                <Select label="Channel" showLabel className="w-full" value={r.channel} options={CHANNEL_OPTIONS}
                  onChange={v => edit(i, { channel: v as SaleChannel, what: whatOptions(v as SaleChannel).find(o => o.value === r.what)?.value ?? whatOptions(v as SaleChannel)[0].value, value: null })} />
                <Select label="Change" showLabel className="w-full" value={r.what} options={whatOptions(r.channel)} onChange={v => edit(i, { what: v, value: null })} />
                {needsMoney(a) ? <MoneyInput label={a === 'amount' ? 'Amount' : 'Price'} valueSen={r.value} onChangeSen={v => edit(i, { value: v })} minSen={a === 'amount' ? 0 : 1} />
                  : needsPct(a) ? <PercentInput label={a === 'percent' ? 'Above direct' : 'Change'} value={r.value} onChange={v => edit(i, { value: v })} min={a === 'pct' ? -90 : 0} max={300} help={a === 'pct' ? 'Use minus to lower.' : undefined} />
                  : <span className="text-meta text-muted-ink pb-2">No amount needed</span>}
                <Button size="sm" variant="tertiary" aria-label={`Remove change ${i + 1}`} icon={<Icon name="X" size="sm" />} onClick={() => { setRows(rs => rs.filter((_, k) => k !== i)); setPreview(null); }}>Remove</Button>
              </div>
            );
          })}
          <div className="flex gap-2 flex-wrap items-end">
            <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} disabled={rows.length >= 24} onClick={() => { setRows(rs => [...rs, { channel: 'web', what: 'set:base', value: null }]); setPreview(null); }}>Add a change</Button>
            <Select label="Night before a holiday" showLabel className="w-[260px]" value={eve} onChange={v => { setEve(v as typeof eve); setPreview(null); }}
              options={[{ value: '', label: 'Keep as each unit has it' }, { value: 'on', label: 'Also at the holiday price' }, { value: 'off', label: 'Only the holiday night' }]} />
          </div>
          <span className="text-caption text-muted-ink">Direct changes are applied first. A channel set to a fixed price starts from what it charges now on its other levels, and no longer moves with the direct price.</span>
        </div>

        <div className="py-3 px-5 [border-top:1px_solid_var(--color-line)] bg-page flex items-center gap-2 flex-wrap">
          <span className="text-meta text-muted-ink">{picked.size ? `${plural(picked.size, 'unit')} picked` : 'Pick units on the left'}</span>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" icon={<Icon name="Eye" size="sm" />} loading={busy && !confirm} disabled={!ready} disabledReason="Pick units and fill in every change first." onClick={() => void runPreview()}>Preview</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} disabled={!preview || !preview.changed || preview.errors > 0}
            disabledReason={!preview ? 'Preview the change first.' : preview.errors ? 'Some units cannot take this change; see the preview.' : 'Nothing would change.'} onClick={askSave}>
            {preview?.changed ? `Save ${plural(preview.changed, 'unit')}` : 'Save'}
          </Button>
        </div>

        {preview && (
          <div className="[border-top:1px_solid_var(--color-line)]">
            <div className="py-2.5 px-5 text-meta text-muted-ink flex gap-3 flex-wrap">
              <span><span className="font-semibold text-ink">{plural(preview.changed, 'unit')}</span> would change</span>
              {preview.errors > 0 && <span className={TONE.critical.text}>{plural(preview.errors, 'unit')} cannot take it</span>}
              <span>{plural(preview.units.length - preview.changed - preview.errors, 'unit')} already at these prices</span>
            </div>
            <ul className="m-0 p-0 list-none max-h-[50vh] overflow-y-auto" aria-label="Old and new prices">
              {preview.units.map(u => (
                <li key={u.unitId} className="py-2.5 px-5 [border-top:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-copy font-semibold">{buildingName(u.propertyName)} {u.unitNumber}</span>
                    {u.error ? <StatusBadge tone="critical" label="Cannot change" size="sm" /> : !u.changes?.prices.length && !u.changes?.rules.length && !u.changes?.eve ? <StatusBadge tone="neutral" label="No change" size="sm" /> : null}
                  </span>
                  {u.error && <span className={cx('text-meta', TONE.critical.text)}>{u.error}</span>}
                  {u.changes?.prices.map(p => (
                    <span key={`${p.channel}:${p.level}`} className="text-meta flex items-baseline justify-between sm:justify-start gap-x-2 tabular-nums">
                      <span className="sm:w-[200px] text-muted-ink">{label(p.channel)} {lc(p.level)}</span>
                      <span className="flex items-baseline gap-2 whitespace-nowrap">
                        <span className={cx('text-faint', p.from != null && 'line-through')}>{money(p.from)}</span><span aria-hidden>→</span>
                        <span className="font-semibold">{money(p.to)}</span>
                      </span>
                    </span>
                  ))}
                  {u.changes?.rules.filter(r => !u.changes?.prices.some(p => p.channel === r.channel)).map(r => (
                    <span key={r.channel} className="text-meta text-muted-ink">{label(r.channel as SaleChannel)}: how it is priced changes (same prices today)</span>
                  ))}
                  {u.changes?.eve && <span className="text-meta text-muted-ink">Night before a holiday: {u.changes.eve.to ? 'holiday price' : 'normal price'}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
