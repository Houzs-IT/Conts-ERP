import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { color, radius, text, channel as CH } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Dialog, Drawer, type DialogSpec } from '../components/Dialog';
import { Field } from '../components/Field';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm } from '../lib/format';
import type { BookingChannel, ReservationState } from '../lib/types';

const DAYS = 14;
const COL = 62;
const UNIT_COL = 240;
const ALL: BookingChannel[] = ['airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'];
const STATUSES: { key: ReservationState; label: string }[] = [
  { key: 'confirmed', label: 'Confirmed' }, { key: 'checked_in', label: 'Checked in' },
  { key: 'checked_out', label: 'Checked out' }, { key: 'pending', label: 'Pending' },
];
// The rate rows revealed by "Expand rates": the web rate plus each connected channel.
const RATE_ROWS: { key: 'web' | BookingChannel; label: string; sync: string; tone: string }[] = [
  { key: 'web', label: 'Web rate', sync: 'No commission', tone: color.textMuted },
  { key: 'airbnb', label: 'Airbnb rate', sync: 'Synced', tone: '#11694A' },
  { key: 'booking_com', label: 'Booking.com rate', sync: 'Synced', tone: '#11694A' },
  { key: 'agoda', label: 'Agoda rate', sync: 'Expired', tone: '#A8352F' },
];
const UPLIFT: Record<string, number> = { web: 1, airbnb: 1.12, booking_com: 1.18, agoda: 1.16 };

interface Unit { id: string; unitNumber: string; propertyName: string }
interface Block {
  id: string; unitId: string; channel: BookingChannel; state: ReservationState;
  guestName: string; checkIn: string; checkOut: string; grossBookingValue: number; ref: string | null; reason: string | null;
}
interface Payload { from: string; to: string; units: Unit[]; blocks: Block[]; baseRate: Record<string, number>; generatedAt: string }

const today = new Date('2026-09-16');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

const FALLBACK: Payload = {
  from: '2026-09-16', to: '2026-09-29', generatedAt: '',
  baseRate: { u1: 28800, u2: 23100, u3: 31800, u4: 26500, u5: 24200, u6: 22800 },
  units: [
    { id: 'u1', unitNumber: '#C-13-13A', propertyName: 'Agile Bukit Bintang, Imbi' },
    { id: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara' },
    { id: 'u3', unitNumber: '#MK2-09-16', propertyName: 'Arte Mont Kiara' },
    { id: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz' },
    { id: 'u5', unitNumber: '#A-21-02', propertyName: 'The Establishment' },
    { id: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites' },
  ],
  blocks: [
    { id: 'b1', unitId: 'u1', channel: 'airbnb', state: 'checked_in', guestName: 'Nadia Abdullah', checkIn: '2026-09-16', checkOut: '2026-09-17', grossBookingValue: 85200, ref: 'ABNB-7741QK', reason: null },
    { id: 'b2', unitId: 'u1', channel: 'direct', state: 'confirmed', guestName: 'Aaron Lee', checkIn: '2026-09-17', checkOut: '2026-09-19', grossBookingValue: 113600, ref: 'DIR-2026-0916', reason: null },
    { id: 'b3', unitId: 'u1', channel: 'booking_com', state: 'confirmed', guestName: 'Priya Sundaram', checkIn: '2026-09-24', checkOut: '2026-09-28', grossBookingValue: 198800, ref: 'BDC-5512088', reason: null },
    { id: 'b4', unitId: 'u3', channel: 'agoda', state: 'confirmed', guestName: 'Marcus Wong', checkIn: '2026-09-16', checkOut: '2026-09-19', grossBookingValue: 159000, ref: 'AGD-33110', reason: null },
    { id: 'b5', unitId: 'u3', channel: 'booking_com', state: 'confirmed', guestName: 'Siti Rahmah', checkIn: '2026-09-24', checkOut: '2026-09-27', grossBookingValue: 127200, ref: 'BDC-5512411', reason: null },
    { id: 'b6', unitId: 'u2', channel: 'booking_com', state: 'confirmed', guestName: 'Chen Yu', checkIn: '2026-09-18', checkOut: '2026-09-23', grossBookingValue: 161700, ref: 'BDC-5512087', reason: null },
    { id: 'b7', unitId: 'u4', channel: 'owner_stay', state: 'confirmed', guestName: 'Chong Wei Han', checkIn: '2026-09-23', checkOut: '2026-09-25', grossBookingValue: 0, ref: 'OWN-0032', reason: 'Owner staying, agreed 12 Sep' },
    { id: 'b8', unitId: 'u6', channel: 'maintenance_block', state: 'confirmed', guestName: 'AquaFix Sdn Bhd', checkIn: '2026-09-16', checkOut: '2026-09-22', grossBookingValue: 0, ref: 'MNT-0914', reason: 'Plumbing works' },
  ],
};

export default function CalendarPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const start = addDays(today, weekOffset * 7);
  const from = iso(start), to = iso(addDays(start, DAYS - 1));
  const { data, error, reload } = useApi<Payload>(`/reservations/calendar?from=${from}&to=${to}`, FALLBACK);
  const toast = useToast();

  const [off, setOff] = useState<Partial<Record<BookingChannel, boolean>>>({});
  const [statusOff, setStatusOff] = useState<Partial<Record<ReservationState, boolean>>>({});
  const [property, setProperty] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const [rateEdits, setRateEdits] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [priceModal, setPriceModal] = useState<null | { unit: Unit; channel: string; dayIso: string; current: number }>(null);
  const [blockWizard, setBlockWizard] = useState(false);
  const [rateUpdate, setRateUpdate] = useState(false);
  const [openBlock, setOpenBlock] = useState<Block | null>(null);

  const allUnits = data?.units ?? [];
  const properties = useMemo(() => Array.from(new Set(allUnits.map(u => u.propertyName))), [allUnits]);
  const units = property === 'all' ? allUnits : allUnits.filter(u => u.propertyName === property);
  const blocks = (data?.blocks ?? []).filter(b => !off[b.channel] && !statusOff[b.state]);
  const gridStart = new Date(data?.from ?? from);
  const dayIndex = (d: string) => Math.round((new Date(d).getTime() - gridStart.getTime()) / 864e5);
  const dayIso = (i: number) => iso(addDays(gridStart, i));

  function rateFor(unitId: string, channel: string, i: number) {
    const key = `${unitId}:${channel}:${i}`;
    if (rateEdits[key] != null) return rateEdits[key];
    const base = data?.baseRate[unitId] ?? 28800;
    const weekend = [5, 6].includes(addDays(gridStart, i).getDay());
    return Math.round(base * UPLIFT[channel] * (weekend ? 1.22 : 1));
  }
  function setPrice(unitId: string, channel: string, i: number, rmValue: number) {
    setRateEdits(e => ({ ...e, [`${unitId}:${channel}:${i}`]: Math.round(rmValue * 100) }));
    toast({ tone: 'success', title: 'Rate set.', body: 'Pushed to the connected channel for that night.' });
    api.put('/rates', { unitId, channel, date: dayIso(i) }).catch(() => {});
  }

  function emptyNight(unit: Unit, i: number) {
    setDialog({
      title: `${unit.unitNumber} · ${dayIso(i)}`,
      body: 'This night is open. Block it, create a reservation, or set a price.',
      confirmLabel: 'Set price',
      extraActions: [
        { label: 'Block dates', onClick: () => { setDialog(null); setBlockWizard(true); } },
        { label: 'Create reservation', onClick: () => { setDialog(null); toast({ tone: 'info', title: 'Create reservation', body: 'Opens the manual booking form.' }); } },
      ],
      onConfirm: () => { setDialog(null); setPriceModal({ unit, channel: 'web', dayIso: dayIso(i), current: rateFor(unit.id, 'web', i) }); },
    });
  }

  return (
    <>
      <PageHeader title="Calendar" sub={`${units.length} units · ${new Date(from).getDate()}–${new Date(to).getDate()} ${new Date(to).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}`}
        right={<Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Add booking', body: 'Manual booking, same validation as a channel sync.' })}>Add booking</Button>} />

      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}

      <Card>
        {/* Filters */}
        <div style={{ padding: '13px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <FilterLabel label="Host"><span style={{ fontSize: 13, fontWeight: 500 }}>The Conts Sdn Bhd</span></FilterLabel>
            <FilterLabel label="Property">
              <select value={property} onChange={e => setProperty(e.target.value)} style={selectStyle}>
                <option value="all">All properties</option>
                {properties.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FilterLabel>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {ALL.map(k => {
              const on = !off[k]; const c = CH[k];
              return (
                <button key={k} onClick={() => setOff(o => ({ ...o, [k]: on }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px 0 6px', borderRadius: radius.pill, cursor: 'pointer', font: 'inherit', border: `1px solid ${on ? c.fill + '40' : 'transparent'}`, background: on ? c.tint : color.page }}>
                  <ChannelMark ch={k} size={20} muted={!on} />
                  <span style={{ fontSize: 12, fontWeight: on ? 500 : 400, color: on ? color.ink : color.textMuted }}>{c.label}</span>
                </button>
              );
            })}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
              <button onClick={() => setOff({})} style={linkBtn}>Select all</button>
              <button onClick={() => setOff(Object.fromEntries(ALL.map(k => [k, true])))} style={linkBtn}>Deselect all</button>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map(s => {
              const on = !statusOff[s.key];
              return (
                <button key={s.key} onClick={() => setStatusOff(o => ({ ...o, [s.key]: on }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: radius.pill, cursor: 'pointer', font: 'inherit', fontSize: 12, border: `1px solid ${color.border}`, background: on ? color.muted : color.page, color: on ? color.ink : color.textMuted }}>
                  {on && <Icon name="Check" size="sm" />} {s.label}
                </button>
              );
            })}
            <button onClick={() => { setOff({}); setStatusOff({}); setProperty('all'); }} style={{ ...linkBtn, marginLeft: 'auto' }}>Reset</button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ padding: '11px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <Button size="sm" variant={expanded ? 'primary' : 'secondary'} icon={<Icon name="ChevronsRight" size="sm" />} onClick={() => setExpanded(v => !v)}>Expand rates</Button>
          <Button size="sm" variant="secondary" onClick={() => setRateUpdate(true)}>Rate update</Button>
          <Button size="sm" variant="brand" onClick={() => setBlockWizard(true)}>Block wizard</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="RefreshCw" size="sm" />} onClick={() => toast({ tone: 'success', title: 'Sync started.', body: 'Airbnb, Booking.com and Agoda · Agoda skipped (expired).' })}>Refresh</Button>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn} aria-label="Previous"><Icon name="ChevronsLeft" size="sm" /></button>
            <span style={{ fontSize: 12.5, fontWeight: 500, minWidth: 150, textAlign: 'center' }}>{new Date(from).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} – {new Date(to).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn} aria-label="Next"><Icon name="ChevronsRight" size="sm" /></button>
            <Button size="sm" variant="secondary" onClick={() => setWeekOffset(0)}>Today</Button>
          </span>
        </div>

        {/* Grid */}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: UNIT_COL + DAYS * COL }}>
            <div style={{ display: 'flex', background: color.muted, borderBottom: `1px solid ${color.border}` }}>
              <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: color.muted, padding: '10px 16px', borderRight: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Unit</div>
              {Array.from({ length: DAYS }, (_, i) => {
                const d = addDays(gridStart, i); const wk = [5, 6].includes(d.getDay());
                return (
                  <div key={i} style={{ flex: 1, boxSizing: 'border-box', minWidth: 58, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, borderLeft: `1px solid ${color.border}`, background: i === 0 ? color.goldTint : wk ? color.page : 'transparent' }}>
                    <span style={{ fontSize: text.micro, color: color.textMuted }}>{d.toLocaleDateString('en-MY', { weekday: 'short' })}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.getDate()}</span>
                  </div>
                );
              })}
            </div>

            {units.map(u => {
              const cells: ({ b: Block; first: boolean; last: boolean } | null)[] = Array(DAYS).fill(null);
              blocks.filter(b => b.unitId === u.id).forEach(b => {
                const s = Math.max(0, dayIndex(b.checkIn)); const e = Math.min(DAYS, dayIndex(b.checkOut));
                for (let i = s; i < e; i++) cells[i] = { b, first: i === s, last: i === e - 1 };
              });
              return (
                <div key={u.id}>
                  <div style={{ display: 'flex', minHeight: 60, borderBottom: `1px solid ${color.border}` }}>
                    <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: '#FFFFFF', padding: '10px 16px', borderRight: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 6, background: color.muted, display: 'grid', placeItems: 'center', color: color.textMuted }}><Icon name="Image" size="sm" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{u.unitNumber}</div>
                        <div style={{ fontSize: 11, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</div>
                      </div>
                    </div>
                    {cells.map((c, i) => {
                      const base: CSSProperties = { position: 'relative', boxSizing: 'border-box', flex: 1, minWidth: 58, borderLeft: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', padding: '7px 5px' };
                      if (!c) return <div key={i} onClick={() => emptyNight(u, i)} style={{ ...base, cursor: 'pointer' }} title={`${u.unitNumber} · available`} />;
                      const ch = CH[c.b.channel]; const dashed = ch.border !== 'solid';
                      const nights = dayIndex(c.b.checkOut) - dayIndex(c.b.checkIn);
                      return (
                        <div key={i} onClick={() => setOpenBlock(c.b)} title={`${c.b.guestName} · ${ch.label}${c.b.ref ? ' · ' + c.b.ref : ''}`}
                          style={{ ...base, margin: '11px 0', cursor: 'pointer', background: ch.tint, borderTop: `1px ${dashed ? ch.border : 'solid'} ${dashed ? ch.fill : 'rgba(21,21,21,0.06)'}`, borderBottom: `1px ${dashed ? ch.border : 'solid'} ${dashed ? ch.fill : 'rgba(21,21,21,0.06)'}`, boxShadow: c.first ? `inset 3px 0 0 ${ch.fill}` : undefined, borderRadius: c.first && c.last ? 6 : c.first ? '6px 0 0 6px' : c.last ? '0 6px 6px 0' : undefined, borderRight: c.last ? `1px ${dashed ? ch.border : 'solid'} ${dashed ? ch.fill : 'rgba(21,21,21,0.06)'}` : undefined }}>
                          {c.first && <>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 3, pointerEvents: 'none' }}><ChannelMark ch={c.b.channel} size={18} /></span>
                            <span style={{ position: 'absolute', left: 32, maxWidth: nights * COL - 40, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', zIndex: 2, color: ch.ink }}>{c.b.guestName}{c.b.grossBookingValue > 0 ? ` · ${rm(c.b.grossBookingValue, { cents: false })}` : ''}</span>
                          </>}
                        </div>
                      );
                    })}
                  </div>

                  {expanded && (
                    <>
                      <div style={{ display: 'flex', borderBottom: `1px solid ${color.borderMuted}`, background: color.page }}>
                        <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: color.page, padding: '6px 16px', borderRight: `1px solid ${color.border}`, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted }}>INVENTORY</div>
                        {Array.from({ length: DAYS }, (_, i) => {
                          const booked = cells[i] != null;
                          return <div key={i} style={{ flex: 1, minWidth: 58, boxSizing: 'border-box', borderLeft: `1px solid ${color.borderMuted}`, display: 'grid', placeItems: 'center', fontSize: 11, color: booked ? color.textMuted : color.ink }}>{booked ? '0 | 1' : '1 | 1'}</div>;
                        })}
                      </div>
                      {RATE_ROWS.map(r => (
                        <div key={r.key} style={{ display: 'flex', borderBottom: `1px solid ${color.borderMuted}` }}>
                          <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 2, background: '#FFFFFF', padding: '7px 16px', borderRight: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {r.key === 'web' ? <span style={{ width: 18, height: 18, borderRadius: 4, background: color.black, color: color.gold, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700 }}>TC</span> : <ChannelMark ch={r.key as BookingChannel} size={18} />}
                            <span style={{ fontSize: 12, fontWeight: 500 }}>{r.label}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: radius.pill, background: color.page, color: r.tone, border: `1px solid ${r.tone}22` }}>{r.sync}</span>
                          </div>
                          {Array.from({ length: DAYS }, (_, i) => {
                            const price = rateFor(u.id, r.key, i);
                            const edited = rateEdits[`${u.id}:${r.key}:${i}`] != null;
                            return (
                              <button key={i} onClick={() => setPriceModal({ unit: u, channel: r.key, dayIso: dayIso(i), current: price })}
                                style={{ flex: 1, minWidth: 58, boxSizing: 'border-box', borderLeft: `1px solid ${color.borderMuted}`, background: edited ? color.goldTint : '#FFFFFF', border: 'none', borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: color.borderMuted, cursor: 'pointer', font: 'inherit', fontSize: 11.5, color: color.ink, padding: '7px 2px', fontVariantNumeric: 'tabular-nums' }}
                                title="Set price">
                                {rm(price, { cents: false }).replace('RM', 'RM ')}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Block detail drawer */}
      <Drawer open={!!openBlock} onClose={() => setOpenBlock(null)} width={380}>
        {openBlock && <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ChannelMark ch={openBlock.channel} size={22} /><span style={{ fontSize: 15, fontWeight: 600 }}>{openBlock.guestName}</span></div>
            <button onClick={() => setOpenBlock(null)} aria-label="Close" style={navBtn}><Icon name="X" size="sm" /></button>
          </div>
          <div style={{ fontSize: 12.5, color: color.textMuted, lineHeight: 1.8 }}>
            <div>{CH[openBlock.channel].label} · {openBlock.ref ?? '—'}</div>
            <div>{openBlock.checkIn} → {openBlock.checkOut}</div>
            {openBlock.grossBookingValue > 0 && <div>Gross {rm(openBlock.grossBookingValue)}</div>}
            {openBlock.reason && <div>{openBlock.reason}</div>}
          </div>
          <a href="#/reservations/bookings" onClick={() => setOpenBlock(null)} style={{ textDecoration: 'none' }}>
            <Button variant="primary" style={{ width: '100%' }}>View booking</Button>
          </a>
        </div>}
      </Drawer>

      <Dialog spec={dialog} busy={false} onClose={() => setDialog(null)} />
      {priceModal && <SetPriceModal m={priceModal} onClose={() => setPriceModal(null)}
        onSave={rmValue => { const i = dayIndex(priceModal.dayIso); setPrice(priceModal.unit.id, priceModal.channel, i, rmValue); setPriceModal(null); }} />}
      {blockWizard && <BlockWizard units={units} onClose={() => setBlockWizard(false)}
        onSave={() => { setBlockWizard(false); toast({ tone: 'success', title: 'Dates blocked.', body: 'Held on every channel so the nights cannot be sold.' }); }} />}
      {rateUpdate && <RateUpdate onClose={() => setRateUpdate(false)}
        onSave={() => { setRateUpdate(false); toast({ tone: 'success', title: 'Rates pushed.', body: 'Applied across the selected units, channels and dates.' }); }} />}
    </>
  );
}

const linkBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 500, color: 'var(--color-text-accent)' };
const navBtn: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, cursor: 'pointer', color: color.textMuted };
const selectStyle: CSSProperties = { height: 34, padding: '0 10px', fontFamily: 'var(--font-sans)', fontSize: 13, color: color.ink, background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none' };
function FilterLabel({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted }}>{label.toUpperCase()}</span>{children}</div>;
}

function CentreModal({ title, sub, onClose, onSave, saveLabel, canSave, children }: { title: string; sub?: string; onClose: () => void; onSave: () => void; saveLabel: string; canSave: boolean; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)' }}>
        <form onSubmit={e => { e.preventDefault(); if (canSave) onSave(); }}>
          <div style={{ padding: '22px 22px 4px' }}><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>{sub && <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{sub}</p>}</div>
          <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-default)', background: 'var(--color-surface-page)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSave} disabledReason="Fill the fields first">{saveLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SetPriceModal({ m, onClose, onSave }: { m: { unit: Unit; channel: string; dayIso: string; current: number }; onClose: () => void; onSave: (rm: number) => void }) {
  const [v, setV] = useState(String(Math.round(m.current / 100)));
  const label = m.channel === 'web' ? 'Web rate' : CH[m.channel as BookingChannel].label;
  return (
    <CentreModal title="Set price" sub={`${m.unit.unitNumber} · ${label} · ${m.dayIso}`} onClose={onClose} saveLabel="Set price" canSave={v !== '' && Number(v) >= 0} onSave={() => onSave(Number(v))}>
      <Field label="Price (RM / night)" type="number" min={0} numeric value={v} onChange={e => setV(e.target.value)} help="Pushed to the connected channel for this night. Confirmed bookings keep their original rate." />
    </CentreModal>
  );
}
function BlockWizard({ units, onClose, onSave }: { units: Unit[]; onClose: () => void; onSave: () => void }) {
  const [unit, setUnit] = useState(units[0]?.id ?? '');
  const [fromD, setFromD] = useState(''); const [toD, setToD] = useState(''); const [reason, setReason] = useState('');
  return (
    <CentreModal title="Block wizard" sub="Hold nights so no channel can sell them." onClose={onClose} saveLabel="Block dates" canSave={!!unit && fromD !== '' && toD !== '' && reason.trim() !== ''} onSave={onSave}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <label style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-text-muted)' }}>Unit</label>
        <select value={unit} onChange={e => setUnit(e.target.value)} style={{ ...selectStyle, height: 44 }}>{units.map(u => <option key={u.id} value={u.id}>{u.unitNumber} — {u.propertyName}</option>)}</select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="From" type="date" value={fromD} onChange={e => setFromD(e.target.value)} />
        <Field label="To" type="date" value={toD} onChange={e => setToD(e.target.value)} />
      </div>
      <Field label="Reason" placeholder="e.g. Plumbing works" value={reason} onChange={e => setReason(e.target.value)} help="Required. Shown on the block and pushed to every channel as unavailable." />
    </CentreModal>
  );
}
function RateUpdate({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [fromD, setFromD] = useState(''); const [toD, setToD] = useState(''); const [price, setPrice] = useState('');
  return (
    <CentreModal title="Rate update" sub="Apply a rate across a date range, units and channels in one push." onClose={onClose} saveLabel="Push rates" canSave={fromD !== '' && toD !== '' && price !== ''} onSave={onSave}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="From" type="date" value={fromD} onChange={e => setFromD(e.target.value)} />
        <Field label="To" type="date" value={toD} onChange={e => setToD(e.target.value)} />
      </div>
      <Field label="Price (RM / night)" type="number" min={0} numeric value={price} onChange={e => setPrice(e.target.value)} help="Pushed to every connected channel across the range." />
    </CentreModal>
  );
}
