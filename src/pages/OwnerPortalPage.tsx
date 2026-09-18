import { useState } from 'react';
import { color, radius, text } from '../theme';
import { useApi } from '../lib/useApi';
import { api, ApiFailure } from '../lib/api';
import { rm, rmDeduction, date, percent, rating } from '../lib/format';
import { TASK, PAYOUT } from '../lib/vocabulary';
import type { TaskState, PayoutState } from '../lib/types';
import { Badge } from '../components/Badge';
import { Dialog } from '../components/Dialog';
import { SkeletonRows } from '../components/States';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

interface Issue {
  id: string; title: string; detail: string | null; state: TaskState; vendorName: string | null;
  quotedAmount: number | null; finalAmount: number | null; chargeTo: string;
  reportedAt: string; resolvedAt: string | null; needsApproval: boolean;
  unitNumber: string; propertyName: string;
}
interface Payload {
  owner: { id: string; displayName: string };
  units: { id: string; unitNumber: string; propertyName: string }[];
  statement: null | { id: string; periodStart: string; periodEnd: string; state: string; netPayout: number; finalisedAt: string | null; lines: { label: string; amount: number }[] };
  payout: null | { state: PayoutState; amount: number; paidAt: string | null; bankName: string | null; bankLast4: string | null };
  stats: { periodStart: string; occupancy: number; nightsBooked: number; nightsAvailable: number; adr: number; bookings: number; channels: number; rating: number | null; reviews: number };
  earnings: { periodStart: string; netPayout: number }[];
  issues: Issue[];
}

const month = (iso: string, style: 'long' | 'short' = 'long') =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-MY', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}), timeZone: 'UTC' });

const card = { background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card } as const;

/** No fallback figures: an owner must never see placeholder money presented as theirs. */
export default function OwnerPortalPage() {
  const { data, loading, error, reload } = useApi<Payload>('/owner/portal');
  const [approve, setApprove] = useState<Issue | null>(null);
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (loading && !data) return <SkeletonRows rows={6} height={64} />;
  if (error || !data) {
    return (
      <div role="alert" style={{ ...card, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <strong>Your portal could not load.</strong>
        <span style={{ color: color.textMuted, fontSize: 13.5 }}>{error ?? 'Try again in a moment.'}</span>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  }

  const { statement: st, payout, stats, earnings, issues, units } = data;
  const peak = Math.max(1, ...earnings.map(e => e.netPayout));

  async function doApprove() {
    if (!approve) return;
    setBusy(true);
    try {
      await api.post('/maintenance/approve', { issueId: approve.id, approved: true, quotedAmount: approve.quotedAmount });
      toast({ tone: 'success', title: 'Quote approved.', body: 'The Conts will confirm the work date.' });
      setApprove(null);
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not approve.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
      if (e instanceof ApiFailure && e.code === 'QUOTE_CHANGED') { setApprove(null); reload(); }
    } finally { setBusy(false); }
  }

  const statsCards = [
    { label: 'Occupancy', value: percent(stats.occupancy), note: `${stats.nightsBooked} of ${stats.nightsAvailable} nights` },
    { label: 'Average nightly rate', value: stats.adr ? rm(stats.adr, { cents: false }) : '—', note: month(stats.periodStart) },
    { label: 'Bookings', value: String(stats.bookings), note: `${stats.channels} ${stats.channels === 1 ? 'channel' : 'channels'}` },
    { label: 'Rating', value: stats.rating != null ? rating(stats.rating) : '—', note: `${stats.reviews} ${stats.reviews === 1 ? 'review' : 'reviews'}, last 12 months` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: text.pageTitle, fontWeight: 600, letterSpacing: '-0.015em' }}>Your properties</h1>
        <span style={{ fontSize: 13.5, color: color.textMuted }}>
          {units.length ? units.map(u => `${u.propertyName} ${u.unitNumber}`).join(' · ') : 'No units are on your account yet.'}
        </span>
      </div>

      {st ? (
        <section style={{ background: color.black, color: '#FFFFFF', borderRadius: radius.card, padding: 28, display: 'flex', justifyContent: 'space-between', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontSize: 12, color: color.dim }}>Net payout &middot; {month(st.periodStart)}</span>
            <span style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em', color: color.gold }}>{rm(st.netPayout)}</span>
            {payout && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <Badge label={PAYOUT[payout.state].label} tone={PAYOUT[payout.state].tone} size="sm" />
                <span style={{ fontSize: 12, color: color.onDark }}>
                  {[payout.paidAt && date(payout.paidAt), payout.bankName, payout.bankLast4 && `••••${payout.bankLast4}`].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 240, flex: 1 }}>
            {[...st.lines, { label: 'Net payout', amount: st.netPayout, strong: true }].map((l: { label: string; amount: number; strong?: boolean }) => (
              <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, paddingBottom: 8, borderBottom: `1px solid ${color.charcoal}` }}>
                <span style={{ fontSize: 13, color: l.strong ? '#FFFFFF' : color.onDark, fontWeight: l.strong ? 600 : 400 }}>{l.label}</span>
                <span style={{ fontSize: 13, fontWeight: l.strong ? 600 : 500, color: l.strong ? color.gold : '#FFFFFF' }}>
                  {l.amount < 0 ? rmDeduction(l.amount) : rm(l.amount)}
                </span>
              </div>
            ))}
            <button onClick={() => setDownload(true)}
              style={{ alignSelf: 'flex-start', marginTop: 3, padding: '9px 14px', border: `1px solid ${color.gold}`, borderRadius: radius.control, background: 'transparent', font: 'inherit', fontSize: 13, fontWeight: 600, color: color.gold, cursor: 'pointer' }}>
              Download statement
            </button>
          </div>
        </section>
      ) : (
        <section style={{ ...card, padding: 24 }}>
          <strong>No statement yet.</strong>
          <div style={{ color: color.textMuted, fontSize: 13.5, marginTop: 6 }}>Your first monthly statement appears here once The Conts finalises it.</div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        {statsCards.map(s => (
          <div key={s.label} style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 600 }}>{s.value}</span>
            <span style={{ fontSize: 11.5, color: color.textMuted }}>{s.note}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span style={{ fontSize: text.cardTitle, fontWeight: 600 }}>Earnings</span>
          {earnings.length ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }} role="img"
              aria-label={earnings.map(e => `${month(e.periodStart)} ${rm(e.netPayout)}`).join(', ')}>
              {earnings.map((e, i) => (
                <div key={e.periodStart} title={`${month(e.periodStart)}: ${rm(e.netPayout)}`}
                  style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 6, height: '100%' }}>
                  <div style={{ width: '100%', borderRadius: '6px 6px 0 0', height: Math.max(2, Math.round((Math.max(0, e.netPayout) / peak) * 100)), background: i === earnings.length - 1 ? color.gold : color.charcoal }} />
                  <span style={{ fontSize: 11, color: color.textMuted }}>{month(e.periodStart, 'short')}</span>
                </div>
              ))}
            </div>
          ) : <span style={{ fontSize: 13, color: color.textMuted }}>Earnings appear after your first statement.</span>}
        </section>

        <section style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', fontSize: text.cardTitle, fontWeight: 600, borderBottom: `1px solid ${color.borderMuted}` }}>Property health</div>
          {issues.length === 0 && <div style={{ padding: '13px 20px', fontSize: 13, color: color.textMuted }}>No maintenance on your units.</div>}
          {issues.map(i => {
            const v = i.needsApproval ? TASK.waiting : TASK[i.state];
            return (
              <div key={i.id} style={{ padding: '13px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <Badge label={v.label} tone={v.tone} size="sm" />
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{i.title}</span>
                </div>
                <span style={{ fontSize: 11.5, color: color.textMuted }}>{issueLine(i, units.length > 1)}</span>
                {i.needsApproval && i.quotedAmount != null && (
                  <button onClick={() => setApprove(i)}
                    style={{ alignSelf: 'flex-start', marginTop: 2, padding: '7px 13px', border: `1px solid ${color.gold}`, borderRadius: radius.control, background: 'transparent', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: color.goldInk, cursor: 'pointer' }}>
                    Approve {rm(i.quotedAmount)}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <Dialog busy={busy} onClose={() => setApprove(null)} spec={!approve ? null : {
        title: `Approve ${rm(approve.quotedAmount ?? 0)} for ${approve.title.toLowerCase()}?`,
        body: 'The Conts schedules the work and deducts the amount from your next statement.',
        meta: [`Quoted ${date(approve.reportedAt)}`, approve.vendorName && `by ${approve.vendorName}`, `${approve.propertyName} ${approve.unitNumber}`].filter(Boolean).join(' · '),
        confirmLabel: 'Approve', busyLabel: 'Approving…', onConfirm: doApprove,
      }} />
      <Dialog busy={false} onClose={() => setDownload(false)} spec={!download || !st ? null : {
        title: `Download your ${month(st.periodStart)} statement?`,
        body: `Every booking, fee and expense behind your ${rm(st.netPayout)} payout. It opens in a new tab; use Print, then Save as PDF.`,
        meta: st.finalisedAt ? `Finalised ${date(st.finalisedAt)}` : undefined,
        confirmLabel: 'Download',
        onConfirm: () => { window.open(`/api/statements/pdf?id=${encodeURIComponent(st.id)}`, '_blank', 'noopener'); setDownload(false); },
      }} />
    </div>
  );
}

function issueLine(i: Issue, showUnit: boolean) {
  const where = showUnit ? `${i.propertyName} ${i.unitNumber}. ` : '';
  if (i.needsApproval) return `${where}Quoted ${i.quotedAmount != null ? rm(i.quotedAmount) : ''} on ${date(i.reportedAt)}${i.vendorName ? ` by ${i.vendorName}` : ''}. Your approval is needed.`;
  if (i.state === 'resolved') {
    const cost = i.chargeTo === 'owner' && i.finalAmount ? ` ${rm(i.finalAmount)} on your statement.` : i.chargeTo === 'warranty' ? ' Covered under warranty.' : '';
    return `${where}Completed ${date(i.resolvedAt ?? i.reportedAt)}.${cost}`;
  }
  return `${where}${i.detail ?? 'Reported'} ${date(i.reportedAt)}.`;
}
