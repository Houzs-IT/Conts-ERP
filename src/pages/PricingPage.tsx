import { useMemo, useState, type CSSProperties } from 'react';
import { color, radius, text } from '../theme';
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
import { api } from '../lib/api';
import { rm, dateRange } from '../lib/format';
import { SYNC } from '../lib/vocabulary';
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
  sync: SyncState;
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

const COLS = 'minmax(140px,1.5fr) minmax(120px,1fr) minmax(112px,1fr) minmax(104px,0.9fr) minmax(120px,1fr) minmax(118px,1fr)';

const inputStyle: CSSProperties = {
  boxSizing: 'border-box', width: '100%', height: 34, padding: '0 10px',
  fontSize: 13, color: color.ink, background: '#FFFFFF', textAlign: 'right',
  border: `1px solid ${color.borderStrong}`, borderRadius: radius.control, outline: 'none',
  font: 'inherit', fontVariantNumeric: 'tabular-nums',
};

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
        style={{ ...inputStyle, maxWidth: 120, marginLeft: 'auto' }}
      />
    );
  }
  const fg = tone === 'warn' ? '#8A5A12' : tone === 'floor' ? color.textMuted : color.ink;
  return (
    <button
      onClick={begin} aria-label={`Edit ${ariaLabel}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
        padding: '3px 6px', borderRadius: radius.sm, border: '1px solid transparent',
        background: 'transparent', cursor: 'pointer', font: 'inherit',
        fontSize: 13, fontWeight: 500, color: fg, fontVariantNumeric: 'tabular-nums',
      }}
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
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px',
      borderRadius: radius.pill, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.03em',
      background: external ? color.goldTint : color.muted,
      color: external ? color.goldInk : color.textMuted,
      border: `1px solid ${external ? color.gold200 : color.border}`,
    }}>{label}</span>
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
      rates: u.rates.map(r => ({ ...r, upliftSen: upliftEdits[`${u.unitId}:${r.channel}`] ?? r.upliftSen })),
    };
  }), [units, unitEdits, upliftEdits]);

  const selected = rows.find(u => u.unitId === selectedId) ?? rows[0] ?? null;

  function setBase(unitId: string, baseRate: number) {
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], baseRate } }));
    toast({ tone: 'success', title: 'Base web rate updated.', body: 'Push to send the new rate to each connected channel.' });
    void api.put('/rates', { unitId, baseRate }).catch(() => { /* dev: no backend */ });
  }
  function setFloor(unitId: string, costFloor: number) {
    setUnitEdits(e => ({ ...e, [unitId]: { ...e[unitId], costFloor } }));
    toast({ tone: 'neutral', title: 'Cost floor updated.', body: 'Internal only. The floor is never sent to a channel.' });
  }
  function setUplift(unitId: string, ch: OtaChannel, upliftSen: number) {
    setUpliftEdits(e => ({ ...e, [`${unitId}:${ch}`]: upliftSen }));
    toast({ tone: 'success', title: `${CH[ch].label} uplift updated.`, body: 'Push to apply it over your chosen dates.' });
    void api.put('/rates', { unitId, channel: ch, uplift: upliftSen }).catch(() => { /* dev: no backend */ });
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
        } catch { /* dev: no backend, keep optimistic */ }
        setBusy(false); setDialog(null);
        toast({ tone: 'success', title: 'Rates pushed.', body: `${names} updated for ${range}.` });
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
          <div style={{ padding: '40px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: color.textMuted }}>No units to price yet. Add a unit to set its rates.</span>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Unit selector */}
          <Card style={{ flex: '1 1 240px', minWidth: 240 }}>
            <div style={{ padding: '13px 16px', borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.05em', color: color.textMuted }}>
              UNITS · {rows.length}
            </div>
            {rows.map(u => {
              const on = selected?.unitId === u.unitId;
              const failed = u.rates.filter(r => r.sync === 'failed').length;
              const queued = u.rates.filter(r => r.sync === 'queued').length;
              const syncNote = failed ? `${failed} to fix` : queued ? `${queued} queued` : 'All synced';
              return (
                <button
                  key={u.unitId} onClick={() => setSelectedId(u.unitId)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 3, width: '100%', textAlign: 'left',
                    padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer', font: 'inherit',
                    borderLeft: `3px solid ${on ? color.gold : 'transparent'}`,
                    background: on ? color.goldTint : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.propertyName}</span>
                  <span style={{ fontSize: text.small, color: color.textMuted }}>{u.unitNumber} · {rm(u.baseRate, { cents: false })}</span>
                  <span style={{ fontSize: text.micro, color: failed ? '#A8352F' : color.faint }}>{syncNote}</span>
                </button>
              );
            })}
          </Card>

          {/* Selected unit detail */}
          {selected && (
            <Card style={{ flex: '3 1 460px', minWidth: 300 }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{selected.propertyName} {selected.unitNumber}</span>
                  <span style={{ fontSize: text.small, color: color.textMuted }}>Tap any rate to edit. Changes stay local until you push.</span>
                </div>
              </div>

              {/* Base web rate (external) vs cost floor (internal) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1, background: color.border, borderBottom: `1px solid ${color.border}` }}>
                <div style={{ background: '#FFFFFF', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: text.small, color: color.textMuted }}>Base web rate</span>
                    <Tag label="SELL" kind="external" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: text.micro, color: color.faint }}>Direct · per night</span>
                    <EditableMoney sen={selected.baseRate} ariaLabel="base web rate" onCommit={s => setBase(selected.unitId, s)} />
                  </div>
                </div>
                <div style={{ background: '#FFFFFF', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: text.small, color: color.textMuted }}>Cost floor</span>
                    <Tag label="INTERNAL" kind="internal" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: text.micro, color: color.faint }}>Never sent to a channel</span>
                    <EditableMoney sen={selected.costFloor} ariaLabel="cost floor" tone="floor" onCommit={s => setFloor(selected.unitId, s)} />
                  </div>
                </div>
              </div>

              {/* Uplift table */}
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 640 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '9px 20px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.micro, fontWeight: 600, letterSpacing: '0.05em', color: color.textMuted }}>
                    <div>CHANNEL</div>
                    <div style={{ textAlign: 'right' }}>UPLIFT</div>
                    <div style={{ textAlign: 'right' }}>GUEST PAYS</div>
                    <div style={{ textAlign: 'right' }}>WEEKEND</div>
                    <div style={{ textAlign: 'right' }}>YOU KEEP</div>
                    <div>SYNC</div>
                  </div>

                  {selected.rates.map(r => {
                    const guestPays = selected.baseRate + r.upliftSen;
                    const weekend = Math.round(guestPays * weekendMultiplier);
                    const commission = COMMISSION[r.channel];
                    const youKeep = Math.round(guestPays * (1 - commission / 100));
                    const belowFloor = youKeep < selected.costFloor;
                    const s = SYNC[r.sync];
                    return (
                      <div key={r.channel} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', minHeight: 52, padding: '8px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <ChannelMark ch={r.channel} size={20} />
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 13 }}>{CH[r.channel].label}</span>
                            <span style={{ fontSize: text.micro, color: color.faint }}>{commission}% fee</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <EditableMoney sen={r.upliftSen} ariaLabel={`${CH[r.channel].label} uplift`} onCommit={s2 => setUplift(selected.unitId, r.channel, s2)} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rm(guestPays, { cents: false })}</span>
                        <span style={{ fontSize: 13, textAlign: 'right', color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>{rm(weekend, { cents: false })}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <span style={{ fontSize: 13, textAlign: 'right', color: belowFloor ? '#A8352F' : color.ink, fontVariantNumeric: 'tabular-nums' }}>{rm(youKeep, { cents: false })}</span>
                          {belowFloor && <span style={{ fontSize: text.micro, color: '#A8352F' }}>Below floor</span>}
                        </div>
                        <div><Badge tone={s.tone} label={s.label} size="sm" /></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ padding: '10px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: text.micro, color: color.textMuted }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tag label="SELL" kind="external" /> what the guest pays on the channel</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tag label="INTERNAL" kind="internal" /> what you keep after the platform fee</span>
              </div>

              {/* Push rates */}
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, background: color.page }}>
                <span style={{ fontSize: text.small, fontWeight: 600 }}>Push rates</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PUSHABLE.map(c => {
                    const on = !!pushSel[c];
                    return (
                      <button
                        key={c} onClick={() => setPushSel(p => ({ ...p, [c]: !p[c] }))}
                        aria-pressed={on}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px 0 10px',
                          borderRadius: radius.pill, cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 500,
                          border: `1px solid ${on ? color.gold : color.border}`,
                          background: on ? color.goldTint : '#FFFFFF', color: on ? color.ink : color.textMuted,
                        }}
                      >
                        <ChannelMark ch={c} size={18} muted={!on} />
                        {CH[c].label}
                        {on && <Icon name="Check" size="sm" color={color.goldInk} />}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: text.small, color: color.textMuted }}>
                    From
                    <input type="date" value={from} min={TODAY} onChange={e => setFrom(e.target.value)}
                      style={{ ...inputStyle, textAlign: 'left', width: 160, borderColor: color.border }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: text.small, color: color.textMuted }}>
                    To
                    <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
                      style={{ ...inputStyle, textAlign: 'left', width: 160, borderColor: color.border }} />
                  </label>
                  <div style={{ marginLeft: 'auto' }}>
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
