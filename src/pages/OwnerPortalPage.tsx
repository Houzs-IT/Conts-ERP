import { useMemo, useState } from 'react';
import { color } from '../theme';
import { cx } from '../lib/design-tokens';
import { useApi } from '../lib/useApi';
import { api, downloadFile } from '../lib/api';
import { date, percent, rating, monthLabel, count, plural } from '../lib/format';
import { TASK, PAYOUT } from '../lib/vocabulary';
import type { TaskState, PayoutState } from '../lib/types';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import PageHeader from '../components/PageHeader';
import { EmptyState } from '../components/States';
import { MoneyText, moneyString } from '../components/MoneyText';
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
interface DetailLine { label: string; amount: number; type: 'gross' | 'fee' | 'expense' | 'adjustment'; reference?: string }
interface DetailUnit { id: string; label: string; gross: number; fee: number; expenses: number; adjustments: number; net: number; lines: DetailLine[] }
interface StatementDetail {
  id: string; period: string; isFinal: boolean; unitsLabel: string;
  grossBookingValue: number; managementFee: number; expensesTotal: number; adjustmentsTotal: number; netPayout: number;
  units: DetailUnit[];
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

/** Layered detail for the drill-down. Kept consistent with SUMMARY (one unit, same
 *  gross-to-net): 9,260.00 − 2,315.00 − 385.00 − 78.00 = 6,482.00. A multi-unit owner
 *  simply returns more entries in `units`, each with its own gross-to-net lines. */
const BREAKDOWN: StatementDetail = {
  id: 's1', period: '2026-08', isFinal: true, unitsLabel: 'Vista Jaya One #A-12-03',
  grossBookingValue: 926000, managementFee: 231500, expensesTotal: 46300, adjustmentsTotal: 0, netPayout: 648200,
  units: [
    {
      id: 'u1', label: 'Vista Jaya One #A-12-03',
      gross: 926000, fee: 231500, expenses: 46300, adjustments: 0, net: 648200,
      lines: [
        { label: 'Gross booking value', amount: 926000, type: 'gross' },
        { label: 'Management fee · 25%', amount: -231500, type: 'fee' },
        { label: 'Housekeeping · 11 turnovers', amount: -38500, type: 'expense' },
        { label: 'Maintenance · aircon service', amount: -7800, type: 'expense', reference: 'INV-2026-0912' },
      ],
    },
  ],
};

const DOC_ICON: Record<OwnerDoc['type'], string> = {
  statement: 'FileText', contract: 'FileSignature', invoice: 'ReceiptText', report: 'FileBarChart',
};

export default function OwnerPortalPage() {
  const summary = useApi<Summary>('/owner/summary', SUMMARY);
  const trend = useApi<Trend>('/owner/trend?months=8', TREND);
  const health = useApi<{ issues: HealthIssue[] }>('/owner/property-health', HEALTH);
  const docs = useApi<{ data: OwnerDoc[] }>('/owner/documents', DOCS);
  const toast = useToast();

  const [approved, setApproved] = useState<Record<string, true>>({});
  const [approve, setApprove] = useState<HealthIssue | null>(null);

  const st = summary.data ?? (import.meta.env.DEV ? SUMMARY : null);
  const points = trend.data?.points ?? [];
  const issues = health.data?.issues ?? [];
  const documents = docs.data?.data ?? [];

  // Optimistic overlay: an approved quote moves waiting → assigned locally.
  const rows = useMemo(
    () => issues.map(i => (approved[i.id] ? { ...i, state: 'assigned' as TaskState } : i)),
    [issues, approved],
  );

  if (!st) {
    return <div className="p-6 text-copy text-muted-ink">{summary.error ?? 'Loading your account…'}</div>;
  }
  const multiUnit = st.units.length > 1;

  async function doApprove() {
    const issue = approve;
    if (!issue) return;
    setApprove(null);
    try {
      await api.post(`/maintenance/issues/${issue.id}/approve`, { approved: true, quotedAmount: issue.quotedAmount });
      setApproved(a => ({ ...a, [issue.id]: true }));
      health.reload();
      toast({ tone: 'success', title: 'Quote approved.', body: 'The Conts will schedule the work and confirm the date.' });
    } catch (e) {
      toast({ tone: 'critical', title: 'Quote was not approved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  function downloadStatement(id: string) {
    window.open(`/api/owner/statements/${encodeURIComponent(id)}/pdf`, '_blank', 'noopener');
  }
  async function downloadDoc(d: OwnerDoc) {
    if (d.type === 'statement') { downloadStatement(d.refId ?? d.id); return; }
    try {
      await downloadFile(`/documents/${d.id}/download`);
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not download.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  const payoutLine = st.payout.state === 'paid' && st.payout.paidAt
    ? `Transferred ${date(st.payout.paidAt)}${st.payout.bankName ? ` · ${st.payout.bankName}` : ''}${st.payout.bankLast4 ? ` ····${st.payout.bankLast4}` : ''}`
    : st.payout.scheduledFor ? `Scheduled for ${date(st.payout.scheduledFor)}` : null;

  const statsCards = [
    { label: 'Occupancy', value: percent(st.stats.occupancy), note: monthLabel(st.period) },
    { label: 'Average nightly rate', value: st.stats.adr ? moneyString(st.stats.adr, 'whole') : '—', note: monthLabel(st.period) },
    { label: 'Bookings', value: count(st.stats.bookings), note: monthLabel(st.period) },
    { label: 'Guest rating', value: st.stats.rating != null ? rating(st.stats.rating) : '—', note: `${plural(st.stats.reviews, 'review')}, last 12 months` },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Your property"
        sub={st.units.length
          ? st.units.map((u, i) => (
              <span key={u.id}>
                {i > 0 && ' · '}
                <a href={`#/properties/units/${encodeURIComponent(u.id)}`} className="no-underline text-inherit!">{u.label}</a>
              </span>
            ))
          : 'No units are on your account yet.'}
      />

      {/* Statement summary — the gross → fees → expenses → net chain */}
      <section className="bg-black text-white rounded-card p-5 flex justify-between gap-6 flex-wrap">
        <div className="flex flex-col gap-2 min-w-[220px]">
          <span className="text-meta text-[var(--color-text-on-dark-muted)]">Net payout · {monthLabel(st.period)}</span>
          <MoneyText sen={st.payout.amount} mode="exact" className="text-headline leading-[1.1] font-semibold tracking-[-0.01em] text-gold" />
          <div className="flex items-center gap-2 flex-wrap">
            <Badge label={PAYOUT[st.payout.state].label} tone={PAYOUT[st.payout.state].tone} size="sm" />
            {payoutLine && <span className="text-meta text-[var(--color-text-on-dark)]">{payoutLine}</span>}
          </div>
          <span className={cx('mt-1 text-meta', st.isFinal ? 'text-[var(--color-text-on-dark-muted)]' : 'text-[var(--color-gold-300)]')}>
            {st.isFinal ? 'Finalised statement.' : 'Provisional figures. This statement is not final and may change.'}
          </span>
        </div>

        <div className="flex flex-col gap-3 min-w-[min(260px,100%)] flex-1">
          <span className="text-caption font-semibold text-[var(--color-text-on-dark-muted)] uppercase tracking-[0.06em]">Gross to net</span>
          {st.grossToNet.map(l => {
            const strong = l.type === 'net';
            return (
              <div key={l.label} className="flex justify-between gap-3.5 pb-2 [border-bottom:1px_solid_var(--color-charcoal)]">
                <span className={cx('text-copy', strong ? 'text-white font-semibold' : 'text-[var(--color-text-on-dark)] font-normal')}>
                  {l.label}
                  {l.reference && <span className="text-[var(--color-text-on-dark-muted)]"> · {l.reference}</span>}
                </span>
                <MoneyText sen={l.amount} mode="exact" className={cx('text-copy', strong ? 'font-semibold text-gold' : 'font-medium text-white')} />
              </div>
            );
          })}
          <span className="text-meta text-[var(--color-text-on-dark-muted)] text-pretty">Gross booking value is the total before documented fees and expenses.</span>
          <Button variant="brand" size="md" className="self-start mt-1" style={{ color: 'var(--color-gold)' }}
            icon={<Icon name="Download" size="sm" />} onClick={() => downloadStatement(st.statementId)}>
            Download statement
          </Button>
        </div>
      </section>

      {/* Report drill-down — combined statement → per-unit → per-line */}
      {st.statementId && <StatementBreakdown statementId={st.statementId} />}

      {/* Performance stats */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {statsCards.map(s => (
          <div key={s.label} className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-1">
            <span className="text-meta text-muted-ink">{s.label}</span>
            <span className="text-headline font-semibold tabular-nums">{s.value}</span>
            <span className="text-meta text-muted-ink">{s.note}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        {/* Earnings trend — inline SVG */}
        <section className="bg-card border border-solid border-line rounded-card p-5 flex flex-col gap-1.5">
          <span className="text-heading font-semibold">Earnings over time</span>
          <span className="text-meta text-muted-ink">
            Net payout, RM · last {trend.data?.months ?? points.length} months · {trend.data?.unitLabel ?? st.unitsLabel}
          </span>
          {points.length ? <TrendChart points={points} /> : (
            <EmptyState bare icon="ChartLine" title="No earnings yet" body="Earnings appear after your first statement." />
          )}
        </section>

        {/* Property health */}
        <section className="bg-card border border-solid border-line rounded-card overflow-hidden flex flex-col">
          <div className="px-5 py-[18px] text-heading font-semibold [border-bottom:1px_solid_var(--color-line-soft)]">Property health</div>
          {rows.length === 0 && <EmptyState bare icon="Wrench" title="No maintenance on your property" body="Repairs and quotes that need your approval appear here." />}
          {rows.map(i => {
            const v = TASK[i.state];
            const waiting = i.state === 'waiting' && i.quotedAmount != null;
            return (
              <div key={i.id} className="px-5 py-3 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge label={v.label} tone={v.tone} size="sm" />
                  <span className="text-copy font-medium">{i.title}</span>
                </div>
                <span className="text-meta text-muted-ink text-pretty">{issueLine(i, multiUnit)}</span>
                {waiting && (
                  <Button variant="brand" size="md" className="self-start mt-1" onClick={() => setApprove(i)}>
                    Approve quote
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {/* Documents */}
      <section className="bg-card border border-solid border-line rounded-card overflow-hidden">
        <div className="px-5 py-[18px] text-heading font-semibold [border-bottom:1px_solid_var(--color-line-soft)]">Documents</div>
        {documents.length === 0 && <EmptyState bare icon="FileText" title="No documents yet" body="Your statements and contract will appear here." />}
        {documents.map(d => (
          <div key={d.id} className="px-5 py-3 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center gap-3.5">
            <span className="w-[34px] h-[34px] flex-none grid place-items-center rounded-control bg-muted text-[var(--color-ink-2)]">
              <Icon name={DOC_ICON[d.type]} size="sm" />
            </span>
            <div className="flex flex-col gap-px min-w-0 flex-1">
              <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis">{d.title}</span>
              <span className="text-meta text-muted-ink">{d.meta}</span>
            </div>
            <Button size="md" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={() => downloadDoc(d)}>Download</Button>
          </div>
        ))}
      </section>

      <Dialog
        busy={false}
        onClose={() => setApprove(null)}
        spec={!approve ? null : {
          title: `Approve ${moneyString(approve.quotedAmount ?? 0, 'exact')} for ${approve.title.toLowerCase()}?`,
          body: 'The Conts will schedule the work and deduct the amount from your next statement.',
          meta: [`Quoted ${date(approve.reportedAt)}`, approve.vendorName && `by ${approve.vendorName}`, approve.unitLabel].filter(Boolean).join(' · '),
          confirmLabel: 'Approve quote', busyLabel: 'Approving…', onConfirm: doApprove,
        }}
      />
    </div>
  );
}

/**
 * Report drill-down. The owner sees the combined net at the top (the hero), then can
 * drill into each unit and, within a unit, into every gross / fee / expense / adjustment
 * line. Single-unit owners see their one unit expanded; multi-unit owners tap a unit to
 * open it. A vertical stack, so it reads the same on a phone as on the desktop.
 */
function StatementBreakdown({ statementId }: { statementId: string }) {
  const { data } = useApi<StatementDetail>(`/owner/statements/${encodeURIComponent(statementId)}`, BREAKDOWN);
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  if (!data || data.units.length === 0) return null;
  const multi = data.units.length > 1;

  return (
    <section className="bg-card border border-solid border-line rounded-card overflow-hidden">
      <div className="px-5 py-[18px] flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
        <span className="text-heading font-semibold">Statement breakdown</span>
        <span className="text-meta text-muted-ink">
          {monthLabel(data.period)} · {multi ? `${plural(data.units.length, 'unit')} · tap a unit to open` : data.unitsLabel}
        </span>
      </div>

      {data.units.map(u => {
        const open = multi ? openUnit === u.id : true;
        const shortLabel = u.label.split(' ').pop() ?? u.label;
        return (
          <div key={u.id} className="[border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
            {multi && (
              <button
                onClick={() => setOpenUnit(o => (o === u.id ? null : u.id))}
                aria-expanded={open}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 px-5 py-3.5 bg-transparent border-none cursor-pointer text-left font-sans text-ink"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size="sm" color="var(--color-muted-ink)" />
                  <span className="text-copy font-medium whitespace-nowrap overflow-hidden text-ellipsis">{u.label}</span>
                </span>
                <MoneyText sen={u.net} mode="exact" strong className="text-copy" />
              </button>
            )}

            {open && (
              <div className={multi ? 'px-5 pb-4 pt-0' : 'px-5 py-4'}>
                {!multi && <div className="text-copy font-medium mb-2.5">{u.label}</div>}
                <div className="flex flex-col">
                  {u.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2 [border-bottom:1px_solid_var(--color-line-soft)]">
                      <span className="text-copy text-muted-ink text-pretty">
                        {l.label}
                        {l.reference && <span className="text-faint"> · {l.reference}</span>}
                      </span>
                      <MoneyText sen={l.amount} mode="exact" className={cx('text-copy', l.type === 'gross' ? 'text-ink font-medium' : 'text-muted-ink')} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3 pt-3">
                    <span className="text-copy font-semibold">Net payout · {shortLabel}</span>
                    <MoneyText sen={u.net} mode="exact" strong className="text-copy text-gold-ink" />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Owner-safe, factual language only — no internal shorthand (guide 15.2). */
function issueLine(i: HealthIssue, showUnit: boolean): string {
  const where = showUnit ? `${i.unitLabel}. ` : '';
  if (i.state === 'waiting') {
    return `${where}Quoted ${i.quotedAmount != null ? moneyString(i.quotedAmount, 'exact') : ''}${i.vendorName ? ` by ${i.vendorName}` : ''} on ${date(i.reportedAt)}. Your approval is needed.`;
  }
  if (i.state === 'resolved') {
    const cost = i.chargeTo === 'owner' && i.finalAmount
      ? ` ${moneyString(i.finalAmount, 'exact')} on your statement.`
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
  const desc = points.map(p => `${monthLabel(p.period)} ${moneyString(p.netPayout, 'whole')}`).join(', ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block mt-1.5 h-auto" role="img" aria-label={`Net payout by month: ${desc}`}>
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
      <text x={lastX} y={Math.max(14, lastY - 12)} textAnchor="end" fontSize="12" fontWeight="600" fill={color.goldInk}>{moneyString(last.netPayout, 'whole')}</text>
      {points.map((p, i) => (
        <text key={p.period} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill={color.textMuted}>{monthLabel(p.period)}</text>
      ))}
    </svg>
  );
}
