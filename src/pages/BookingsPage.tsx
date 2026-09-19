import { useMemo, useState } from 'react';
import { color, radius, text, channel as CH } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { Drawer, Dialog, type DialogSpec } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, dateRange } from '../lib/format';
import type { Tone, BookingChannel, ReservationState } from '../lib/types';

const STATE_TONE: Record<ReservationState, Tone> = {
  inquiry: 'neutral', pending: 'warning', confirmed: 'info', checked_in: 'success',
  checked_out: 'neutral', cancelled: 'neutral', no_show: 'critical',
};
const STATE_LABEL: Record<ReservationState, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in',
  checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};
const FEE_PCT: Partial<Record<BookingChannel, number>> = { airbnb: 15, booking_com: 15, agoda: 15 };

interface Row {
  id: string; externalRef: string | null; guestName: string; guestsCount: number;
  guestPhone: string | null; unitNumber: string; propertyName: string; channel: BookingChannel;
  state: ReservationState; checkIn: string; checkOut: string; checkInTime: string; checkOutTime: string;
  nights: number; grossBookingValue: number; paidAt: string | null; receivedAt: string;
}
interface Payload { data: Row[]; total: number; page: number; generatedAt: string }

const FALLBACK: Payload = {
  total: 6, page: 1, generatedAt: '',
  data: [
    { id: 'b1', externalRef: 'ABNB-7741QK', guestName: 'Nadia Abdullah', guestsCount: 2, guestPhone: '+60 12-111 0001', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 85200, paidAt: '2026-09-12 10:04', receivedAt: '2026-09-12 10:02' },
    { id: 'b2', externalRef: 'DIR-2026-0916', guestName: 'Aaron Lee', guestsCount: 2, guestPhone: '+60 12-111 0002', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'direct', state: 'confirmed', checkIn: '2026-09-19', checkOut: '2026-09-23', checkInTime: '15:00', checkOutTime: '11:00', nights: 4, grossBookingValue: 113600, paidAt: '2026-09-14 09:20', receivedAt: '2026-09-14 09:18' },
    { id: 'b3', externalRef: 'BDC-5512088', guestName: 'Priya Sundaram', guestsCount: 2, guestPhone: '+60 12-111 0003', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', channel: 'booking_com', state: 'confirmed', checkIn: '2026-09-24', checkOut: '2026-09-27', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 198800, paidAt: null, receivedAt: '2026-09-15 22:41' },
    { id: 'b4', externalRef: 'AGD-33110', guestName: 'Marcus Wong', guestsCount: 2, guestPhone: '+60 12-111 0004', unitNumber: '#MK2-09-16', propertyName: 'Arte Mont Kiara', channel: 'agoda', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-19', checkInTime: '15:00', checkOutTime: '11:00', nights: 3, grossBookingValue: 159000, paidAt: '2026-09-13 12:00', receivedAt: '2026-09-13 11:58' },
    { id: 'b5', externalRef: 'OWN-0032', guestName: 'Chong Wei Han', guestsCount: 2, guestPhone: null, unitNumber: '#MK2-09-15', propertyName: 'Arte Mont Kiara', channel: 'owner_stay', state: 'confirmed', checkIn: '2026-09-23', checkOut: '2026-09-25', checkInTime: '15:00', checkOutTime: '11:00', nights: 2, grossBookingValue: 0, paidAt: null, receivedAt: '2026-09-12 08:00' },
    { id: 'b6', externalRef: 'MNT-0914', guestName: 'AquaFix Sdn Bhd', guestsCount: 0, guestPhone: null, unitNumber: '#C-31-14', propertyName: 'Sentral Suites', channel: 'maintenance_block', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-22', checkInTime: '09:00', checkOutTime: '18:00', nights: 6, grossBookingValue: 0, paidAt: null, receivedAt: '2026-09-14 16:00' },
  ],
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'arriving', label: 'Arriving today' },
  { key: 'inhouse', label: 'In house' },
  { key: 'pending', label: 'Pending payment' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];
const TODAY = '2026-09-16';

const COLS = 'minmax(140px,1.2fr) minmax(150px,1.4fr) minmax(150px,1.2fr) minmax(96px,0.7fr) minmax(140px,1.1fr) minmax(96px,0.8fr) minmax(96px,0.8fr)';

function feeLines(r: Row) {
  const pct = FEE_PCT[r.channel] ?? 0;
  const channelFee = Math.round(r.grossBookingValue * pct / 100);
  const revenue = r.channel !== 'maintenance_block' && r.channel !== 'owner_stay';
  const cleaning = revenue && r.grossBookingValue > 0 ? 3500 : 0;
  const tourismTax = revenue && r.grossBookingValue > 0 ? 1000 * r.nights : 0;
  const collected = r.grossBookingValue - channelFee - cleaning - tourismTax;
  return { pct, channelFee, cleaning, tourismTax, collected };
}

export default function BookingsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/reservations', FALLBACK);
  const toast = useToast();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (data?.data ?? []).map(r => ({ ...r, ...edits[r.id] })), [data, edits]);
  const shown = rows.filter(r => {
    switch (filter) {
      case 'arriving': return r.checkIn === TODAY && r.channel !== 'maintenance_block';
      case 'inhouse': return r.state === 'checked_in';
      case 'pending': return r.paidAt === null && r.channel !== 'maintenance_block' && r.channel !== 'owner_stay' && r.state !== 'cancelled';
      case 'blocks': return r.channel === 'maintenance_block' || r.channel === 'owner_stay';
      case 'cancelled': return r.state === 'cancelled';
      default: return true;
    }
  });
  const open = rows.find(r => r.id === openId) ?? null;

  function patch(id: string, p: Partial<Row>) { setEdits(e => ({ ...e, [id]: { ...e[id], ...p } })); }

  function cancel(r: Row) {
    setDialog({
      title: `Cancel ${r.externalRef ?? 'this reservation'}?`,
      body: `This releases the dates on every channel, notifies ${r.guestName}, and reverses the payout line on the owner statement.`,
      meta: `${r.propertyName} ${r.unitNumber} · ${dateRange(r.checkIn, r.checkOut)}`,
      confirmLabel: 'Cancel reservation', busyLabel: 'Cancelling…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        patch(r.id, { state: 'cancelled' });
        try { await api.post(`/reservations/${r.id}/cancel`); } catch { /* dev */ }
        setBusy(false); setDialog(null);
        toast({ tone: 'neutral', title: 'Reservation cancelled.', body: `${r.guestName} has been notified and the dates released.` });
      },
    });
  }
  function changeDates(r: Row) {
    setDialog({
      title: 'Change dates',
      body: 'Moving a stay updates the channel, re-checks availability and notifies the guest. Housekeeping is rescheduled automatically.',
      meta: `Current: ${dateRange(r.checkIn, r.checkOut)} · ${r.nights} nights`,
      confirmLabel: 'Continue',
      onConfirm: async () => { setDialog(null); toast({ tone: 'info', title: 'Date change', body: 'Full date editor lands with the calendar drag flow.' }); },
    });
  }
  function message(r: Row) {
    const ch = r.channel === 'direct' ? 'WhatsApp' : CH[r.channel].label;
    toast({ tone: 'success', title: 'Message guest', body: `Opening the ${ch} thread with ${r.guestName}.` });
  }

  return (
    <>
      <PageHeader title="Bookings" sub={`${data?.total ?? rows.length} reservations`}
        right={<div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Import reservations', body: 'CSV import returns per-row accepted / rejected.' })}>Import</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Export', body: 'CSV header prints the applied filters, generated time and scope.' })}>Download CSV</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Create reservation', body: 'Manual entry with the same validation as the calendar.' })}>Create reservation</Button>
        </div>} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 22px', borderBottom: `1px solid ${color.border}` }}>
          {FILTERS.map(f => {
            const on = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ height: 32, padding: '0 13px', borderRadius: radius.pill, cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 500,
                  border: `1px solid ${on ? 'transparent' : color.border}`, background: on ? color.black : color.page, color: on ? '#FFFFFF' : color.textMuted }}>
                {f.label}
              </button>
            );
          })}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 960 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Reference</div><div>Guest</div><div>Unit</div><div>Channel</div><div>Stay</div><div style={{ textAlign: 'right' }}>Gross</div><div>Status</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : shown.length === 0 ? (
              <div style={{ padding: '34px 22px', textAlign: 'center', fontSize: 13.5, color: color.textMuted }}>No reservations match this filter.</div>
            ) : shown.map(b => {
              const ch = CH[b.channel];
              return (
                <div key={b.id} role="button" tabIndex={0} onClick={() => setOpenId(b.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenId(b.id); }}
                  style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 54, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}`, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <ChannelMark ch={b.channel} size={20} />
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.externalRef ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.guestName}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted }}>{b.guestsCount > 0 ? `${b.guestsCount} guests` : 'No guest'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{b.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.propertyName}</span>
                  </div>
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: radius.pill, background: ch.tint, color: ch.ink, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{ch.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5 }}>{dateRange(b.checkIn, b.checkOut)}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</div>
                  <div><Badge tone={STATE_TONE[b.state]} label={STATE_LABEL[b.state]} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Drawer open={!!open} onClose={() => setOpenId(null)} width={440}>
        {open && <ReservationPanel r={open} onClose={() => setOpenId(null)} onMessage={() => message(open)} onChangeDates={() => changeDates(open)} onCancel={() => cancel(open)} />}
      </Drawer>
      <Dialog spec={dialog} busy={busy} onClose={() => { if (!busy) setDialog(null); }} />
    </>
  );
}

function ReservationPanel({ r, onClose, onMessage, onChangeDates, onCancel }: {
  r: Row; onClose: () => void; onMessage: () => void; onChangeDates: () => void; onCancel: () => void;
}) {
  const ch = CH[r.channel];
  const f = feeLines(r);
  const cancelled = r.state === 'cancelled';
  const steps = [
    { label: 'Booking created', meta: `Channel sync · ${r.receivedAt}`, done: true },
    { label: 'Payment received', meta: r.paidAt ? `${rm(r.grossBookingValue, { cents: false })} · ${r.paidAt}` : 'Awaiting payment', done: !!r.paidAt },
    { label: 'Access code sent', meta: r.state === 'checked_in' || r.state === 'checked_out' ? 'WhatsApp' : 'Sends 2h before check-in', done: r.state === 'checked_in' || r.state === 'checked_out' },
    { label: 'Guest checked in', meta: r.state === 'checked_in' || r.state === 'checked_out' ? `Smart lock · ${r.checkIn} ${r.checkInTime}` : `Due ${r.checkIn} ${r.checkInTime}`, done: r.state === 'checked_in' || r.state === 'checked_out' },
  ];
  const money = [
    { label: 'Gross booking value', value: rm(r.grossBookingValue), sign: '' },
    ...(f.channelFee ? [{ label: `Channel fee · ${f.pct}%`, value: rm(f.channelFee), sign: '−' }] : []),
    ...(f.cleaning ? [{ label: 'Cleaning', value: rm(f.cleaning), sign: '−' }] : []),
    ...(f.tourismTax ? [{ label: `Tourism tax · ${r.nights} nights`, value: rm(f.tourismTax), sign: '−' }] : []),
  ];

  return (
    <>
      <div style={{ position: 'relative', height: 132, background: color.black, flex: 'none', display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.25)' }}><Icon name="Image" /></div>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: radius.pill, background: 'rgba(0,0,0,0.4)', border: 'none', color: '#FFF', cursor: 'pointer' }}><Icon name="X" size="sm" /></button>
        <div style={{ position: 'relative', padding: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ChannelMark ch={r.channel} size={22} />
          <span style={{ color: '#FFF', fontSize: 13, fontWeight: 600 }}>{r.unitNumber}</span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{r.propertyName}</span>
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge tone={STATE_TONE[r.state]} label={STATE_LABEL[r.state]} />
          <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: radius.pill, background: ch.tint, color: ch.ink, fontSize: 11.5, fontWeight: 600 }}>{ch.label}</span>
          <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, color: color.textMuted }}>{r.externalRef}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: color.border, border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
          {[
            [`${r.checkIn} · ${r.checkInTime}`, 'Check-in'],
            [`${r.checkOut} · ${r.checkOutTime}`, 'Check-out'],
            [`${r.nights}`, 'Nights'],
            [`${r.guestsCount || '—'}`, 'Guests'],
          ].map(([v, l]) => (
            <div key={l} style={{ background: '#FFF', padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
              <span style={{ fontSize: 11, color: color.textMuted }}>{l}</span>
            </div>
          ))}
        </div>

        {r.grossBookingValue > 0 && (
          <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
            {money.map(m => (
              <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <span style={{ fontSize: 12.5, color: color.textMuted }}>{m.label}</span>
                <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{m.sign} {m.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 14px', background: color.muted }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Collected revenue</span>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rm(f.collected)}</span>
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: text.small, fontWeight: 600, color: color.textMuted, marginBottom: 12 }}>Timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {steps.map((s, i) => (
              <div key={s.label} style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: 11, height: 11, borderRadius: radius.pill, background: s.done ? '#11694A' : '#FFF', border: `2px solid ${s.done ? '#11694A' : color.border}` }} />
                  {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 26, background: color.border }} />}
                </div>
                <div style={{ paddingBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: s.done ? color.ink : color.textMuted }}>{s.label}</div>
                  <div style={{ fontSize: 11.5, color: color.textMuted }}>{s.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: 16, borderTop: `1px solid ${color.border}`, background: color.page, display: 'flex', flexDirection: 'column', gap: 9, flex: 'none' }}>
        <Button variant="primary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message guest</Button>
        {!cancelled && (
          <div style={{ display: 'flex', gap: 9 }}>
            <Button variant="secondary" style={{ flex: 1 }} onClick={onChangeDates}>Change dates</Button>
            <Button variant="danger" style={{ flex: 1 }} onClick={onCancel}>Cancel</Button>
          </div>
        )}
      </div>
    </>
  );
}
