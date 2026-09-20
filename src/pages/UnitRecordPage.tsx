import { useState } from 'react';
import { color, radius, text, tone as T, channel as CH } from '../theme';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import Icon from '../components/Icon';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, dateRange } from '../lib/format';
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
    { label: 'Management fee \u00b7 25%', amount: -231500, type: 'fee' },
    { label: 'Housekeeping', amount: -38500, type: 'expense' },
    { label: 'Maintenance', amount: -7800, type: 'expense' },
    { label: 'Net payout', amount: 648200, type: 'net' },
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
  access: [
    { id: 'a1', kind: 'smart_lock', label: 'Main door', instruction: 'Smart lock. Lobby via the guard \u2014 say The Conts.', rotatesAfterStay: true, updatedAt: '2026-09-13' },
  ],
  activity: [
    { actorLabel: 'Aina Zulkifli', action: 'unit.readiness_change', source: 'web', occurredAt: '16 Sep 14:14' },
    { actorLabel: 'Nurul Huda', action: 'task.complete', source: 'field_app', occurredAt: '16 Sep 13:50' },
    { actorLabel: 'Priya Devi', action: 'statement.send', source: 'web', occurredAt: '1 Sep 11:00' },
  ],
};

const TABS = ['Overview', 'Reservations', 'Operations', 'Financials', 'Maintenance', 'Access', 'Activity'] as const;
type Tab = typeof TABS[number];

export default function UnitRecordPage({ unitId }: { unitId: string }) {
  const [tab, setTab] = useState<Tab>('Overview');
  const { data, loading, error, reload } = useApi<Payload>(`/units/detail?unitId=${unitId}`, FALLBACK);
  const d = data ?? FALLBACK;
  const u = d.unit;
  const p = d.performance;

  // Financial sections are absent from the payload for roles without access,
  // so the tab itself disappears rather than showing an empty shell.
  const tabs = TABS.filter(t => t !== 'Financials' || d.pnl);

  const stat = (label: string, value: string, note?: string) => (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.08em', color: color.textMuted }}>{label.toUpperCase()}</span>
      <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</span>
      {note && <span style={{ fontSize: 11.5, color: color.textMuted }}>{note}</span>}
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <a href="#/properties" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: text.small, color: color.textMuted, textDecoration: 'none' }}>
          <Icon name="ChevronLeft" size="sm" />
          <span>Properties</span>
        </a>
      </div>

      {error && <StaleBanner message={`Showing the last record we have. ${error}`} onRetry={reload} />}

      {/* Header: the answer to "how is this unit doing" without scrolling. */}
      <Card>
        <div style={{ padding: '22px 24px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: text.pageTitle, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {u.propertyName} {u.unitNumber}
                </h1>
                <Badge tone={READY_TONE[u.readiness]} label={cap(u.readiness)} />
                {!u.isListed && <Badge tone="neutral" label="Not listed" />}
              </div>
              <span style={{ fontSize: 13, color: color.textMuted }}>
                {u.addressLine}, {u.postcode} {u.city}
              </span>
              <span style={{ fontSize: 12.5, color: color.textMuted }}>
                {u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`} · {u.bathrooms} bath · sleeps {u.maxGuests}
                {u.sizeSqft ? ` · ${u.sizeSqft} sq ft` : ''}
                {u.fittedOutAt ? ` · fitted out by The Conts ${u.fittedOutAt}` : ''}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 'none', alignItems: 'flex-end' }}>
              <span style={{ fontSize: text.micro, fontWeight: 600, letterSpacing: '0.08em', color: color.textMuted }}>OWNER</span>
              <a href={`#/owners`} style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none', color: color.ink }}>{u.owner.name}</a>
              {u.contract && (
                <span style={{ fontSize: 11.5, color: color.textMuted }}>
                  {u.contract.managementFeePct}% · renews {u.contract.renewsOn ?? '\u2014'}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {u.channels.map(c => (
              <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px 0 5px', borderRadius: radius.pill, background: CH[c].tint, border: `1px solid ${CH[c].fill}33` }}>
                <ChannelMark ch={c} size={20} />
                <span style={{ fontSize: 12, fontWeight: 500, color: CH[c].ink }}>{CH[c].label}</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 18, paddingTop: 16, borderTop: `1px solid ${color.borderMuted}` }}>
            {stat('Occupancy', `${p.occupancy}%`, `${p.occupiedNights} nights`)}
            {stat('ADR', rm(p.adr, { cents: false }))}
            {stat('RevPAR', rm(p.revpar, { cents: false }))}
            {p.revenue != null && stat('Revenue', rm(p.revenue, { cents: false }), 'this month')}
            {stat('Rating', p.rating?.toFixed(2) ?? '\u2014', `${p.reviewCount} reviews`)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderTop: `1px solid ${color.border}`, overflowX: 'auto' }}>
          {tabs.map(t => {
            const on = t === tab;
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '13px 4px', marginRight: 18, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap',
                  fontSize: 13, fontWeight: on ? 600 : 400, color: on ? color.ink : color.textMuted,
                  boxShadow: on ? `inset 0 -2px 0 ${color.gold}` : 'none' }}>
                {t}
              </button>
            );
          })}
        </div>
      </Card>

      {loading && !data ? <Card><TableSkeleton rows={5} cols={4} /></Card> : (
        <>
          {tab === 'Overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20, alignItems: 'start' }}>
              <Card>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Current and next stay</div>
                {d.stays.slice(0, 3).map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                    <ChannelMark ch={s.channel} size={22} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.guestName ?? 'No guest'}</span>
                      <span style={{ fontSize: 11.5, color: color.textMuted }}>{dateRange(s.checkIn, s.checkOut)}</span>
                    </div>
                    <Badge tone={RES_TONE[s.state]} label={cap(s.state)} />
                  </div>
                ))}
              </Card>

              <Card>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Open work</div>
                {d.tasks.filter(t => t.state !== 'resolved').length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: color.textMuted }}>Nothing outstanding on this unit.</div>
                ) : d.tasks.filter(t => t.state !== 'resolved').map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
                      <span style={{ fontSize: 11.5, color: color.textMuted }}>{t.assigneeName ?? 'Unassigned'}{t.dueAt ? ` · due ${t.dueAt}` : ''}</span>
                    </div>
                    <Badge tone={TASK_TONE[t.state]} label={cap(t.state)} />
                  </div>
                ))}
              </Card>
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
                        <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.externalRef ?? '\u2014'}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5 }}>{s.guestName ?? 'No guest'}</span>
                        <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.guestsCount} guests</span>
                      </div>
                      <span style={{ fontSize: 12.5 }}>{dateRange(s.checkIn, s.checkOut)}</span>
                      <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>
                        {s.grossBookingValue != null && s.grossBookingValue > 0 ? rm(s.grossBookingValue, { cents: false }) : '\u2014'}
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
                <span style={{ fontSize: text.small, color: color.textMuted }}>{p.period}</span>
              </div>
              {d.pnl.map((l, i) => {
                const net = l.type === 'net';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: net ? '15px 20px' : '12px 20px', borderBottom: `1px solid ${color.borderMuted}`, background: net ? color.page : '#FFFFFF' }}>
                    <span style={{ fontSize: net ? 14 : 13, fontWeight: net ? 600 : 400, color: net ? color.ink : color.textMuted }}>{l.label}</span>
                    <span style={{ fontSize: net ? 16 : 13, fontWeight: net ? 600 : 500 }}>
                      {l.amount < 0 ? `\u2212 ${rm(Math.abs(l.amount))}` : rm(l.amount)}
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
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, fontSize: text.cardTitle, fontWeight: 600 }}>Issue history</div>
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
                      {i.purchaseCost != null ? rm(i.purchaseCost, { cents: false }) : '\u2014'}
                    </span>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {tab === 'Access' && (
            <Card>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Access and keys</span>
                <span style={{ fontSize: text.small, color: color.textMuted }}>
                  Codes are never included here. Reveal one from Access and keys, where it is recorded against your account.
                </span>
              </div>
              {d.access.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px', borderBottom: `1px solid ${color.borderMuted}`, flexWrap: 'wrap' }}>
                  <Icon name="KeyRound" size="nav" color={color.textMuted} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{cap(a.kind)} · {a.label}</span>
                      {a.rotatesAfterStay && <Badge tone="info" label="Rotates after each stay" />}
                    </div>
                    <span style={{ fontSize: 12.5, color: color.textMuted, textWrap: 'pretty' }}>{a.instruction}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>Updated {a.updatedAt}</span>
                </div>
              ))}
              <div style={{ padding: '14px 20px' }}>
                <a href="#/properties/access" style={{ fontSize: text.small, fontWeight: 600, color: color.goldInk, textDecoration: 'none' }}>
                  Open Access and keys →
                </a>
              </div>
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
      )}
    </>
  );
}
