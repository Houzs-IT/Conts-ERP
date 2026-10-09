import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { rm, date, monthLabel } from '../lib/format';
import { STATEMENT } from '../lib/vocabulary';
import type { StatementState } from '../lib/types';

/** `#/finance/statements/:id` — one owner's statement on screen: each unit's month the way the Owner Income
 *  Report prints it (income, deductions, split, owner adjustments, payout), every line behind it with a link to
 *  its booking or expense, what to check before finalising, and the next step the statement's state allows. */

interface UnitFigures {
  unitId: string; label: string; code: string; package: string | null; basis: 'share' | 'fixed_rent'; termsSource: 'contract' | 'unit' | 'default';
  nights: number; days: number; grossIncome: number; deductions: number; netIncome: number; ownerPct: number | null; operatorShare: number;
  guarantee: number; topUp: number; fixedRent: number; payoutBeforeAdjustments: number; adjustments: number; netPayout: number; warnings: string[];
}
interface Line {
  id: string; unitId: string | null; unitLabel: string | null; type: 'gross' | 'expense' | 'management_fee' | 'adjustment'; category: string | null;
  description: string; occurredOn: string; amount: number; quantity: number | null; reference: string | null;
  reservationId: string | null; expenseId: string | null; adjustmentId: string | null;
  booking: { checkIn: string; checkOut: string; channel: string; ref: string | null } | null;
}
interface Detail {
  id: string; period: string; periodStart: string; periodEnd: string; state: StatementState; source: 'generated' | 'owner_workbook';
  generatedAt: string; finalisedAt: string | null; sentAt: string | null;
  owner: { id: string; name: string; email: string | null; phone: string | null; bankName: string | null; bankLast4: string | null };
  totals: { grossIncome: number; operatorShare: number; deductions: number; adjustments: number; netPayout: number };
  payout: { id: string; state: string; amount: number; paidAt: string | null; failureReason: string | null } | null;
  units: UnitFigures[]; lines: Line[];
}

const DEDUCTION_LABEL: Record<string, string> = {
  cleaning_basic: 'Basic cleaning', cleaning_deep: 'Deep cleaning', electricity: 'Electricity', water: 'Water', internet: 'Wi-Fi',
  sewerage: 'Indah Water', additional: 'Additional deduction', misc: 'Miscellaneous charges',
};
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const signed = (sen: number) => (sen < 0 ? `(${rm(-sen)})` : rm(Math.abs(sen)));

export default function StatementDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ data: Detail }>(`/statements/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'send' | 'paid' | null>(null);
  const s = data?.data;

  async function act(kind: 'finalise' | 'send' | 'paid') {
    if (!s) return;
    setBusy(true);
    try {
      if (kind === 'finalise') await api.post('/statements/finalise', { statementIds: [s.id] });
      if (kind === 'send') await api.post('/statements/send', { statementIds: [s.id] });
      if (kind === 'paid' && s.payout) await api.patch('/payouts', { id: s.payout.id, state: 'paid' });
      toast({ tone: 'success', title: kind === 'finalise' ? 'Statement finalised.' : kind === 'send' ? 'Statement sent to the owner.' : 'Marked as paid.' });
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'That did not go through.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); setConfirm(null); }
  }

  if (!s) {
    return (
      <>
        <PageHeader title="Owner statement" sub={loading ? 'Loading...' : ''} />
        {error ? <EmptyState title="This statement could not be opened." body={error} action={{ label: 'Back to statements', onClick: () => navigate('/finance/statements') }} />
          : <Card><TableSkeleton rows={8} cols={4} /></Card>}
      </>
    );
  }

  const next = s.state === 'provisional' ? { label: 'Finalise', run: () => act('finalise') }
    : s.state === 'finalised' ? { label: 'Send to owner', run: () => setConfirm('send') }
    : s.state === 'sent' && s.payout && s.payout.state !== 'paid' ? { label: 'Mark paid', run: () => setConfirm('paid') }
    : null;
  const warnings = s.units.flatMap(u => u.warnings.map(w => `${u.label}: ${w}`));
  const reportHref = (unitId?: string) => `#/finance/statements/${encodeURIComponent(s.id)}/report${unitId ? `?unit=${encodeURIComponent(unitId)}` : ''}`;

  return (
    <>
      <PageHeader
        title={s.owner.name}
        sub={`Owner statement · ${monthLabel(s.period, { long: true })} · ${s.units.length || 'no'} ${s.units.length === 1 ? 'unit' : 'units'}${s.source === 'owner_workbook' ? ' · from the owner workbook' : ''}`}
        right={
          <div className="flex gap-[9px] flex-wrap items-center">
            <Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} />
            <Button size="sm" variant="secondary" icon={<Icon name="ArrowLeft" size="sm" />} onClick={() => navigate('/finance/statements')}>Statements</Button>
            {s.units.length > 0 && (
              <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />} onClick={() => { window.location.hash = reportHref().slice(1); }}>Owner Income Report</Button>
            )}
            {next && <Button size="sm" variant="primary" loading={busy} onClick={next.run}>{next.label}</Button>}
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-[18px] gap-y-[14px] px-[22px] py-[18px]">
          <Figure label="Hospitality income" value={rm(s.totals.grossIncome)} />
          <Figure label="Expense deduction" value={signed(-s.totals.deductions)} />
          <Figure label="To operator" value={signed(-s.totals.operatorShare)} />
          <Figure label="Adjustments" value={signed(s.totals.adjustments)} />
          <Figure label="Net payout to owner" value={rm(s.totals.netPayout)} strong />
        </div>
        <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-[22px] py-[10px] [border-top:1px_solid_var(--color-line)] bg-page text-[12px] text-muted-ink">
          <span>Generated {date(s.generatedAt)}</span>
          {s.finalisedAt && <span>Finalised {date(s.finalisedAt)}</span>}
          {s.sentAt && <span>Sent {date(s.sentAt)}</span>}
          {s.payout && <span>Payout {s.payout.state}{s.payout.paidAt ? ` ${date(s.payout.paidAt)}` : ''}{s.payout.failureReason ? ` · ${s.payout.failureReason}` : ''}</span>}
          {s.owner.bankLast4 && <span>{s.owner.bankName ?? 'Bank'} ending {s.owner.bankLast4}</span>}
        </div>
      </Card>

      {warnings.length > 0 && s.state === 'provisional' && (
        <div role="status" className="mt-4 rounded-card border border-solid border-line bg-card px-[18px] py-[14px] text-[13px]">
          <div className="font-semibold mb-[6px]">Check before finalising</div>
          <ul className="m-0 pl-[18px] flex flex-col gap-1 text-muted-ink">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {s.units.length === 0 && (
        <div className="mt-4"><Card><div className="px-[22px] py-[18px] text-[13px] text-muted-ink">
          {s.source === 'owner_workbook' ? 'This month was paid from the owner workbook before Property OS. The workbook gives the payout, not every line behind it.' : 'No unit figures on this statement.'}
        </div><LineList lines={s.lines} /></Card></div>
      )}

      {s.units.map(u => (
        <div key={u.unitId} className="mt-4">
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap px-[22px] pt-[16px] pb-[12px] [border-bottom:1px_solid_var(--color-line)]">
              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-[15px] font-semibold">{u.label}</span>
                <span className="text-[12px] text-muted-ink">
                  {u.code} · {u.basis === 'fixed_rent' ? 'Fixed monthly rent' : `Owner ${pct(u.ownerPct ?? 0)} · operator ${pct(100 - (u.ownerPct ?? 0))}`}
                  {u.package ? ` · ${u.package}` : ''}{u.termsSource !== 'contract' ? ` · split from the ${u.termsSource === 'unit' ? "unit's own record" : 'default fee'}` : ''}
                </span>
              </div>
              <a href={reportHref(u.unitId)} className="text-[12.5px] font-medium text-ink underline underline-offset-2">Report for this unit</a>
            </div>
            <div className="px-[22px] py-[12px] text-[13px]">
              {u.basis === 'share' ? (
                <>
                  <Row label={`Hospitality income · ${u.nights} of ${u.days} nights (${(u.nights / u.days * 100).toFixed(2)}%)`} value={rm(u.grossIncome)} />
                  {Object.entries(groupDeductions(s.lines, u.unitId)).map(([k, v]) => <Row key={k} label={`${DEDUCTION_LABEL[k] ?? k}${v.n > 1 ? ` · ${v.n}` : ''}`} value={signed(-v.amount)} muted />)}
                  <Row label="Net income" value={rm(u.netIncome)} line />
                  <Row label={`${pct(100 - (u.ownerPct ?? 0))} to operator`} value={signed(-u.operatorShare)} muted />
                  {u.topUp > 0 && <Row label={`Minimum guarantee top-up (guaranteed ${rm(u.guarantee)})`} value={rm(u.topUp)} muted />}
                </>
              ) : <Row label="Fixed monthly rent" value={rm(u.fixedRent)} />}
              <Row label="Payout before owner adjustments" value={rm(u.payoutBeforeAdjustments)} line strong />
              {s.lines.filter(l => l.unitId === u.unitId && l.type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category ?? '')).map(l =>
                <Row key={l.id} label={l.description} value={signed(l.amount)} muted />)}
              <Row label="Net payout to owner" value={rm(u.netPayout)} line strong />
            </div>
            <LineList lines={s.lines.filter(l => l.unitId === u.unitId)} />
          </Card>
        </div>
      ))}

      <Dialog
        busy={busy}
        onClose={() => { if (!busy) setConfirm(null); }}
        spec={!confirm ? null : confirm === 'send' ? {
          title: 'Send this statement to the owner?',
          body: 'The owner is emailed and sees it on the portal. A sent statement cannot be edited.',
          meta: `${rm(s.totals.netPayout)} net payout · ${s.owner.name}`,
          confirmLabel: 'Send', busyLabel: 'Sending...', onConfirm: () => act('send'),
        } : {
          title: 'Mark this payout as paid?',
          body: 'Record that the money has reached the owner. The statement becomes Paid.',
          meta: `${rm(s.payout?.amount ?? 0)} · ${s.owner.name}`,
          confirmLabel: 'Mark paid', busyLabel: 'Saving...', onConfirm: () => act('paid'),
        }}
      />
    </>
  );
}

function groupDeductions(lines: Line[], unitId: string) {
  const out: Record<string, { n: number; amount: number }> = {};
  for (const l of lines) {
    if (l.unitId !== unitId || l.type !== 'expense') continue;
    const k = l.category ?? 'additional';
    out[k] = { n: (out[k]?.n ?? 0) + 1, amount: (out[k]?.amount ?? 0) - l.amount };
  }
  // In the order the report prints them.
  const order = Object.keys(DEDUCTION_LABEL);
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => rank(a) - rank(b)));
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px] min-w-0">
      <span className="text-[12px] text-muted-ink">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[18px] font-semibold' : 'text-[15px] font-medium'}`}>{value}</span>
    </div>
  );
}

function Row({ label, value, muted, strong, line }: { label: string; value: string; muted?: boolean; strong?: boolean; line?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-[5px] ${line ? '[border-top:1px_solid_var(--color-line-soft)] mt-[4px] pt-[8px]' : ''}`}>
      <span className={`min-w-0 ${muted ? 'text-muted-ink pl-3' : ''} ${strong ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

/** Every line behind the figures, folded away until asked for. A booking line links to the booking; an expense to Expenses. */
function LineList({ lines }: { lines: Line[] }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className="[border-top:1px_solid_var(--color-line)]">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-[22px] py-[10px] bg-page text-[12.5px] font-medium text-ink border-none cursor-pointer [font:inherit]">
        <span>{open ? 'Hide' : 'Show'} the {lines.length} {lines.length === 1 ? 'line' : 'lines'} behind these figures</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" />
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead><tr className="text-left text-muted-ink">
              <th className="font-medium px-[22px] py-[7px]">Date</th><th className="font-medium py-[7px]">Line</th><th className="font-medium py-[7px] text-right">Qty</th><th className="font-medium px-[22px] py-[7px] text-right">Amount</th>
            </tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="[border-top:1px_solid_var(--color-line-soft)] align-top">
                  <td className="px-[22px] py-[6px] whitespace-nowrap text-muted-ink">{l.occurredOn}</td>
                  <td className="py-[6px] pr-3">
                    {l.booking?.ref ? <a href={`#/reservations/bookings?q=${encodeURIComponent(l.booking.ref)}`} className="text-ink underline underline-offset-2">{l.description}</a>
                      : l.expenseId ? <a href="#/finance/expenses" className="text-ink underline underline-offset-2">{l.description}</a>
                      : l.description}
                    {l.reference && !l.booking && <span className="text-muted-ink"> · {l.reference}</span>}
                  </td>
                  <td className="py-[6px] text-right tabular-nums text-muted-ink">{l.quantity === null ? '' : l.type === 'gross' ? `${l.quantity} n` : l.category === 'misc' ? `${(l.quantity * 100).toFixed(2)}%` : l.quantity}</td>
                  <td className="px-[22px] py-[6px] text-right tabular-nums whitespace-nowrap">{signed(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
