import { useMemo, useState } from 'react';
import { color, radius, text } from '../theme';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rm, rmDeduction, date, percent, rating } from '../lib/format';
import { TASK, PAYOUT } from '../lib/vocabulary';
import type { TaskState, PayoutState } from '../lib/types';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { useToast } from '../components/Toast';

/**
 * Owner portal `/owner`. The owner sees ONLY their own data — every endpoint
 * derives `owner_id` from the session (api.md §8, BUTTONS §13). Lower density,
 * plain language, no internal shorthand (copy.md §9, guide 15).
 *
 * There is no backend in dev, so reads come from a FALLBACK and the two writes
 * (approve a maintenance quote, download a document) run optimistically with the
 * real call attempted in a swallowed try/catch.
 */

type ChargeTo = 'owner' | 'warranty' | 'the_conts';

interface GrossToNetLine {
  label: string;
  amount: number; // integer sen; negative for fees/expenses
  type: 'gross' | 'fee' | 'expense' | 'net';
  reference?: string;
}
interface Summary {
  period: string; // YYYY-MM
  isFinal: boolean;
  statementId: string;
  unitsLabel: string;
  units: { id: string; label: string }[];
  payout: {
    amount: number; state: PayoutState;
    paidAt: string | null; scheduledFor: string | null;
    bankName: string | null; bankLast4: string | null;
  };
  grossToNet: GrossToNetLine[];
  stats: { occupancy: number; adr: number; bookings: number; rating: number | null; reviews: number };
}
interface TrendPoint { period: string; netPayout: number }
interface Trend { months: number; unitLabel: string; points: TrendPoint[] }
interface HealthIssue {
  id: string; unitLabel: string; title: string; detail: string | null;
  state: TaskState; quotedAmount: number | null; finalAmount: number | null;
  vendorName: string | null; chargeTo: ChargeTo | null;
  reportedAt: string; resolvedAt: string | null;
}
interface OwnerDoc {
  id: string; type: 'statement' | 'contract' | 'invoice' | 'report';
  refId?: string; title: string; meta: string; issuedAt: string;
}

/** No placeholder money is ever presented as the owner's — these figures tie out:
 *  9,260.00 − 2,315.00 − 385.00 − 78.00 = 6,482.00. */
const SUMMARY: Summary = {
  period: '2026-08', isFinal: true, statementId: 's1',
  unitsLabel: 'Vista Jaya One #A-12-03',
  units: [{ id: 'u1', label: 'Vista Jaya One #A-12-03' }],
  payout: { amount: 648200, state: 'paid', paidAt: '2026-09-03', scheduledFor: null, bankName: 'Maybank', bankLast4: '4417' },
  grossToNet: [
    { label: 'Gross booking value', amount: 926000, type: 'gross' },
    { label: 'Management fee · 25%', amount: -231500, type: 'fee' },
    { label: 'Housekeeping · 11 turnovers', amount: -38500, type: 'expense' },
    { label: 'Maintenance · aircon service', amount: -7800, type: 'expense', reference: 'INV-2026-0912' },
    { label: 'Net payout', amount: 648200, type: 'net' },
  ],
  stats: { occupancy: 94.1, adr: 28400, bookings: 11, rating: 4.92, reviews: 38 },
};

const TREND: Trend = {
  months: 8, unitLabel: 'Vista Jaya One #A-12-03',
  points: [
    { period: '2026-01', netPayout: 512300 },
    { period: '2026-02', netPayout: 488700 },
    { period: '2026-03', netPayout: 546200 },
    { period: '2026-04', netPayout: 573400 },
    { period: '2026-05', netPayout: 601200 },
    { period: '2026-06', netPayout: 588900 },
    { period: '2026-07', netPayout: 634500 },
    { period: '2026-08', netPayout: 648200 },
  ],
};

const HEALTH: { issues: HealthIssue[] } = {
  issues: [
    { id: 'h1', unitLabel: 'Vista Jaya One #A-12-03', title: 'Water heater replacement', detail: 'Reported after a cold-water complaint', state: 'waiting', quotedAmount: 48000, finalAmount: null, vendorName: 'CoolTech Services', chargeTo: 'owner', reportedAt: '2026-09-14', resolvedAt: null },
    { id: 'h2', unitLabel: 'Vista Jaya One #A-12-03', title: 'Aircon service', detail: 'Vendor scheduled', state: 'in_progress', quotedAmount: null, finalAmount: null, vendorName: 'CoolTech Services', chargeTo: 'owner', reportedAt: '2026-09-12', resolvedAt: null },
    { id: 'h3', unitLabel: 'Vista Jaya One #A-12-03', title: 'Grout resealing, master bath', detail: null, state: 'resolved', quotedAmount: null, finalAmount: 7800, vendorName: 'Fix & Finish', chargeTo: 'owner', reportedAt: '2026-08-25', resolvedAt: '2026-08-28' },
    { id: 'h4', unitLabel: 'Vista Jaya One #A-12-03', title: 'Smart lock firmware fix', detail: null, state: 'resolved', quotedAmount: null, finalAmount: null, vendorName: null, chargeTo: 'warranty', reportedAt: '2026-08-09', resolvedAt: '2026-08-10' },
  ],
};

const DOCS: { data: OwnerDoc[] } = {
  data: [
    { id: 'd1', type: 'statement', refId: 's1', title: 'Statement — August 2026', meta: 'Finalised 1 Sep 2026 · PDF', issuedAt: '2026-09-01' },
    { id: 'd2', type: 'contract', title: 'Management agreement', meta: 'Signed 12 Jan 2026 · 25% fee', issuedAt: '2026-01-12' },
    { id: 'd3', type: 'invoice', title: 'CoolTech Services — INV-2026-0912', meta: 'Aircon service · RM 78.00', issuedAt: '2026-09-12' },
    { id: 'd4', type: 'report', title: 'Annual earnings report 2025', meta: 'PDF', issuedAt: '2026-01-05' },
  ],
};

const card = { background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card } as const;

const monthYear = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
};
const monthShort = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'short' });
};

const DOC_ICON: Record<OwnerDoc['type'], string> = {
  statement: 'FileText', contract: 'FileSignature', invoice: 'ReceiptText', report: 'FileBarChart',
};

export default function OwnerPortalPage() {
  const summary = useApi<Summary>('/owner/summary?period=2026-08', SUMMARY);
  const trend = useApi<Trend>('/owner/trend?months=8', TREND);
  const health = useApi<{ issues: HealthIssue[] }>('/owner/property-health', HEALTH);
  const docs = useApi<{ data: OwnerDoc[] }>('/owner/documents', DOCS);
  const toast = useToast();

  const [approved, setApproved] = useState<Record<string, true>>({});
  const [approve, setApprove] = useState<HealthIssue | null>(null);

  const st = summary.data ?? SUMMARY;
  const points = trend.data?.points ?? [];
  const issues = health.data?.issues ?? [];
  const documents = docs.data?.data ?? [];
  const multiUnit = st.units.length > 1;

  // Optimistic overlay: an approved quote moves waiting → assigned locally.
  const rows = useMemo(
    () => issues.map(i => (approved[i.id] ? { ...i, state: 'assigned' as TaskState } : i)),
    [issues, approved],
  );

  function doApprove() {
    const issue = approve;
    if (!issue) return;
    setApproved(a => ({ ...a, [issue.id]: true }));
    setApprove(null);
    toast({ tone: 'success', title: 'Quote approved.', body: 'The Conts will schedule the work and confirm the date.' });
    try {
      void api.post(`/maintenance/issues/${issue.id}/approve`, { approved: true }).catch(() => { /* dev: no backend, keep optimistic */ });
    } catch { /* never let a missing backend break the interaction */ }
  }

  function downloadStatement(id: string) {
    toast({ tone: 'info', title: 'Preparing your statement', body: 'The finalised PDF is served as a signed download.' });
    api.get(`/owner/statements/${id}/pdf`).catch(() => { /* dev: no backend / binary body */ });
  }
  function downloadDoc(d: OwnerDoc) {
    toast({ tone: 'info', title: 'Preparing download', body: `${d.title} — served as a signed link.` });
    const path = d.type === 'statement' ? `/owner/statements/${d.refId ?? d.id}/pdf` : `/documents/${d.id}/download`;
    api.get(path).catch(() => { /* dev: no backend / binary body */ });
  }

  const payoutLine = st.payout.state === 'paid' && st.payout.paidAt
    ? `Transferred ${date(st.payout.paidAt)}${st.payout.bankName ? ` · ${st.payout.bankName}` : ''}${st.payout.bankLast4 ? ` ····${st.payout.bankLast4}` : ''}`
    : st.payout.scheduledFor ? `Scheduled for ${date(st.payout.scheduledFor)}` : null;

  const statsCards = [
    { label: 'Occupancy', value: percent(st.stats.occupancy), note: monthYear(st.period) },
    { label: 'Average nightly rate', value: st.stats.adr ? rm(st.stats.adr, { cents: false }) : '—', note: monthYear(st.period) },
    { label: 'Bookings', value: String(st.stats.bookings), note: monthYear(st.period) },
    { label: 'Guest rating', value: st.stats.rating != null ? rating(st.stats.rating) : '—', note: `${st.stats.reviews} reviews, last 12 months` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: text.pageTitle, fontWeight: 600, letterSpacing: '-0.015em' }}>Your property</h1>
        <span style={{ fontSize: 13.5, color: color.textMuted }}>
          {st.units.length ? st.units.map(u => u.label).join(' · ') : 'No units are on your account yet.'}
        </span>
      </div>

      {/* Statement summary — the gross → fees → expenses → net chain */}
      <section style={{ background: color.black, color: '#FFFFFF', borderRadius: radius.card, padding: 28, display: 'flex', justifyContent: 'space-between', gap: 28, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 220 }}>
          <span style={{ fontSize: 12, color: color.dim }}>Net payout · {monthYear(st.period)}</span>
          <span style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', color: color.gold }}>{rm(st.payout.amount)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <Badge label={PAYOUT[st.payout.state].label} tone={PAYOUT[st.payout.state].tone} size="sm" />
            {payoutLine && <span style={{ fontSize: 12, color: color.onDark }}>{payoutLine}</span>}
          </div>
          <span style={{ marginTop: 3, fontSize: 11.5, color: st.isFinal ? color.dim : color.gold300 }}>
            {st.isFinal ? 'Finalised statement.' : 'Provisional figures. This statement is not final and may change.'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 260, flex: 1 }}>
          <span style={{ fontSize: 11.5, color: color.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gross to net</span>
          {st.grossToNet.map(l => {
            const strong = l.type === 'net';
            return (
              <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, paddingBottom: 8, borderBottom: `1px solid ${color.charcoal}` }}>
                <span style={{ fontSize: 13, color: strong ? '#FFFFFF' : color.onDark, fontWeight: strong ? 600 : 400 }}>
                  {l.label}
                  {l.reference && <span style={{ color: color.dim }}> · {l.reference}</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: strong ? 600 : 500, color: strong ? color.gold : '#FFFFFF', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {l.amount < 0 ? rmDeduction(l.amount) : rm(l.amount)}
                </span>
              </div>
            );
          })}
          <span style={{ fontSize: 11.5, color: color.dim, textWrap: 'pretty' }}>Gross booking value is the total before documented fees and expenses.</span>
          <button
            onClick={() => downloadStatement(st.statementId)}
            style={{ alignSelf: 'flex-start', marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: `1px solid ${color.gold}`, borderRadius: radius.control, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: color.gold, cursor: 'pointer' }}
          >
            <Icon name="Download" size="sm" /> Download statement
          </button>
        </div>
      </section>

      {/* Performance stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        {statsCards.map(s => (
          <div key={s.label} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 600 }}>{s.value}</span>
            <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.note}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {/* Earnings trend — inline SVG */}
        <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Earnings over time</span>
          <span style={{ fontSize: 12, color: color.textMuted }}>
            Net payout, RM · last {trend.data?.months ?? points.length} months · {trend.data?.unitLabel ?? st.unitsLabel}
          </span>
          {points.length ? <TrendChart points={points} /> : (
            <span style={{ fontSize: 13, color: color.textMuted, marginTop: 8 }}>Earnings appear after your first statement.</span>
          )}
        </section>

        {/* Property health */}
        <section style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 20px', fontSize: text.cardTitle, fontWeight: 600, borderBottom: `1px solid ${color.borderMuted}` }}>Property health</div>
          {rows.length === 0 && <div style={{ padding: '13px 20px', fontSize: 13, color: color.textMuted }}>No maintenance on your property.</div>}
          {rows.map(i => {
            const v = TASK[i.state];
            const waiting = i.state === 'waiting' && i.quotedAmount != null;
            return (
              <div key={i.id} style={{ padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <Badge label={v.label} tone={v.tone} size="sm" />
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{i.title}</span>
                </div>
                <span style={{ fontSize: 11.5, color: color.textMuted, textWrap: 'pretty' }}>{issueLine(i, multiUnit)}</span>
                {waiting && (
                  <button
                    onClick={() => setApprove(i)}
                    style={{ alignSelf: 'flex-start', marginTop: 2, padding: '7px 13px', border: `1px solid ${color.gold}`, borderRadius: radius.control, background: 'transparent', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: color.goldInk, cursor: 'pointer' }}
                  >
                    Approve quote
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {/* Documents */}
      <section style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px', fontSize: text.cardTitle, fontWeight: 600, borderBottom: `1px solid ${color.borderMuted}` }}>Documents</div>
        {documents.length === 0 && <div style={{ padding: '13px 20px', fontSize: 13, color: color.textMuted }}>Your statements and contract will appear here.</div>}
        {documents.map(d => (
          <div key={d.id} style={{ padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, background: color.muted, color: color.inkSecondary }}>
              <Icon name={DOC_ICON[d.type]} size="sm" />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
              <span style={{ fontSize: 11.5, color: color.textMuted }}>{d.meta}</span>
            </div>
            <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => downloadDoc(d)}>Download</Button>
          </div>
        ))}
      </section>

      <Dialog
        busy={false}
        onClose={() => setApprove(null)}
        spec={!approve ? null : {
          title: `Approve ${rm(approve.quotedAmount ?? 0)} for ${approve.title.toLowerCase()}?`,
          body: 'The Conts will schedule the work and deduct the amount from your next statement.',
          meta: [`Quoted ${date(approve.reportedAt)}`, approve.vendorName && `by ${approve.vendorName}`, approve.unitLabel].filter(Boolean).join(' · '),
          confirmLabel: 'Approve quote', busyLabel: 'Approving…', onConfirm: doApprove,
        }}
      />
    </div>
  );
}

/** Owner-safe, factual language only — no internal shorthand (guide 15.2). */
function issueLine(i: HealthIssue, showUnit: boolean): string {
  const where = showUnit ? `${i.unitLabel}. ` : '';
  if (i.state === 'waiting') {
    return `${where}Quoted ${i.quotedAmount != null ? rm(i.quotedAmount) : ''}${i.vendorName ? ` by ${i.vendorName}` : ''} on ${date(i.reportedAt)}. Your approval is needed.`;
  }
  if (i.state === 'resolved') {
    const cost = i.chargeTo === 'owner' && i.finalAmount
      ? ` ${rm(i.finalAmount)} on your statement.`
      : i.chargeTo === 'warranty' ? ' Covered under warranty.' : '';
    return `${where}Completed ${date(i.resolvedAt ?? i.reportedAt)}.${cost}`;
  }
  return `${where}${i.detail ?? 'Reported'} ${date(i.reportedAt)}.`;
}

/** Net-payout trend. Uniform-scaled SVG so the gold stroke never distorts. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640, H = 172, padX = 12, padTop = 20, padBottom = 34;
  const vals = points.map(p => p.netPayout);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const innerW = W - padX * 2;
  const x = (i: number) => padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBottom);
  const baseY = H - padBottom;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.netPayout).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
  const last = points[points.length - 1];
  const lastX = x(points.length - 1), lastY = y(last.netPayout);
  const desc = points.map(p => `${monthShort(p.period)} ${rm(p.netPayout)}`).join(', ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', marginTop: 6, height: 'auto' }} role="img" aria-label={`Net payout by month: ${desc}`}>
      <defs>
        <linearGradient id="owner-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color.gold} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color.gold} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} stroke={color.borderMuted} strokeWidth="1" />
      <path d={area} fill="url(#owner-trend-fill)" />
      <path d={line} fill="none" stroke={color.gold} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="4.5" fill={color.gold} stroke="#FFFFFF" strokeWidth="2" />
      <text x={lastX} y={Math.max(14, lastY - 12)} textAnchor="end" fontSize="12" fontWeight="600" fill={color.goldInk}>{rm(last.netPayout, { cents: false })}</text>
      {points.map((p, i) => (
        <text key={p.period} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill={color.textMuted}>{monthShort(p.period)}</text>
      ))}
    </svg>
  );
}
