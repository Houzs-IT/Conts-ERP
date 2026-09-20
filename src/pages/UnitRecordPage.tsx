import { useRef, useState } from 'react';
import { color, tone as T, channel as CH } from '../theme';
import { cx } from '../lib/design-tokens';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { rm, dateRange, date } from '../lib/format';
import type { Tone, UnitReadiness, TaskState, BookingChannel, ReservationState } from '../lib/types';

const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};
const TASK_TONE: Record<TaskState, Tone> = {
  open: 'neutral', assigned: 'info', in_progress: 'info', waiting: 'warning',
  resolved: 'success', overdue: 'critical', reopened: 'critical',
};
const RES_TONE: Record<ReservationState, Tone> = {
  inquiry: 'neutral', pending: 'warning', confirmed: 'info', checked_in: 'success',
  checked_out: 'neutral', cancelled: 'neutral', no_show: 'critical',
};
const COND_TONE: Record<string, Tone> = {
  good: 'success', fair: 'neutral', replace_soon: 'warning', damaged: 'critical',
};
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The P&L on the record is the last CLOSED month; performance stats are the current month to date. */
const pnlMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() - 1);
  return MONTHS[dt.getMonth()];
};

/** Reservations table template — one arbitrary class so header and rows stay
 *  in lockstep; the literal lives here verbatim so Tailwind can extract it. */
const RES_COLS = 'grid-cols-[minmax(150px,1.3fr)_minmax(160px,1.4fr)_minmax(150px,1.3fr)_minmax(110px,0.9fr)_minmax(110px,1fr)]';

interface Payload {
  unit: {
    id: string; unitNumber: string; propertyName: string; addressLine: string;
    city: string; state: string; postcode: string | null;
    readiness: UnitReadiness; bedrooms: number; bathrooms: number; maxGuests: number;
    sizeSqft: number | null; isListed: boolean; fittedOutAt: string | null;
    channels: BookingChannel[];
    owner: { id: string; name: string; email: string | null };
    contract: { managementFeePct: number; startsOn: string; renewsOn: string | null } | null;
    baseRate?: number;
  };
  performance: {
    period: string; occupancy: number; occupiedNights: number; adr: number;
    revpar: number; rating: number | null; reviewCount: number;
    revenue?: number; gross?: number;
  };
  pnl?: { label: string; amount: number; type: string }[];
  stays: { id: string; guestName: string | null; channel: BookingChannel; state: ReservationState; checkIn: string; checkOut: string; guestsCount: number; externalRef: string | null; grossBookingValue?: number }[];
  tasks: { id: string; title: string; kind: string; state: TaskState; dueAt: string | null; completedAt: string | null; assigneeName: string | null }[];
  maintenance: { id: string; title: string; detail: string | null; state: TaskState; vendorName: string | null; ownerApprovalRequired: boolean; blocksUnit: boolean; chargeTo: string; reportedAt: string; resolvedAt: string | null; quotedAmount?: number | null; finalAmount?: number | null }[];
  inventory: { id: string; name: string; quantity: string; condition: string; suppliedInHouse: boolean; installedOn: string | null; lastChecked: string | null; purchaseCost?: number | null }[];
  documents: { id: string; name: string; kind: string; sizeLabel: string; updatedAt: string }[];
  access: { id: string; kind: string; label: string; instruction: string; rotatesAfterStay: boolean; updatedAt: string }[];
  activity: { actorLabel: string; action: string; source: string; occurredAt: string }[];
  generatedAt: string;
}

const FALLBACK: Payload = {
  generatedAt: '',
  unit: {
    id: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One',
    addressLine: 'C-41-06, Jaya One, Jalan Universiti', city: 'Petaling Jaya', state: 'Selangor', postcode: '46200',
    readiness: 'occupied', bedrooms: 2, bathrooms: 2, maxGuests: 4, sizeSqft: 850,
    isListed: true, fittedOutAt: '2025-03-01',
    channels: ['airbnb', 'booking_com', 'direct'],
    owner: { id: 'o1', name: 'Lim Chee Keong', email: 'limck@example.com' },
    contract: { managementFeePct: 25, startsOn: '2025-03-01', renewsOn: '2027-03-01' },
    baseRate: 28400,
  },
  performance: { period: '2026-09', occupancy: 94.1, occupiedNights: 28, adr: 28400, revpar: 26700, rating: 4.92, reviewCount: 11, revenue: 812000, gross: 926000 },
  pnl: [
    { label: 'Gross booking value', amount: 926000, type: 'gross' },
    { label: 'Management fee 25%', amount: -231500, type: 'fee' },
    { label: 'Housekeeping', amount: -38500, type: 'expense' },
    { label: 'Maintenance', amount: -7800, type: 'expense' },
    { label: 'Net owner payout', amount: 648200, type: 'net' },
  ],
  stays: [
    { id: 's1', guestName: 'Nadia Abdullah', channel: 'airbnb', state: 'checked_in', checkIn: '2026-09-13', checkOut: '2026-09-16', guestsCount: 2, externalRef: 'ABNB-7741QK', grossBookingValue: 85200 },
    { id: 's2', guestName: 'Aaron Lee', channel: 'direct', state: 'confirmed', checkIn: '2026-09-16', checkOut: '2026-09-20', guestsCount: 2, externalRef: 'TC-2026-0916', grossBookingValue: 113600 },
    { id: 's3', guestName: 'Priya Sundaram', channel: 'booking_com', state: 'pending', checkIn: '2026-09-24', checkOut: '2026-10-01', guestsCount: 2, externalRef: 'BDC-5512087', grossBookingValue: 198800 },
  ],
  tasks: [
    { id: 't1', title: 'Full turnover, 2BR', kind: 'turnover', state: 'in_progress', dueAt: '16 Sep 14:30', completedAt: null, assigneeName: 'Nurul Huda' },
    { id: 't2', title: 'Owner report photos', kind: 'other', state: 'resolved', dueAt: '15 Sep 16:30', completedAt: '15 Sep 16:12', assigneeName: 'Chan Wei Wen' },
  ],
  maintenance: [
    { id: 'MNT-0912', title: 'Curtain replacement quoted', detail: 'Blackout curtains, 3 windows.', state: 'waiting', vendorName: 'Kiara Interiors', ownerApprovalRequired: true, blocksUnit: false, chargeTo: 'owner', reportedAt: '12 Sep', resolvedAt: null, quotedAmount: 89000 },
    { id: 'MNT-0910', title: 'Aircon service', detail: 'Quarterly service.', state: 'resolved', vendorName: 'CoolCare', ownerApprovalRequired: false, blocksUnit: false, chargeTo: 'owner', reportedAt: '10 Sep', resolvedAt: '12 Sep', finalAmount: 18000 },
    { id: 'MNT-0828', title: 'Water heater replaced', detail: 'Same-day replacement.', state: 'resolved', vendorName: 'In-house crew', ownerApprovalRequired: false, blocksUnit: false, chargeTo: 'warranty', reportedAt: '28 Aug', resolvedAt: '28 Aug', finalAmount: 64000 },
  ],
  inventory: [
    { id: 'i1', name: 'Queen bed frame and mattress', quantity: '1 set', condition: 'good', suppliedInHouse: true, installedOn: '2025-03-01', lastChecked: '2026-09-12', purchaseCost: 320000 },
    { id: 'i2', name: 'Three-seater fabric sofa', quantity: '1', condition: 'fair', suppliedInHouse: true, installedOn: '2025-03-01', lastChecked: '2026-09-12', purchaseCost: 185000 },
    { id: 'i3', name: 'Blackout curtains', quantity: '3 windows', condition: 'replace_soon', suppliedInHouse: true, installedOn: '2025-03-01', lastChecked: '2026-09-12', purchaseCost: 89000 },
  ],
  documents: [
    { id: 'd1', name: 'August owner statement', kind: 'statement', sizeLabel: 'PDF · 118 KB', updatedAt: '2026-09-01' },
    { id: 'd2', name: 'Management agreement', kind: 'contract', sizeLabel: 'PDF · 240 KB', updatedAt: '2025-03-01' },
    { id: 'd3', name: 'Move-in inspection report', kind: 'inspection', sizeLabel: 'PDF · 1.2 MB', updatedAt: '2025-03-01' },
  ],
  access: [
    { id: 'a1', kind: 'smart_lock', label: 'Main door', instruction: 'Smart lock. Lobby via the guard — say The Conts.', rotatesAfterStay: true, updatedAt: '2026-09-13' },
  ],
  activity: [
    { actorLabel: 'Aina Zulkifli', action: 'unit.readiness_change', source: 'web', occurredAt: '16 Sep 14:14' },
    { actorLabel: 'Nurul Huda', action: 'task.complete', source: 'field_app', occurredAt: '16 Sep 13:50' },
    { actorLabel: 'Priya Devi', action: 'statement.send', source: 'web', occurredAt: '1 Sep 11:00' },
  ],
};

interface UnitRow { id: string; unitNumber: string; propertyName: string; area: string; readiness: UnitReadiness; }
const UNITS_FALLBACK: UnitRow[] = [
  { id: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', area: 'PJ', readiness: 'occupied' },
  { id: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris', area: 'Mont Kiara', readiness: 'cleaning' },
  { id: 'u3', unitNumber: '#2207', propertyName: 'Tribeca', area: 'Bukit Bintang', readiness: 'ready' },
  { id: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz', area: 'KLCC', readiness: 'dirty' },
  { id: 'u5', unitNumber: '#A-21-02', propertyName: 'The Establishment', area: 'Kuchai', readiness: 'dirty' },
  { id: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', area: 'KL Sentral', readiness: 'maintenance' },
];

const TABS = ['Overview', 'Reservations', 'Operations', 'Financials', 'Maintenance', 'Documents', 'Activity'] as const;
type Tab = typeof TABS[number];

export default function UnitRecordPage({ unitId }: { unitId: string }) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [photo, setPhoto] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const { data, error, reload } = useApi<Payload>(`/units/detail?unitId=${unitId}`, FALLBACK);
  const { data: unitsData } = useApi<UnitRow[]>('/units', UNITS_FALLBACK);

  const d = data ?? FALLBACK;
  const u = d.unit;
  const p = d.performance;
  const units = unitsData ?? UNITS_FALLBACK;
  const selectedId = units.some(x => x.id === unitId) ? unitId : units[0].id;
  const openIssues = d.maintenance.filter(m => m.state !== 'resolved').length;

  // Financial sections are absent from the payload for roles without access,
  // so the tab and the P&L card disappear rather than showing an empty shell.
  const tabs = TABS.filter(t => t !== 'Financials' || d.pnl);

  function takeFile(file: File) {
    setPhoto(URL.createObjectURL(file));
    toast({ tone: 'success', title: 'Photo added to this unit.', body: 'It will appear on the owner statement and channel listings.' });
  }

  const railItem = (un: UnitRow) => {
    const on = un.id === selectedId;
    return (
      <a key={un.id} href={`#/properties/units/${encodeURIComponent(un.id)}`} onClick={() => setView('list')}
        className={cx(
          'flex items-center gap-[11px] py-[11px] px-[13px] no-underline text-ink!',
          '[border-bottom:1px_solid_var(--color-line-soft)]',
          on ? 'bg-gold-tint [border-left:3px_solid_var(--color-gold)]' : 'bg-card [border-left:3px_solid_transparent]',
        )}>
        <span className="w-10 h-10 flex-none rounded-[6px] bg-muted grid place-items-center">
          <Icon name="Image" size="sm" color={color.faint} />
        </span>
        <span className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-[13.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{un.unitNumber}</span>
          <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{un.propertyName} · {un.area}</span>
        </span>
        <Badge tone={READY_TONE[un.readiness]} label={cap(un.readiness)} size="sm" />
      </a>
    );
  };

  const gridItem = (un: UnitRow) => (
    <a key={un.id} href={`#/properties/units/${encodeURIComponent(un.id)}`} onClick={() => setView('list')}
      className={cx(
        'flex flex-col no-underline text-ink! bg-card border border-solid rounded-card overflow-hidden',
        un.id === selectedId ? 'border-gold' : 'border-line',
      )}>
      <span className="h-[116px] bg-muted grid place-items-center">
        <Icon name="Image" size="lg" color={color.faint} />
      </span>
      <span className="flex flex-col gap-[5px] py-3 px-[14px]">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{un.unitNumber}</span>
          <Badge tone={READY_TONE[un.readiness]} label={cap(un.readiness)} size="sm" />
        </span>
        <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{un.propertyName} · {un.area}</span>
      </span>
    </a>
  );

  const detail = (
    <>
      {/* Identity card: photo, who and how it is performing, and the tab bar. */}
      <Card>
        <div className="pt-[14px] px-[14px] pb-0">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files.item(0); if (f) takeFile(f); }}
            className={cx(
              'h-[208px] rounded-control grid place-items-center overflow-hidden bg-muted',
              dragOver ? '[border:1px_dashed_var(--color-gold)]' : '[border:1px_solid_var(--color-line-soft)]',
            )}
            style={photo ? { background: `center / cover no-repeat url(${photo})` } : undefined}>
            {!photo && (
              <div className="flex flex-col items-center gap-[7px]">
                <Icon name="Image" size="lg" color={color.faint} />
                <span className="text-[13.5px] font-medium text-ink">Drop a photo of this unit</span>
                <span className="text-[12px] text-muted-ink">
                  or <button onClick={() => fileRef.current?.click()} className="[font:inherit] text-[12px]! bg-transparent [border:none] p-0 cursor-pointer text-gold-ink underline">browse files</button>
                </span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.currentTarget.files?.item(0); if (f) takeFile(f); }} />
        </div>

        <div className="pt-[18px] px-6 pb-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-[9px] min-w-0">
            <h1 className="m-0 text-[24px] leading-[1.2] font-semibold tracking-[-0.01em]">
              {u.propertyName} {u.unitNumber}
            </h1>
            <span className="text-[13px] text-muted-ink">{u.addressLine}, {u.city}</span>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge tone={READY_TONE[u.readiness]} label={cap(u.readiness)} />
              <span className="text-[13px] text-muted-ink">{u.channels.map(c => CH[c].label).join(' · ')}</span>
              {!u.isListed && <Badge tone="neutral" label="Not listed" />}
            </div>
          </div>

          <div className="flex flex-col gap-1 flex-none items-start">
            <span className="text-[12px] text-muted-ink">Owner</span>
            <a href="#/owners" className="text-[14.5px] font-semibold no-underline text-ink!">{u.owner.name}</a>
            {u.contract && (
              <span className="text-[12px] text-muted-ink">
                {u.contract.managementFeePct}% · renews {u.contract.renewsOn ? date(u.contract.renewsOn) : '—'}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-0.5 px-6 [border-top:1px_solid_var(--color-line)] overflow-x-auto">
          {tabs.map(t => {
            const on = t === tab;
            return (
              <button key={t} onClick={() => setTab(t)}
                className={cx(
                  'py-[13px] px-1 mr-5 [border:none] bg-transparent cursor-pointer [font:inherit] whitespace-nowrap text-[13px]!',
                  on ? 'font-semibold! text-ink [box-shadow:inset_0_-2px_0_var(--color-gold)]' : 'text-muted-ink',
                )}>
                {t}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(108px,1fr))] gap-5 pt-[18px] px-6 pb-5 [border-top:1px_solid_var(--color-line-soft)]">
          {[
            ['Occupancy', `${p.occupancy}%`],
            ['ADR', rm(p.adr, { cents: false })],
            ['RevPAR', rm(p.revpar, { cents: false })],
            ['Rating', p.rating != null ? p.rating.toFixed(2) : '—'],
            ['Open issues', String(openIssues)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[12.5px] font-medium text-muted-ink">{label}</span>
              <span className="text-[24px] font-semibold tracking-[-0.01em]">{value}</span>
            </div>
          ))}
        </div>
      </Card>

      {tab === 'Overview' && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5 [align-items:start]">
          <Card>
            <div className="pt-[18px] px-[22px] pb-[14px]">
              <span className="text-[18px] font-semibold">Stays</span>
            </div>
            {d.stays.slice(0, 3).map(s => (
              <div key={s.id} className="flex items-center gap-[14px] py-[13px] px-[22px] [border-top:1px_solid_var(--color-line-soft)]">
                <div className="flex flex-col gap-[3px] flex-1 min-w-0">
                  <span className="text-[14px] font-semibold">{s.guestName ?? 'No guest'}</span>
                  <span className="text-[12px] text-muted-ink">{CH[s.channel].label} · {dateRange(s.checkIn, s.checkOut)}</span>
                </div>
                <Badge tone={RES_TONE[s.state]} label={cap(s.state)} />
              </div>
            ))}
          </Card>

          {d.pnl && (
            <Card>
              <div className="pt-[18px] px-[22px] pb-[14px]">
                <span className="text-[18px] font-semibold">{pnlMonth(p.period)} P and L</span>
              </div>
              {d.pnl.map((l, i) => {
                const net = l.type === 'net';
                return (
                  <div key={i} className={cx('flex items-center justify-between gap-5 py-3 px-[22px] [border-top:1px_solid_var(--color-line-soft)]', net && 'bg-page')}>
                    <span className={cx('text-[13.5px]', net ? 'font-semibold text-ink' : 'font-normal text-muted-ink')}>{l.label}</span>
                    <span className={cx('text-ink', net ? 'text-[15px] font-bold' : 'text-[13.5px] font-medium')}>
                      {l.amount < 0 ? `− ${rm(Math.abs(l.amount), { cents: false })}` : rm(l.amount, { cents: false })}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {tab === 'Reservations' && (
        <Card>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className={cx(RES_COLS, 'grid gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink')}>
                <div>Reference</div><div>Guest</div><div>Dates</div><div className="text-right">Gross</div><div>Status</div>
              </div>
              {d.stays.map(s => (
                <div key={s.id} className={cx(RES_COLS, 'grid gap-[14px] items-center min-h-[52px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)]')}>
                  <div className="flex items-center gap-[9px] min-w-0">
                    <ChannelMark ch={s.channel} size={20} />
                    <span className="font-mono text-[12px] whitespace-nowrap overflow-hidden text-ellipsis">{s.externalRef ?? '—'}</span>
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px]">{s.guestName ?? 'No guest'}</span>
                    <span className="text-[11.5px] text-muted-ink">{s.guestsCount} guests</span>
                  </div>
                  <span className="text-[12.5px]">{dateRange(s.checkIn, s.checkOut)}</span>
                  <span className="text-[13px] text-right font-medium">
                    {s.grossBookingValue != null && s.grossBookingValue > 0 ? rm(s.grossBookingValue, { cents: false }) : '—'}
                  </span>
                  <div><Badge tone={RES_TONE[s.state]} label={cap(s.state)} /></div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {tab === 'Operations' && (
        <Card>
          {d.tasks.map(t => (
            <div key={t.id} className="flex items-center gap-[14px] py-[14px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex-wrap"
              style={{ borderLeft: `3px solid ${T[TASK_TONE[t.state]].line}` }}>
              <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                <span className="text-[13.5px] font-medium">{t.title}</span>
                <span className="text-[11.5px] text-muted-ink">
                  {cap(t.kind)} · {t.assigneeName ?? 'Unassigned'}
                  {t.completedAt ? ` · done ${t.completedAt}` : t.dueAt ? ` · due ${t.dueAt}` : ''}
                </span>
              </div>
              <Badge tone={TASK_TONE[t.state]} label={cap(t.state)} />
            </div>
          ))}
        </Card>
      )}

      {tab === 'Financials' && d.pnl && (
        <Card>
          <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[16px] font-semibold">Gross to net</span>
            <span className="text-[12px] text-muted-ink">{pnlMonth(p.period)}</span>
          </div>
          {d.pnl.map((l, i) => {
            const net = l.type === 'net';
            return (
              <div key={i} className={cx('flex items-center justify-between gap-5 [border-bottom:1px_solid_var(--color-line-soft)]', net ? 'py-[15px] px-5 bg-page' : 'py-3 px-5 bg-card')}>
                <span className={cx(net ? 'text-[14px] font-semibold text-ink' : 'text-[13px] font-normal text-muted-ink')}>{l.label}</span>
                <span className={cx(net ? 'text-[16px] font-semibold' : 'text-[13px] font-medium')}>
                  {l.amount < 0 ? `− ${rm(Math.abs(l.amount))}` : rm(l.amount)}
                </span>
              </div>
            );
          })}
          <div className="py-[13px] px-5 text-[11.5px] text-muted-ink [text-wrap:pretty]">
            Every deduction carries a category, a date and a reference. The owner sees this same chain on their statement.
          </div>
        </Card>
      )}

      {tab === 'Maintenance' && (
        <div className="flex flex-col gap-5">
          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-[16px] font-semibold">Maintenance and inventory</div>
            {d.maintenance.map(m => (
              <div key={m.id} className="py-[14px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-start gap-4 flex-wrap">
                <div className="flex flex-col gap-[3px] flex-1 min-w-[220px]">
                  <div className="flex items-center gap-[9px] flex-wrap">
                    <span className="text-[13.5px] font-semibold">{m.title}</span>
                    <Badge tone={TASK_TONE[m.state]} label={cap(m.state)} />
                    {m.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
                  </div>
                  <span className="text-[11.5px] text-muted-ink">
                    {m.reportedAt}{m.vendorName ? ` · ${m.vendorName}` : ''} · charged to {cap(m.chargeTo)}
                  </span>
                  {m.detail && <span className="text-[12.5px] [text-wrap:pretty]">{m.detail}</span>}
                </div>
                {(m.finalAmount != null || m.quotedAmount != null) && (
                  <div className="flex flex-col items-end gap-0.5 flex-none">
                    <span className="text-[14px] font-semibold">{rm(m.finalAmount ?? m.quotedAmount!)}</span>
                    <span className="text-[11px] text-muted-ink">{m.finalAmount != null ? 'Final' : 'Quoted'}</span>
                  </div>
                )}
              </div>
            ))}
          </Card>

          <Card>
            <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-[16px] font-semibold">Fit-out register</div>
            {d.inventory.map(i => (
              <div key={i.id} className="grid grid-cols-[minmax(200px,2fr)_minmax(90px,0.8fr)_minmax(130px,1fr)_minmax(100px,0.9fr)] gap-[14px] items-center min-h-[50px] py-[9px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-[13.5px]">{i.name}</span>
                  {i.suppliedInHouse && <span className="text-[11px] text-muted-ink">Supplied by The Conts</span>}
                </div>
                <span className="text-[12.5px]">{i.quantity}</span>
                <div><Badge tone={COND_TONE[i.condition] ?? 'neutral'} label={cap(i.condition)} /></div>
                <span className="text-[12.5px] text-right">
                  {i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'Documents' && (
        <Card>
          <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-[16px] font-semibold">Documents</span>
            <span className="text-[12px] text-muted-ink">Statements, agreements and inspection reports for this unit. Every file is versioned and audit-logged.</span>
          </div>
          {d.documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-[14px] py-[13px] px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
              <Icon name="FileText" size="nav" color={color.textMuted} />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-[13.5px] font-medium">{doc.name}</span>
                <span className="text-[11.5px] text-muted-ink">{cap(doc.kind)} · {doc.sizeLabel} · updated {date(doc.updatedAt)}</span>
              </div>
              <button onClick={() => toast({ tone: 'success', title: `Preparing ${doc.name}.`, body: 'Your download will start shortly.' })}
                className="text-gold-ink bg-transparent [border:none] cursor-pointer [font:inherit]">
                Download
              </button>
            </div>
          ))}
        </Card>
      )}

      {tab === 'Activity' && (
        <Card>
          <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
            <span className="text-[16px] font-semibold">Activity</span>
            <span className="text-[12px] text-muted-ink">Who did what, when, and from where. Read straight from the audit trail.</span>
          </div>
          {d.activity.map((a, i) => (
            <div key={i} className="flex items-center gap-[14px] py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex-wrap">
              <span className="w-[30px] h-[30px] flex-none rounded-full bg-muted text-muted-ink grid place-items-center text-[11px] font-semibold">
                {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
              <div className="flex flex-col gap-px flex-1 min-w-[180px]">
                <span className="text-[13px]">
                  <strong className="font-semibold">{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}
                </span>
                <span className="text-[11.5px] text-muted-ink">{a.source.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-[11.5px] text-muted-ink">{a.occurredAt}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 text-[28px] leading-[1.2] font-semibold tracking-[-0.01em]">Units</h1>
          <div className="text-[12px] text-muted-ink mt-1">24 units · 6 buildings</div>
        </div>
        <div className="inline-flex gap-[3px] p-[3px] bg-muted rounded-control border border-solid border-line">
          {(['List', 'Grid'] as const).map(v => {
            const key = v.toLowerCase() as 'list' | 'grid';
            const on = view === key;
            return (
              <button key={v} onClick={() => setView(key)}
                className={cx(
                  'px-4 py-[7px] [border:none] cursor-pointer [font:inherit] text-[13px]! font-medium! rounded-[6px]',
                  on ? 'bg-black text-white' : 'bg-transparent text-muted-ink',
                )}>
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {error && <StaleBanner message={`Showing the last record we have. ${error}`} onRetry={reload} />}

      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {units.map(gridItem)}
        </div>
      ) : (
        <div className="flex gap-5 items-start flex-wrap">
          <div className="[flex:1_1_280px] min-w-0 max-w-[340px]">
            <Card>{units.map(railItem)}</Card>
          </div>
          <div className="[flex:999_1_460px] min-w-0 flex flex-col gap-5">
            {detail}
          </div>
        </div>
      )}
    </>
  );
}
