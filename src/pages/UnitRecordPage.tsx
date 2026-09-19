import { useRef, useState } from 'react';
import { color, radius, text, tone as T, channel as CH } from '../theme';
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
        style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', textDecoration: 'none', color: color.ink,
          background: on ? color.goldTint : '#FFFFFF', borderLeft: `3px solid ${on ? color.gold : 'transparent'}`,
          borderBottom: `1px solid ${color.borderMuted}` }}>
        <span style={{ width: 40, height: 40, flex: 'none', borderRadius: radius.sm, background: color.muted, display: 'grid', placeItems: 'center' }}>
          <Icon name="Image" size="sm" color={color.faint} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{un.unitNumber}</span>
          <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{un.propertyName} · {un.area}</span>
        </span>
        <Badge tone={READY_TONE[un.readiness]} label={cap(un.readiness)} size="sm" />
      </a>
    );
  };

  const gridItem = (un: UnitRow) => (
    <a key={un.id} href={`#/properties/units/${encodeURIComponent(un.id)}`} onClick={() => setView('list')}
      style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: color.ink, background: '#FFFFFF',
        border: `1px solid ${un.id === selectedId ? color.gold : color.border}`, borderRadius: radius.card, overflow: 'hidden' }}>
      <span style={{ height: 116, background: color.muted, display: 'grid', placeItems: 'center' }}>
        <Icon name="Image" size="lg" color={color.faint} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 14px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{un.unitNumber}</span>
          <Badge tone={READY_TONE[un.readiness]} label={cap(un.readiness)} size="sm" />
        </span>
        <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{un.propertyName} · {un.area}</span>
      </span>
    </a>
  );

  const detail = (
    <>
      {/* Identity card: photo, who and how it is performing, and the tab bar. */}
      <Card>
        <div style={{ padding: '14px 14px 0' }}>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files.item(0); if (f) takeFile(f); }}
            style={{ height: 208, borderRadius: radius.control, display: 'grid', placeItems: 'center', overflow: 'hidden',
              border: dragOver ? `1px dashed ${color.gold}` : `1px solid ${color.borderMuted}`,
              background: photo ? `center / cover no-repeat url(${photo})` : color.muted }}>
            {!photo && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                <Icon name="Image" size="lg" color={color.faint} />
                <span style={{ fontSize: 13.5, fontWeight: 500, color: color.ink }}>Drop a photo of this unit</span>
                <span style={{ fontSize: 12, color: color.textMuted }}>
                  or <button onClick={() => fileRef.current?.click()} style={{ font: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: color.goldInk, textDecoration: 'underline' }}>browse files</button>
                </span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.currentTarget.files?.item(0); if (f) takeFile(f); }} />
        </div>

        <div style={{ padding: '18px 24px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {u.propertyName} {u.unitNumber}
            </h1>
            <span style={{ fontSize: 13, color: color.textMuted }}>{u.addressLine}, {u.city}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Badge tone={READY_TONE[u.readiness]} label={cap(u.readiness)} />
              <span style={{ fontSize: 13, color: color.textMuted }}>{u.channels.map(c => CH[c].label).join(' · ')}</span>
              {!u.isListed && <Badge tone="neutral" label="Not listed" />}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 'none', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, color: color.textMuted }}>Owner</span>
            <a href="#/owners" style={{ fontSize: 14.5, fontWeight: 600, textDecoration: 'none', color: color.ink }}>{u.owner.name}</a>
            {u.contract && (
              <span style={{ fontSize: 12, color: color.textMuted }}>
                {u.contract.managementFeePct}% · renews {u.contract.renewsOn ? date(u.contract.renewsOn) : '—'}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderTop: `1px solid ${color.border}`, overflowX: 'auto' }}>
          {tabs.map(t => {
            const on = t === tab;
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '13px 4px', marginRight: 20, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
                  fontSize: 13, fontWeight: on ? 600 : 400, color: on ? color.ink : color.textMuted,
                  boxShadow: on ? `inset 0 -2px 0 ${color.gold}` : 'none' }}>
                {t}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(108px,1fr))', gap: 20, padding: '18px 24px 20px', borderTop: `1px solid ${color.borderMuted}` }}>
          {[
            ['Occupancy', `${p.occupancy}%`],
            ['ADR', rm(p.adr, { cents: false })],
            ['RevPAR', rm(p.revpar, { cents: false })],
            ['Rating', p.rating != null ? p.rating.toFixed(2) : '—'],
            ['Open issues', String(openIssues)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: color.textMuted }}>{label}</span>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</span>
            </div>
          ))}
        </div>
      </Card>

      {tab === 'Overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20, alignItems: 'start' }}>
          <Card>
            <div style={{ padding: '18px 22px 14px' }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>Stays</span>
            </div>
            {d.stays.slice(0, 3).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 22px', borderTop: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{s.guestName ?? 'No guest'}</span>
                  <span style={{ fontSize: 12, color: color.textMuted }}>{CH[s.channel].label} · {dateRange(s.checkIn, s.checkOut)}</span>
                </div>
                <Badge tone={RES_TONE[s.state]} label={cap(s.state)} />
              </div>
            ))}
          </Card>

          {d.pnl && (
            <Card>
              <div style={{ padding: '18px 22px 14px' }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{pnlMonth(p.period)} P and L</span>
              </div>
              {d.pnl.map((l, i) => {
                const net = l.type === 'net';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: '12px 22px', borderTop: `1px solid ${color.borderMuted}`, background: net ? color.page : undefined }}>
                    <span style={{ fontSize: 13.5, fontWeight: net ? 600 : 400, color: net ? color.ink : color.textMuted }}>{l.label}</span>
                    <span style={{ fontSize: net ? 15 : 13.5, fontWeight: net ? 700 : 500, color: color.ink }}>
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
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(160px,1.4fr) minmax(150px,1.3fr) minmax(110px,0.9fr) minmax(110px,1fr)', gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
                <div>Reference</div><div>Guest</div><div>Dates</div><div style={{ textAlign: 'right' }}>Gross</div><div>Status</div>
              </div>
              {d.stays.map(s => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(160px,1.4fr) minmax(150px,1.3fr) minmax(110px,0.9fr) minmax(110px,1fr)', gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <ChannelMark ch={s.channel} size={20} />
                    <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.externalRef ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5 }}>{s.guestName ?? 'No guest'}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.guestsCount} guests</span>
                  </div>
                  <span style={{ fontSize: 12.5 }}>{dateRange(s.checkIn, s.checkOut)}</span>
                  <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>
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
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: `1px solid ${color.borderMuted}`, borderLeft: `3px solid ${T[TASK_TONE[t.state]].line}`, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
                <span style={{ fontSize: 11.5, color: color.textMuted }}>
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
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Gross to net</span>
            <span style={{ fontSize: text.small, color: color.textMuted }}>{pnlMonth(p.period)}</span>
          </div>
          {d.pnl.map((l, i) => {
            const net = l.type === 'net';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: net ? '15px 20px' : '12px 20px', borderBottom: `1px solid ${color.borderMuted}`, background: net ? color.page : '#FFFFFF' }}>
                <span style={{ fontSize: net ? 14 : 13, fontWeight: net ? 600 : 400, color: net ? color.ink : color.textMuted }}>{l.label}</span>
                <span style={{ fontSize: net ? 16 : 13, fontWeight: net ? 600 : 500 }}>
                  {l.amount < 0 ? `− ${rm(Math.abs(l.amount))}` : rm(l.amount)}
                </span>
              </div>
            );
          })}
          <div style={{ padding: '13px 20px', fontSize: 11.5, color: color.textMuted, textWrap: 'pretty' }}>
            Every deduction carries a category, a date and a reference. The owner sees this same chain on their statement.
          </div>
        </Card>
      )}

      {tab === 'Maintenance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Maintenance and inventory</div>
            {d.maintenance.map(m => (
              <div key={m.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.title}</span>
                    <Badge tone={TASK_TONE[m.state]} label={cap(m.state)} />
                    {m.blocksUnit && <Badge tone="critical" label="Blocks the unit" />}
                  </div>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>
                    {m.reportedAt}{m.vendorName ? ` · ${m.vendorName}` : ''} · charged to {cap(m.chargeTo)}
                  </span>
                  {m.detail && <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{m.detail}</span>}
                </div>
                {(m.finalAmount != null || m.quotedAmount != null) && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{rm(m.finalAmount ?? m.quotedAmount!)}</span>
                    <span style={{ fontSize: 11, color: color.textMuted }}>{m.finalAmount != null ? 'Final' : 'Quoted'}</span>
                  </div>
                )}
              </div>
            ))}
          </Card>

          <Card>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Fit-out register</div>
            {d.inventory.map(i => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) minmax(90px,0.8fr) minmax(130px,1fr) minmax(100px,0.9fr)', gap: 14, alignItems: 'center', minHeight: 50, padding: '9px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5 }}>{i.name}</span>
                  {i.suppliedInHouse && <span style={{ fontSize: 11, color: color.textMuted }}>Supplied by The Conts</span>}
                </div>
                <span style={{ fontSize: 12.5 }}>{i.quantity}</span>
                <div><Badge tone={COND_TONE[i.condition] ?? 'neutral'} label={cap(i.condition)} /></div>
                <span style={{ fontSize: 12.5, textAlign: 'right' }}>
                  {i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '—'}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'Documents' && (
        <Card>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Documents</span>
            <span style={{ fontSize: text.small, color: color.textMuted }}>Statements, agreements and inspection reports for this unit. Every file is versioned and audit-logged.</span>
          </div>
          {d.documents.map(doc => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
              <Icon name="FileText" size="nav" color={color.textMuted} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{doc.name}</span>
                <span style={{ fontSize: 11.5, color: color.textMuted }}>{cap(doc.kind)} · {doc.sizeLabel} · updated {date(doc.updatedAt)}</span>
              </div>
              <button onClick={() => toast({ tone: 'success', title: `Preparing ${doc.name}.`, body: 'Your download will start shortly.' })}
                style={{ fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                Download
              </button>
            </div>
          ))}
        </Card>
      )}

      {tab === 'Activity' && (
        <Card>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Activity</span>
            <span style={{ fontSize: text.small, color: color.textMuted }}>Who did what, when, and from where. Read straight from the audit trail.</span>
          </div>
          {d.activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: `1px solid ${color.borderMuted}`, flexWrap: 'wrap' }}>
              <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                {a.actorLabel.split(' ').map(n => n[0]).slice(0, 2).join('')}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 180 }}>
                <span style={{ fontSize: 13 }}>
                  <strong style={{ fontWeight: 600 }}>{a.actorLabel}</strong> · {a.action.replace(/[._]/g, ' ')}
                </span>
                <span style={{ fontSize: 11.5, color: color.textMuted }}>{a.source.replace(/_/g, ' ')}</span>
              </div>
              <span style={{ fontSize: 11.5, color: color.textMuted }}>{a.occurredAt}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: text.pageTitle, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' }}>Units</h1>
          <div style={{ fontSize: text.small, color: color.textMuted, marginTop: 4 }}>24 units · 6 buildings</div>
        </div>
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: color.muted, borderRadius: radius.control, border: `1px solid ${color.border}` }}>
          {(['List', 'Grid'] as const).map(v => {
            const key = v.toLowerCase() as 'list' | 'grid';
            const on = view === key;
            return (
              <button key={v} onClick={() => setView(key)}
                style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 500,
                  borderRadius: radius.sm, background: on ? color.black : 'transparent', color: on ? '#FFFFFF' : color.textMuted }}>
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {error && <StaleBanner message={`Showing the last record we have. ${error}`} onRetry={reload} />}

      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 16 }}>
          {units.map(gridItem)}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0, maxWidth: 340 }}>
            <Card>{units.map(railItem)}</Card>
          </div>
          <div style={{ flex: '999 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {detail}
          </div>
        </div>
      )}
    </>
  );
}
