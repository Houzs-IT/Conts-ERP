import { useMemo, useState } from 'react';
import { color } from '../theme';
import { channel as CH } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Dialog, type DialogSpec } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, notifyFailure } from '../lib/api';
import { rm, dateRange } from '../lib/format';
import { SYNC } from '../lib/vocabulary';
import { TONE, cx } from '../lib/design-tokens';
import type { BookingChannel, SyncState } from '../lib/types';

// The channels that carry an uplift over the web rate. Direct is the web rate
// itself, so it never appears in the uplift table — only as the reference.
type OtaChannel = 'airbnb' | 'booking_com' | 'agoda';
const OTA: OtaChannel[] = ['airbnb', 'booking_com', 'agoda'];

// Commission each platform takes off the guest price. Informational: it is what
// turns the EXTERNAL sell price into the INTERNAL amount we actually keep.
const COMMISSION: Record<OtaChannel, number> = { airbnb: 15, booking_com: 15, agoda: 18 };

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
  rates: ChannelRate[];
}
interface Payload { units: Unit[]; weekendMultiplier: number; generatedAt: string }

const mk = (
  unitId: string, unitNumber: string, propertyName: string,
  costFloor: number, base: number,
  uplift: [number, number, number], sync: [SyncState, SyncState, SyncState],
): Unit => ({
  unitId, unitNumber, propertyName, costFloor, baseRate: base,
  rates: OTA.map((channel, i) => ({ channel, upliftSen: uplift[i], sync: sync[i] })),
});

const FALLBACK: Payload = {
  weekendMultiplier: 1.22, generatedAt: '',
  units: [
    mk('u1', '#A-12-03', 'Vista Jaya One', 11800, 28400, [3400, 5100, 4500], ['synced', 'synced', 'failed']),
    mk('u2', '#B-08-11', 'Arcoris Mont Kiara', 9900, 23100, [2800, 4200, 3700], ['synced', 'synced', 'synced']),
    mk('u3', '#2207', 'Tribeca', 13200, 31800, [3800, 5700, 5100], ['synced', 'queued', 'synced']),
    mk('u4', '#15-06', 'Scarletz', 10600, 26500, [3200, 4800, 4200], ['synced', 'synced', 'synced']),
  ],
};

const TODAY = '2026-09-20';
const DEFAULT_TO = '2026-10-03';

// Grid track template shared by the uplift table header and its rows.
const COLS = 'grid-cols-[minmax(140px,1.5fr)_minmax(120px,1fr)_minmax(112px,1fr)_minmax(104px,0.9fr)_minmax(120px,1fr)_minmax(118px,1fr)]';

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

const toSen = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** Click-to-edit money value. Commits on Enter or blur, discards on Escape.
 *  Money is integer sen; the input only ever handles RM at the very edge. */
function EditableMoney({ sen, onCommit, ariaLabel, tone }: {
  sen: number; onCommit: (sen: number) => void; ariaLabel: string; tone?: 'floor' | 'warn';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function begin() { setDraft((sen / 100).toFixed(2)); setEditing(true); }
  function commit() {
    const next = toSen(draft);
    if (next !== null && next !== sen) onCommit(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus inputMode="decimal" value={draft} aria-label={ariaLabel}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className={cx(INPUT_CLASS, 'w-full max-w-[120px] ml-auto text-right border-line-strong')}
      />
    );
  }
  return (
    <button
      onClick={begin} aria-label={`Edit ${ariaLabel}`}
      className={cx(
        'inline-flex items-center gap-1.5 ml-auto py-[3px] px-1.5 rounded-[6px] border border-solid border-transparent bg-transparent cursor-pointer [font-family:inherit] text-[13px] font-medium [font-variant-numeric:tabular-nums]',
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
      'inline-flex items-center h-[18px] px-[7px] py-0 rounded-pill text-[11px] font-semibold tracking-[0.03em] border border-solid',
      external ? 'bg-gold-tint text-gold-ink border-[#EADCBD]' : 'bg-muted text-muted-ink border-line',
    )}>{label}</span>
  );
}

export default function PricingPage() {
  const { data, loading, error, reload } = useApi<Payload>('/pricing/rules', FALLBACK);
  const toast = useToast();

  const units = data?.units ?? [];
  const weekendMultiplier = data?.weekendMultiplier ?? 1.22;
  const weekendPct = Math.round((weekendMultiplier - 1) * 100);

  // Optimistic overlays — there is no backend in dev.
  const [unitEdits, setUnitEdits] = useState<Record<string, { baseRate?: number; costFloor?: number }>>({});
  const [upliftEdits, setUpliftEdits] = useState<Record<string, number>>({}); // key `${unitId}:${channel}`

  const [selectedId, setSelectedId] = useState<string | null>(readUnitId());
  const [pushSel, setPushSel] = useState<Record<string, boolean>>(
    { direct: true, airbnb: true, booking_com: true, agoda: true },
  );
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(DEFAULT_TO);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  // Effective units after overlays.
  const rows = useMemo(() => units.map(u => {
    const ue = unitEdits[u.unitId];
    return {
      ...u,
      baseRate: ue?.baseRate ?? u.baseRate,
      costFloor: ue?.costFloor ?? u.costFloor,
      // An uplift nobody set by hand is a share of the base rate, so an edited base rate moves it too: the
      // server prices the other nights that way, and a push must send the same figure.
      rates: u.rates.map(r => ({ ...r, upliftSen: upliftEdits[`${u.unitId}:${r.channel}`]
        ?? (r.upliftShare != null && ue?.baseRate !== undefined ? Math.round(ue.baseRate * r.upliftShare) : r.upliftSen) })),
    };
  }), [units, unitEdits, upliftEdits]);

  const selected = rows.find(u => u.unitId === selectedId) ?? rows[0] ?? null;

  function setBase(unitId: string, baseRate: number) {
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], baseRate } }));
    toast({ tone: 'success', title: 'Base web rate updated.', body: 'Push to send the new rate to each connected channel.' });
    void api.put('/rates', { unitId, baseRate }).catch(notifyFailure);
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

  return (
    <>
      <PageHeader
        title="Pricing"
        sub={`Base web rate per unit, then the uplift each channel carries. Weekend adds ${weekendPct}%.`}
      />

      {error && <StaleBanner message={`Showing the last rates we have. ${error}`} onRetry={reload} />}

      {loading && units.length === 0 ? (
        <Card><TableSkeleton rows={5} cols={4} /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="py-10 px-[22px] text-center flex flex-col gap-3 items-center">
            <span className="text-[14px] text-muted-ink">No units to price yet. Add a unit to set its rates.</span>
          </div>
        </Card>
      ) : (
        <div className="flex gap-4 items-start flex-wrap">
          {/* Unit selector */}
          <Card style={{ flex: '1 1 240px', minWidth: 240 }}>
            <div className="py-[13px] px-4 [border-bottom:1px_solid_var(--color-line)] text-[11px] font-semibold tracking-[0.05em] text-muted-ink">
              UNITS · {rows.length}
            </div>
            {rows.map(u => {
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
                  <span className="text-[13.5px] font-semibold">{u.propertyName}</span>
                  <span className="text-[12px] text-muted-ink">{u.unitNumber} · {rm(u.baseRate, { cents: false })}</span>
                  <span className={cx('text-[11px]', failed ? TONE.critical.text : 'text-faint')}>{syncNote}</span>
                </button>
              );
            })}
          </Card>

          {/* Selected unit detail */}
          {selected && (
            <Card style={{ flex: '3 1 460px', minWidth: 300 }}>
              <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line)] flex items-baseline justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[15px] font-semibold">{selected.propertyName} {selected.unitNumber}</span>
                  <span className="text-[12px] text-muted-ink">Tap any rate to edit. Changes stay local until you push.</span>
                </div>
              </div>

              {/* Base web rate (external) vs cost floor (internal) */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-px bg-line [border-bottom:1px_solid_var(--color-line)]">
                <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-ink">Base web rate</span>
                    <Tag label="SELL" kind="external" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-faint">Direct · per night</span>
                    <EditableMoney sen={selected.baseRate} ariaLabel="base web rate" onCommit={s => setBase(selected.unitId, s)} />
                  </div>
                </div>
                <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-ink">Cost floor</span>
                    <Tag label="INTERNAL" kind="internal" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-faint">Never sent to a channel</span>
                    <EditableMoney sen={selected.costFloor} ariaLabel="cost floor" tone="floor" onCommit={s => setFloor(selected.unitId, s)} />
                  </div>
                </div>
              </div>

              {/* Uplift table */}
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className={cx(COLS, 'grid gap-3 py-[9px] px-5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-[11px] font-semibold tracking-[0.05em] text-muted-ink')}>
                    <div>CHANNEL</div>
                    <div className="text-right">UPLIFT</div>
                    <div className="text-right">GUEST PAYS</div>
                    <div className="text-right">WEEKEND</div>
                    <div className="text-right">YOU KEEP</div>
                    <div>SYNC</div>
                  </div>

                  {selected.rates.map(r => {
                    const guestPays = selected.baseRate + r.upliftSen;
                    const weekend = Math.round(guestPays * weekendMultiplier);
                    const commission = COMMISSION[r.channel];
                    const youKeep = Math.round(guestPays * (1 - commission / 100));
                    const belowFloor = youKeep < selected.costFloor;
                    const s = r.sync === 'not_connected' ? { label: 'Not connected', tone: 'neutral' as const } : SYNC[r.sync];
                    return (
                      <div key={r.channel} className={cx(COLS, 'grid gap-3 items-center min-h-[52px] py-2 px-5 [border-bottom:1px_solid_var(--color-line-soft)]')}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ChannelMark ch={r.channel} size={20} />
                          <div className="flex flex-col min-w-0">
                            <span className="text-[13px]">{CH[r.channel].label}</span>
                            <span className="text-[11px] text-faint">{commission}% fee</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <EditableMoney sen={r.upliftSen} ariaLabel={`${CH[r.channel].label} uplift`} onCommit={s2 => setUplift(selected.unitId, r.channel, s2)} />
                        </div>
                        <span className="text-[13px] font-semibold text-right [font-variant-numeric:tabular-nums]">{rm(guestPays, { cents: false })}</span>
                        <span className="text-[13px] text-right text-muted-ink [font-variant-numeric:tabular-nums]">{rm(weekend, { cents: false })}</span>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={cx('text-[13px] text-right [font-variant-numeric:tabular-nums]', belowFloor ? TONE.critical.text : 'text-ink')}>{rm(youKeep, { cents: false })}</span>
                          {belowFloor && <span className={cx('text-[11px]', TONE.critical.text)}>Below floor</span>}
                        </div>
                        <div><Badge tone={s.tone} label={s.label} size="sm" /></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="py-[10px] px-5 [border-bottom:1px_solid_var(--color-line)] flex gap-4 flex-wrap text-[11px] text-muted-ink">
                <span className="inline-flex items-center gap-1.5"><Tag label="SELL" kind="external" /> what the guest pays on the channel</span>
                <span className="inline-flex items-center gap-1.5"><Tag label="INTERNAL" kind="internal" /> what you keep after the platform fee</span>
              </div>

              {/* Push rates */}
              <div className="py-4 px-5 flex flex-col gap-[14px] bg-page">
                <span className="text-[12px] font-semibold">Push rates</span>
                <div className="flex gap-2 flex-wrap">
                  {PUSHABLE.map(c => {
                    const on = !!pushSel[c];
                    return (
                      <button
                        key={c} onClick={() => setPushSel(p => ({ ...p, [c]: !p[c] }))}
                        aria-pressed={on}
                        className={cx(
                          'inline-flex items-center gap-[7px] h-[34px] pl-[10px] pr-3 py-0 rounded-pill cursor-pointer [font-family:inherit] text-[12.5px] border border-solid',
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
                  <label className="flex flex-col gap-[5px] text-[12px] text-muted-ink">
                    From
                    <input type="date" value={from} min={TODAY} onChange={e => setFrom(e.target.value)}
                      className={cx(INPUT_CLASS, 'w-[160px] text-left border-line')} />
                  </label>
                  <label className="flex flex-col gap-[5px] text-[12px] text-muted-ink">
                    To
                    <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                      className={cx(INPUT_CLASS, 'w-[160px] text-left border-line')} />
                  </label>
                  <div className="ml-auto">
                    <Button
                      variant="primary" icon={<Icon name="Send" size="sm" />}
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
