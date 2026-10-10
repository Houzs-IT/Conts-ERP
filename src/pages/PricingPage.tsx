import { useMemo, useState } from 'react';
import { COMMISSION } from '../lib/pricing';
import { color } from '../theme';
import { channel as CH } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { DateField, MoneyInput } from '../components/inputs';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { rm, dateRange, todayMyt, plural } from '../lib/format';
import { Select, SearchSelect } from '../components/Select';
import { usePhone, SearchBox } from './finance/listKit';
import { EmptyState } from '../components/States';
import { SYNC } from '../lib/vocabulary';
import { TONE, cx } from '../lib/design-tokens';
import type { BookingChannel, SyncState, Tone } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';

// The channels that carry an uplift over the web rate. Direct is the web rate
// itself, so it never appears in the uplift table — only as the reference.
type OtaChannel = 'airbnb' | 'booking_com' | 'agoda';
const OTA: OtaChannel[] = ['airbnb', 'booking_com', 'agoda'];

// Commission each platform takes off the guest price. Informational: it is what
// turns the EXTERNAL sell price into the INTERNAL amount we actually keep.

// Channels a push can target, web rate included.
const PUSHABLE: BookingChannel[] = ['direct', 'airbnb', 'booking_com', 'agoda'];

interface ChannelRate {
  channel: OtaChannel;
  /** Sen added on top of the base web rate before the guest sees it. Editable. */
  upliftSen: number;
  /** The share of the base rate this uplift follows while nobody has set it by hand; null once set. */
  upliftShare?: number | null;
  sync: SyncState | 'not_connected';
}
interface Unit {
  unitId: string;
  unitNumber: string;
  propertyName: string;
  /** INTERNAL. The nightly cost floor — cleaning, linen and fixed allocation.
   *  We never want the net after commission to fall under this. */
  costFloor: number;
  /** EXTERNAL. The direct/web sell price, before any channel uplift. */
  baseRate: number;
  /** EXTERNAL. The direct/web price of a Friday or Saturday night; null sells the weekend at the base rate. */
  weekendRate: number | null;
  rates: ChannelRate[];
}
interface Payload { units: Unit[]; generatedAt: string }
type RateRow = ChannelRate & { guestPays: number; weekend: number; commission: number; youKeep: number; belowFloor: boolean; syncLabel: string; syncTone: Tone };

const mk = (
  unitId: string, unitNumber: string, propertyName: string,
  costFloor: number, base: number,
  uplift: [number, number, number], sync: [SyncState, SyncState, SyncState],
): Unit => ({
  unitId, unitNumber, propertyName, costFloor, baseRate: base, weekendRate: Math.round(base * 1.22),
  rates: OTA.map((channel, i) => ({ channel, upliftSen: uplift[i], sync: sync[i] })),
});

const FALLBACK: Payload = {
  generatedAt: '',
  units: [
    mk('u1', '#A-12-03', 'Vista Jaya One', 11800, 28400, [3400, 5100, 4500], ['synced', 'synced', 'failed']),
    mk('u2', '#B-08-11', 'Arcoris Mont Kiara', 9900, 23100, [2800, 4200, 3700], ['synced', 'synced', 'synced']),
    mk('u3', '#2207', 'Tribeca', 13200, 31800, [3800, 5700, 5100], ['synced', 'queued', 'synced']),
    mk('u4', '#15-06', 'Scarletz', 10600, 26500, [3200, 4800, 4200], ['synced', 'synced', 'synced']),
  ],
};

// The push range starts today (Malaysia) and runs two weeks by default; it used to be fixed dates in the past.
const TODAY = () => todayMyt();
const DEFAULT_TO = () => todayMyt(13);

// Money input. The original object's `font:inherit` made font-family AND font-size
// inherit from context (12px in the date label, 16px in a rate cell). Reproduced
// as independent longhand inherits so tabular-nums is not reset by a font shorthand.
const INPUT_CLASS = 'box-border h-[34px] px-[10px] py-0 text-ink bg-card border border-solid rounded-control outline-none [font-family:inherit] [font-size:inherit] [font-variant-numeric:tabular-nums]';

/** Read `?unitId=` from the hash first (hash router) then the querystring. */
function readUnitId(): string | null {
  try {
    const h = window.location.hash || '';
    const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
    const fromHash = new URLSearchParams(q).get('unitId');
    if (fromHash) return fromHash;
    return new URLSearchParams(window.location.search).get('unitId');
  } catch { return null; }
}

/** Click-to-edit money value. Commits on Enter or blur, discards on Escape.
 *  Money is integer sen; the input only ever handles RM at the very edge. */
function EditableMoney({ sen, onCommit, ariaLabel, tone, minSen = 0 }: {
  sen: number; onCommit: (sen: number) => void; ariaLabel: string; tone?: 'floor' | 'warn'; minSen?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const tooLow = draft != null && draft < minSen;

  function begin() { setDraft(sen); setEditing(true); }
  // Enter on a value below the minimum keeps the field open with its message; blur or Escape discards it.
  function commit(keepOpenIfBad: boolean) {
    if (draft == null || tooLow) { if (!keepOpenIfBad) setEditing(false); return; }
    if (draft !== sen) onCommit(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <MoneyInput
        autoFocus valueSen={draft} onChangeSen={setDraft} aria-label={ariaLabel} minSen={minSen}
        error={tooLow ? `Must be at least ${rm(minSen)}.` : undefined}
        onBlur={() => commit(false)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className={cx(INPUT_CLASS, 'w-full max-w-[120px] ml-auto border-line-strong')}
      />
    );
  }
  return (
    <button
      onClick={begin} aria-label={`Edit ${ariaLabel}`}
      className={cx(
        'inline-flex items-center gap-1.5 ml-auto py-[3px] px-1.5 rounded-[6px] border border-solid border-transparent bg-transparent cursor-pointer [font-family:inherit] text-copy font-medium [font-variant-numeric:tabular-nums]',
        tone === 'warn' ? TONE.warning.text : tone === 'floor' ? 'text-muted-ink' : 'text-ink',
      )}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color.border; e.currentTarget.style.background = color.muted; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
    >
      {rm(sen, { cents: false })}
      <Icon name="Pencil" size="sm" color={color.faint} />
    </button>
  );
}

function Tag({ label, kind }: { label: string; kind: 'internal' | 'external' }) {
  const external = kind === 'external';
  return (
    <span className={cx(
      'inline-flex items-center h-[18px] px-[7px] py-0 rounded-pill text-caption font-semibold tracking-[0.03em] border border-solid',
      external ? 'bg-gold-tint text-gold-ink border-[#EADCBD]' : 'bg-muted text-muted-ink border-line',
    )}>{label}</span>
  );
}

/** A channel's Friday/Saturday price: the weekend web rate (else the base) plus the uplift. An uplift nobody set
 *  by hand is a share of that night's web price, as the server works it out (functions/_lib/channelPrice.ts). */
function weekendPrice(u: { baseRate: number; weekendRate: number | null }, r: { upliftSen: number; upliftShare?: number | null }) {
  const web = u.weekendRate ?? u.baseRate;
  return web + (r.upliftShare != null ? Math.round(web * r.upliftShare) : r.upliftSen);
}

export default function PricingPage() {
  const { data, loading, error, reload } = useApi<Payload>('/pricing/rules', FALLBACK);
  const toast = useToast();

  const units = data?.units ?? [];

  // Optimistic overlays — there is no backend in dev.
  const [unitEdits, setUnitEdits] = useState<Record<string, { baseRate?: number; costFloor?: number; weekendRate?: number | null }>>({});
  const [upliftEdits, setUpliftEdits] = useState<Record<string, number>>({}); // key `${unitId}:${channel}`

  const [selectedId, setSelectedId] = useState<string | null>(readUnitId());
  const [pushSel, setPushSel] = useState<Record<string, boolean>>(
    { direct: true, airbnb: true, booking_com: true, agoda: true },
  );
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(DEFAULT_TO);
  const phone = usePhone();
  const [q, setQ] = useState('');
  const [building, setBuilding] = useState('');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  // Effective units after overlays.
  const rows = useMemo(() => units.map(u => {
    const ue = unitEdits[u.unitId];
    return {
      ...u,
      baseRate: ue?.baseRate ?? u.baseRate,
      weekendRate: ue && 'weekendRate' in ue ? ue.weekendRate ?? null : u.weekendRate,
      costFloor: ue?.costFloor ?? u.costFloor,
      // An uplift nobody set by hand is a share of the base rate, so an edited base rate moves it too: the
      // server prices the other nights that way, and a push must send the same figure.
      rates: u.rates.map(r => ({ ...r, upliftShare: upliftEdits[`${u.unitId}:${r.channel}`] !== undefined ? null : r.upliftShare, upliftSen: upliftEdits[`${u.unitId}:${r.channel}`]
        ?? (r.upliftShare != null && ue?.baseRate !== undefined ? Math.round(ue.baseRate * r.upliftShare) : r.upliftSen) })),
    };
  }), [units, unitEdits, upliftEdits]);

  const selected = rows.find(u => u.unitId === selectedId) ?? rows[0] ?? null;
  const buildings = useMemo(() => [...new Set(rows.map(u => u.propertyName))].sort((a, b) => a.localeCompare(b)), [rows]);
  const listed = useMemo(() => rows
    .filter(u => (!building || u.propertyName === building) && (!q.trim() || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber, 'en', { numeric: true })), [rows, building, q]);
  const noRate = rows.filter(u => u.baseRate <= 0).length;

  function setBase(unitId: string, baseRate: number) {
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], baseRate } }));
    toast({ tone: 'success', title: 'Base web rate updated.', body: 'Push to send the new rate to each connected channel.' });
    void api.put('/rates', { unitId, baseRate }).catch(notifyFailure);
  }
  function setWeekend(unitId: string, sen: number) {
    // RM 0 clears it: weekend nights then sell at the base rate.
    const weekendRate = sen > 0 ? sen : null;
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], weekendRate } }));
    toast({ tone: 'success', title: weekendRate ? 'Weekend rate updated.' : 'Weekend rate cleared.', body: weekendRate ? 'Friday and Saturday nights without their own price use it on every channel.' : 'Friday and Saturday nights now sell at the base rate.' });
    void api.put('/rates', { unitId, weekendRate }).catch(notifyFailure);
  }
  function setFloor(unitId: string, costFloor: number) {
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], costFloor } }));
    toast({ tone: 'neutral', title: 'Cost floor updated.', body: 'Internal only. The floor is never sent to a channel.' });
    void api.put('/rates', { unitId, costFloor }).catch(notifyFailure);
  }
  function setUplift(unitId: string, ch: OtaChannel, upliftSen: number) {
    setUpliftEdits(e => ({ ...e, [`${unitId}:${ch}`]: upliftSen }));
    toast({ tone: 'success', title: `${CH[ch].label} uplift updated.`, body: 'Push to apply it over your chosen dates.' });
    void api.put('/rates', { unitId, channel: ch, uplift: upliftSen }).catch(notifyFailure);
  }

  function pushRates() {
    if (!selected) return;
    const channels = PUSHABLE.filter(c => pushSel[c]);
    if (channels.length === 0) return;
    const names = channels.map(c => CH[c].label).join(', ');
    const range = dateRange(from, to);
    setDialog({
      title: 'Push rates',
      body: `This sends the current rates to ${names} for every open night in the range. Confirmed bookings keep the rate they were sold at.`,
      meta: `${selected.propertyName} ${selected.unitNumber} · ${range} · ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'}`,
      confirmLabel: 'Push rates', busyLabel: 'Pushing…',
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.post('/rates/bulk', {
            unitIds: [selected.unitId], channels, from, to,
            baseRate: selected.baseRate,
            uplifts: Object.fromEntries(selected.rates.map(r => [r.channel, r.upliftSen])),
          });
          toast({ tone: 'success', title: 'Rates saved.', body: `${names} prices saved for ${range}. Units connected to a booking site are updated there automatically.` });
        } catch (e) {
          toast({ tone: 'critical', title: 'Rates were not saved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
        }
        setBusy(false); setDialog(null);
      },
    });
  }

  const rateRows: RateRow[] = selected ? selected.rates.map(r => {
    const guestPays = selected.baseRate + r.upliftSen;
    const commission = COMMISSION[r.channel];
    const youKeep = Math.round(guestPays * (1 - commission / 100));
    const s = r.sync === 'not_connected' ? { label: 'Not connected', tone: 'neutral' as const } : SYNC[r.sync];
    return { ...r, guestPays, weekend: weekendPrice(selected, r), commission, youKeep, belowFloor: youKeep < selected.costFloor, syncLabel: s.label, syncTone: s.tone };
  }) : [];
  const rateColumns: Column<RateRow>[] = [
    { key: 'channel', label: 'Channel', type: 'channel', value: r => r.channel, hideable: false, width: 150,
      render: r => (
        <span className="flex items-center gap-2.5 min-w-0">
          <ChannelMark ch={r.channel} size={20} />
          <span className="flex flex-col min-w-0">
            <span className="text-copy">{CH[r.channel].label}</span>
            <span className="text-caption text-faint">{r.commission}% fee</span>
          </span>
        </span>
      ) },
    { key: 'uplift', label: 'Uplift', type: 'money', value: r => r.upliftSen, width: 110,
      render: r => <EditableMoney sen={r.upliftSen} ariaLabel={`${CH[r.channel].label} uplift`} onCommit={s2 => selected && setUplift(selected.unitId, r.channel, s2)} /> },
    { key: 'guestPays', label: 'Guest pays', type: 'money', value: r => r.guestPays, width: 100,
      render: r => <span className="font-semibold tabular-nums">{rm(r.guestPays, { cents: false })}</span> },
    { key: 'weekend', label: 'Weekend', type: 'money', value: r => r.weekend, width: 100,
      render: r => <span className="text-muted-ink tabular-nums">{rm(r.weekend, { cents: false })}</span> },
    { key: 'youKeep', label: 'You keep', type: 'money', value: r => r.youKeep, width: 110,
      render: r => <span className={cx('tabular-nums', r.belowFloor ? TONE.critical.text : 'text-ink')}>{rm(r.youKeep, { cents: false })}</span>,
      sub: r => (r.belowFloor ? <span className={cx('text-caption', TONE.critical.text)}>Below floor</span> : null) },
    { key: 'sync', label: 'Sync', type: 'status', value: r => r.sync, status: r => ({ label: r.syncLabel, tone: r.syncTone }), width: 130,
      render: r => <Badge tone={r.syncTone} label={r.syncLabel} size="sm" /> },
  ];

  return (
    <>
      <PageHeader
        title="Pricing"
        sub={`${plural(rows.length, 'unit')}${noRate ? ` · ${noRate} with no base rate` : ''} · Friday and Saturday nights use each unit's weekend rate`}
      />

      {error && <StaleBanner message={`Showing the last rates we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? (
        <Card><TableSkeleton rows={5} cols={4} /></Card>
      ) : rows.length === 0 ? (
        <EmptyState title="No units to price yet." body="Add a unit to set its rates." />
      ) : (
        <div className="flex gap-4 items-start flex-wrap">
          {/* Unit selector. On a phone it is a searchable picker above the editor, not 139 cards to scroll past. */}
          {phone ? (
            <SearchSelect label="Unit" showLabel className="w-full" placeholder="Search unit or building" value={selected?.unitId ?? ''} onChange={v => v && setSelectedId(v)}
              options={rows.map(u => ({ value: u.unitId, label: u.unitNumber, group: u.propertyName, hint: u.baseRate > 0 ? rm(u.baseRate, { cents: false }) : 'No base rate' }))} />
          ) : (
          <Card style={{ flex: '0 1 280px', minWidth: 240, maxWidth: 320 }}>
            <div className="py-3 px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2">
              <SearchBox label="Search units" placeholder="Search unit or building" value={q} onChange={setQ} />
              <Select label="Building" value={building} onChange={setBuilding} placeholder={`All buildings · ${buildings.length}`} options={buildings.map(b => ({ value: b, label: b }))} />
              <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted-ink px-1">Units · {listed.length === rows.length ? rows.length : `${listed.length} of ${rows.length}`}</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto [scrollbar-width:thin]">
            {listed.length === 0 && <EmptyState bare kind="filtered" title="No units match." action={{ label: 'Clear filters', onClick: () => { setQ(''); setBuilding(''); } }} />}
            {listed.map(u => {
              const on = selected?.unitId === u.unitId;
              const failed = u.rates.filter(r => r.sync === 'failed').length;
              const queued = u.rates.filter(r => r.sync === 'queued').length;
              const linked = u.rates.filter(r => r.sync !== 'not_connected').length;
              const syncNote = failed ? `${failed} to fix` : queued ? `${queued} queued` : linked ? 'All synced' : 'Not connected';
              return (
                <button
                  key={u.unitId} onClick={() => setSelectedId(u.unitId)}
                  className={cx(
                    'flex flex-col gap-[3px] w-full text-left py-3 px-4 cursor-pointer [font:inherit]',
                    '[border-bottom:1px_solid_var(--color-line-soft)]',
                    on ? '[border-left:3px_solid_var(--color-gold)] bg-gold-tint' : '[border-left:3px_solid_transparent] bg-transparent',
                  )}
                >
                  <span className="text-copy font-semibold">{u.unitNumber}</span>
                  <span className="text-meta text-muted-ink">{u.propertyName} · {u.baseRate > 0 ? rm(u.baseRate, { cents: false }) : <span className={TONE.critical.text}>No base rate</span>}</span>
                  <span className={cx('text-caption', failed ? TONE.critical.text : 'text-faint')}>{syncNote}</span>
                </button>
              );
            })}
            </div>
          </Card>
          )}

          {/* Selected unit detail */}
          {selected && (
            <Card style={{ flex: '1 1 420px', minWidth: 300 }}>
              <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line)] flex items-baseline justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-heading font-semibold">{selected.propertyName} {selected.unitNumber}</span>
                  <span className="text-meta text-muted-ink">Tap a rate to change it. It is saved straight away; Push rates sends prices for chosen dates to the channels.</span>
                </div>
              </div>

              {/* Base web rate (external) vs cost floor (internal) */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-px bg-line [border-bottom:1px_solid_var(--color-line)]">
                <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-meta text-muted-ink">Base web rate</span>
                    <Tag label="SELL" kind="external" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption text-faint">Direct · per night</span>
                    <EditableMoney sen={selected.baseRate} ariaLabel="base web rate" minSen={1} tone={selected.baseRate <= 0 ? 'warn' : undefined} onCommit={s => setBase(selected.unitId, s)} />
                  </div>
                  {selected.baseRate <= 0 && <span className={cx('text-meta font-medium', TONE.critical.text)}>No base rate. Channels would be sent RM 0; set one before pushing.</span>}
                </div>
                <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-meta text-muted-ink">Weekend web rate</span>
                    <Tag label="SELL" kind="external" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption text-faint">{selected.weekendRate ? 'Fri and Sat nights' : 'Not set · uses the base rate'}</span>
                    <EditableMoney sen={selected.weekendRate ?? selected.baseRate} ariaLabel="weekend web rate" onCommit={s => setWeekend(selected.unitId, s)} />
                  </div>
                </div>
                <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-meta text-muted-ink">Cost floor</span>
                    <Tag label="INTERNAL" kind="internal" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption text-faint">Never sent to a channel</span>
                    <EditableMoney sen={selected.costFloor} ariaLabel="cost floor" tone="floor" onCommit={s => setFloor(selected.unitId, s)} />
                  </div>
                </div>
              </div>

              <DataTable<RateRow> id="pricing.channels" urlPrefix="ch." bare noViews noToolbar pageSize={0} maxHeight="none"
                columns={rateColumns} rows={rateRows} rowKey={r => r.channel} noun={['channel', 'channels']}
                renderCard={r => (
                  <span className="flex flex-col gap-2.5">
                    <span className="flex items-center gap-2.5">
                      <ChannelMark ch={r.channel} size={20} />
                      <span className="flex flex-col min-w-0 flex-1">
                        <span className="text-copy">{CH[r.channel].label}</span>
                        <span className="text-caption text-faint">{r.commission}% fee</span>
                      </span>
                      <Badge tone={r.syncTone} label={r.syncLabel} size="sm" />
                    </span>
                    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="flex flex-col gap-0.5"><dt className="text-caption text-muted-ink">Uplift</dt>
                        <dd className="m-0"><EditableMoney sen={r.upliftSen} ariaLabel={`${CH[r.channel].label} uplift`} onCommit={s2 => selected && setUplift(selected.unitId, r.channel, s2)} /></dd></div>
                      <div className="flex flex-col gap-0.5"><dt className="text-caption text-muted-ink">Guest pays</dt>
                        <dd className="m-0 text-copy font-semibold [font-variant-numeric:tabular-nums]">{rm(r.guestPays, { cents: false })}</dd></div>
                      <div className="flex flex-col gap-0.5"><dt className="text-caption text-muted-ink">Weekend</dt>
                        <dd className="m-0 text-copy text-muted-ink [font-variant-numeric:tabular-nums]">{rm(r.weekend, { cents: false })}</dd></div>
                      <div className="flex flex-col gap-0.5"><dt className="text-caption text-muted-ink">You keep</dt>
                        <dd className={cx('m-0 text-copy [font-variant-numeric:tabular-nums]', r.belowFloor ? TONE.critical.text : 'text-ink')}>{rm(r.youKeep, { cents: false })}{r.belowFloor && ' · below floor'}</dd></div>
                    </dl>
                  </span>
                )} />

              <div className="py-[10px] px-5 [border-bottom:1px_solid_var(--color-line)] flex gap-4 flex-wrap text-caption text-muted-ink">
                <span className="inline-flex items-center gap-1.5"><Tag label="SELL" kind="external" /> what the guest pays on the channel</span>
                <span className="inline-flex items-center gap-1.5"><Tag label="INTERNAL" kind="internal" /> what you keep after the platform fee</span>
              </div>

              {/* Push rates */}
              <div className="py-4 px-5 flex flex-col gap-[14px] bg-page">
                <span className="text-meta font-semibold">Push rates</span>
                <div className="flex gap-2 flex-wrap">
                  {PUSHABLE.map(c => {
                    const on = !!pushSel[c];
                    return (
                      <button
                        key={c} onClick={() => setPushSel(p => ({ ...p, [c]: !p[c] }))}
                        aria-pressed={on}
                        className={cx(
                          'inline-flex items-center gap-[7px] h-[34px] pl-[10px] pr-3 py-0 rounded-pill cursor-pointer [font-family:inherit] text-copy border border-solid',
                          on ? 'font-semibold border-gold bg-gold-tint text-ink' : 'font-medium border-line bg-card text-muted-ink',
                        )}
                      >
                        <ChannelMark ch={c} size={18} muted={!on} />
                        {CH[c].label}
                        {on && <Icon name="Check" size="sm" color={color.goldInk} />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-[14px] flex-wrap items-end">
                  <label className="flex flex-col gap-[5px] text-meta text-muted-ink">
                    From
                    <DateField aria-label="From" value={from} min={TODAY()} onChange={setFrom}
                      className={cx(INPUT_CLASS, 'w-[160px] text-left border-line')} />
                  </label>
                  <label className="flex flex-col gap-[5px] text-meta text-muted-ink">
                    To
                    <DateField aria-label="To" value={to} min={from} onChange={setTo}
                      className={cx(INPUT_CLASS, 'w-[160px] text-left border-line')} />
                  </label>
                  <div className="ml-auto">
                    <Button
                      size="sm" variant="primary" icon={<Icon name="Send" size="sm" />}
                      onClick={pushRates}
                      disabled={PUSHABLE.every(c => !pushSel[c]) || !from || !to || to < from}
                      disabledReason="Pick at least one channel and a valid date range first."
                    >
                      Push rates
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </>
  );
}
