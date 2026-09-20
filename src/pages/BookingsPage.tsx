import { useMemo, useState } from 'react';
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
import { CHANNEL_META, cx } from '../lib/design-tokens';
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

const COLS = 'grid-cols-[minmax(140px,1.2fr)_minmax(150px,1.4fr)_minmax(150px,1.2fr)_minmax(96px,0.7fr)_minmax(140px,1.1fr)_minmax(96px,0.8fr)_minmax(96px,0.8fr)]';

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
    const ch = r.channel === 'direct' ? 'WhatsApp' : CHANNEL_META[r.channel].label;
    toast({ tone: 'success', title: 'Message guest', body: `Opening the ${ch} thread with ${r.guestName}.` });
  }

  return (
    <>
      <PageHeader title="Bookings" sub={`${data?.total ?? rows.length} reservations`}
        right={<div className="flex gap-[9px] flex-wrap">
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Import reservations', body: 'CSV import returns per-row accepted / rejected.' })}>Import</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Export', body: 'CSV header prints the applied filters, generated time and scope.' })}>Download CSV</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => toast({ tone: 'info', title: 'Create reservation', body: 'Manual entry with the same validation as the calendar.' })}>Create reservation</Button>
        </div>} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="flex gap-2 flex-wrap py-3 px-[22px] [border-bottom:1px_solid_var(--color-line)]">
          {FILTERS.map(f => {
            const on = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cx(
                  'h-8 px-[13px] py-0 rounded-pill cursor-pointer [font-family:inherit] text-[12.5px] border border-solid',
                  on ? 'font-semibold border-transparent bg-black text-white' : 'font-medium border-line bg-page text-muted-ink',
                )}>
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[960px]">
            <div className={cx(COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
              <div>Reference</div><div>Guest</div><div>Unit</div><div>Channel</div><div>Stay</div><div className="text-right">Gross</div><div>Status</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : shown.length === 0 ? (
              <div className="py-[34px] px-[22px] text-center text-[13.5px] text-muted-ink">No reservations match this filter.</div>
            ) : shown.map(b => {
              const ch = CHANNEL_META[b.channel];
              return (
                <div key={b.id} role="button" tabIndex={0} onClick={() => setOpenId(b.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenId(b.id); }}
                  className={cx(COLS, 'grid gap-[14px] items-center min-h-[54px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer')}>
                  <div className="flex items-center gap-[9px] min-w-0">
                    <ChannelMark ch={b.channel} size={20} />
                    <span className="font-mono text-[12px] whitespace-nowrap overflow-hidden text-ellipsis">{b.externalRef ?? '—'}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{b.guestName}</span>
                    <span className="text-[11.5px] text-muted-ink">{b.guestsCount > 0 ? `${b.guestsCount} guests` : 'No guest'}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px]">{b.unitNumber}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{b.propertyName}</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center h-[22px] px-[9px] rounded-pill text-[11.5px] font-semibold whitespace-nowrap" style={{ background: ch.tint, color: ch.ink }}>{ch.label}</span>
                  </div>
                  <div className="text-[12.5px]">{dateRange(b.checkIn, b.checkOut)}</div>
                  <div className="text-right text-[13px] font-medium">{b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '—'}</div>
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
  const ch = CHANNEL_META[r.channel];
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
      <div className="relative h-[132px] bg-black flex-none flex items-end">
        <div className="absolute inset-0 grid place-items-center text-[rgba(255,255,255,0.25)]"><Icon name="Image" /></div>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-[30px] h-[30px] grid place-items-center rounded-pill bg-[rgba(0,0,0,0.4)] [border:none] text-white cursor-pointer"><Icon name="X" size="sm" /></button>
        <div className="relative p-[18px] flex items-center gap-[10px]">
          <ChannelMark ch={r.channel} size={22} />
          <span className="text-white text-[13px] font-semibold">{r.unitNumber}</span>
          <span className="text-[rgba(255,255,255,0.7)] text-[12px]">{r.propertyName}</span>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5 flex-1">
        <div className="flex items-center gap-[10px] flex-wrap">
          <Badge tone={STATE_TONE[r.state]} label={STATE_LABEL[r.state]} />
          <span className="inline-flex items-center h-[22px] px-[9px] rounded-pill text-[11.5px] font-semibold" style={{ background: ch.tint, color: ch.ink }}>{ch.label}</span>
          <span className="font-mono text-[12px] text-muted-ink">{r.externalRef}</span>
        </div>

        <div className="grid grid-cols-2 gap-px bg-line border border-solid border-line rounded-card overflow-hidden">
          {[
            [`${r.checkIn} · ${r.checkInTime}`, 'Check-in'],
            [`${r.checkOut} · ${r.checkOutTime}`, 'Check-out'],
            [`${r.nights}`, 'Nights'],
            [`${r.guestsCount || '—'}`, 'Guests'],
          ].map(([v, l]) => (
            <div key={l} className="bg-card py-[11px] px-[13px] flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{v}</span>
              <span className="text-[11px] text-muted-ink">{l}</span>
            </div>
          ))}
        </div>

        {r.grossBookingValue > 0 && (
          <div className="border border-solid border-line rounded-card overflow-hidden">
            {money.map(m => (
              <div key={m.label} className="flex justify-between gap-3 py-[10px] px-[14px] [border-bottom:1px_solid_var(--color-line-soft)]">
                <span className="text-[12.5px] text-muted-ink">{m.label}</span>
                <span className="text-[12.5px] [font-variant-numeric:tabular-nums]">{m.sign} {m.value}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-[11px] px-[14px] bg-muted">
              <span className="text-[13px] font-semibold">Collected revenue</span>
              <span className="text-[13px] font-semibold [font-variant-numeric:tabular-nums]">{rm(f.collected)}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-[12px] font-semibold text-muted-ink mb-3">Timeline</div>
          <div className="flex flex-col">
            {steps.map((s, i) => (
              <div key={s.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cx('w-[11px] h-[11px] rounded-pill border-2 border-solid', s.done ? 'bg-[var(--color-success-fg)] [border-color:var(--color-success-fg)]' : 'bg-card [border-color:var(--color-line)]')} />
                  {i < steps.length - 1 && <span className="w-0.5 flex-1 min-h-[26px] bg-line" />}
                </div>
                <div className="pb-4">
                  <div className={cx('text-[13px] font-medium', s.done ? 'text-ink' : 'text-muted-ink')}>{s.label}</div>
                  <div className="text-[11.5px] text-muted-ink">{s.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 [border-top:1px_solid_var(--color-line)] bg-page flex flex-col gap-[9px] flex-none">
        <Button variant="primary" icon={<Icon name="MessageSquare" size="sm" />} onClick={onMessage}>Message guest</Button>
        {!cancelled && (
          <div className="flex gap-[9px]">
            <Button variant="secondary" style={{ flex: 1 }} onClick={onChangeDates}>Change dates</Button>
            <Button variant="danger" style={{ flex: 1 }} onClick={onCancel}>Cancel</Button>
          </div>
        )}
      </div>
    </>
  );
}
