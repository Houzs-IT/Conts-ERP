import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, errorMessage } from '../lib/api';
import { rm, date, monthLabel } from '../lib/format';
import type { StatementState } from '../lib/types';
import { RecordHistory } from '../components/RecordHistory';
import { StatRow, StatTile } from '../components/Metric';

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
      toast({ tone: 'success', title: kind === 'finalise' ? 'Statement marked final.' : kind === 'send' ? 'Statement sent to the owner.' : 'Marked as paid.' });
      reload();
    } catch (e) {
      toast({ tone: 'critical', title: 'That did not go through.', body: errorMessage(e, 'Try again in a moment.') });
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

  const next = s.state === 'provisional' ? { label: 'Mark final', run: () => act('finalise') }
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
            <StatusBadge entity="statement" value={s.state} />
            <Button size="sm" variant="secondary" icon={<Icon name="ArrowLeft" size="sm" />} onClick={() => navigate('/finance/statements')}>Statements</Button>
            {s.units.length > 0 && (
              <Button size="sm" variant="secondary" icon={<Icon name="FileText" size="sm" />} onClick={() => { window.location.hash = reportHref().slice(1); }}>Owner Income Report</Button>
            )}
            {next && <Button size="sm" variant="primary" loading={busy} onClick={next.run}>{next.label}</Button>}
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <StatRow cols={5}>
        <StatTile className="col-span-2 xl:col-span-1" label="Net Payout to Owner" value={rm(s.totals.netPayout)} hero />
        <StatTile label="Hospitality Income" value={rm(s.totals.grossIncome)} />
        <StatTile label="Expense Deduction" value={signed(-s.totals.deductions)} />
        <StatTile label="Operator share" value={signed(-s.totals.operatorShare)} />
        <StatTile label="Owner Adjustments" value={signed(s.totals.adjustments)} />
      </StatRow>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-1 -mt-1 text-meta text-muted-ink">
        <span>Generated {date(s.generatedAt)}</span>
        {s.finalisedAt && <span>Marked final {date(s.finalisedAt)}</span>}
        {s.sentAt && <span>Sent {date(s.sentAt)}</span>}
        {s.payout && <span>Owner payout {s.payout.state}{s.payout.paidAt ? ` ${date(s.payout.paidAt)}` : ''}{s.payout.failureReason ? ` · ${s.payout.failureReason}` : ''}</span>}
        {s.owner.bankLast4 && <span>{s.owner.bankName ?? 'Bank'} ending {s.owner.bankLast4}</span>}
      </div>

      {warnings.length > 0 && s.state === 'provisional' && (
        <div role="status" className="rounded-card border border-solid border-warning-line bg-card px-5 py-4 text-copy">
          <div className="text-[16px] font-semibold tracking-[-0.01em] mb-2">Check before marking final</div>
          <ul className="m-0 pl-[18px] flex flex-col gap-1 text-muted-ink">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {s.units.length === 0 && (
        <div><Card><div className="px-5 py-4 text-copy text-muted-ink">
          {s.source === 'owner_workbook' ? 'This month was paid from the owner workbook before Property OS. The workbook gives the payout, not every line behind it.' : 'No unit figures on this statement.'}
        </div><LineList id="all" lines={s.lines} /></Card></div>
      )}

      {s.units.map(u => (
        <div key={u.unitId}>
          <Card>
            <div className="flex items-start justify-between gap-3 flex-wrap px-5 pt-5 pb-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-[16px] font-semibold tracking-[-0.01em]">{u.label}</span>
                <span className="text-[12px] text-muted-ink">
                  {u.code} · {u.basis === 'fixed_rent' ? 'Fixed monthly rent' : `Owner ${pct(u.ownerPct ?? 0)} · operator ${pct(100 - (u.ownerPct ?? 0))}`}
                  {u.package ? ` · ${u.package}` : ''}{u.termsSource !== 'contract' ? ` · split from the ${u.termsSource === 'unit' ? "unit's own record" : 'default fee'}` : ''}
                </span>
              </div>
              <a href={reportHref(u.unitId)} className="text-[12.5px] font-medium text-ink underline underline-offset-2">Report for this unit</a>
            </div>
            <div className="px-5 py-3 text-copy">
              {u.basis === 'share' ? (
                <>
                  <Row label={`Hospitality Income · ${u.nights} of ${u.days} nights (${(u.nights / u.days * 100).toFixed(2)}%)`} value={rm(u.grossIncome)} />
                  {Object.entries(groupDeductions(s.lines, u.unitId)).map(([k, v]) => <Row key={k} label={`${DEDUCTION_LABEL[k] ?? k}${v.n > 1 ? ` · ${v.n}` : ''}`} value={signed(-v.amount)} muted />)}
                  <Row label="Net Income" value={rm(u.netIncome)} line />
                  <Row label={`${pct(100 - (u.ownerPct ?? 0))} To Operator`} value={signed(-u.operatorShare)} muted />
                  {u.topUp > 0 && <Row label={`Minimum guarantee top-up (guaranteed ${rm(u.guarantee)})`} value={rm(u.topUp)} muted />}
                </>
              ) : <Row label="Fixed monthly rent" value={rm(u.fixedRent)} />}
              <Row label="Payout before Owner Adjustments" value={rm(u.payoutBeforeAdjustments)} line strong />
              {s.lines.filter(l => l.unitId === u.unitId && l.type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category ?? '')).map(l =>
                <Row key={l.id} label={l.description} value={signed(l.amount)} muted />)}
              <Row label="Net Payout to Owner" value={rm(u.netPayout)} line strong />
            </div>
            <LineList id={u.unitId} lines={s.lines.filter(l => l.unitId === u.unitId)} />
          </Card>
        </div>
      ))}

      <div>
        <RecordHistory entity="owner_statements" id={s.id ?? id} also={s.payout ? [['payouts', s.payout.id]] : undefined} refreshKey={s} />
      </div>

      <ConfirmDialog
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
          danger: true, confirmLabel: 'Mark paid', busyLabel: 'Saving...', onConfirm: () => act('paid'),
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

function Row({ label, value, muted, strong, line }: { label: string; value: string; muted?: boolean; strong?: boolean; line?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-[5px] ${line ? '[border-top:1px_solid_var(--color-line-soft)] mt-[4px] pt-[8px]' : ''}`}>
      <span className={`min-w-0 ${muted ? 'text-muted-ink pl-3' : ''} ${strong ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

const qtyText = (l: Line) => (l.quantity === null ? '' : l.type === 'gross' ? `${l.quantity} n` : l.category === 'misc' ? `${(l.quantity * 100).toFixed(2)}%` : String(l.quantity));

/** Every line behind the figures, folded away until asked for. A booking line links to the booking; an expense to Expenses.
 *  `id` keeps each unit's table apart in the URL (sort and filters), since a statement shows one per unit. */
function LineList({ id, lines }: { id: string; lines: Line[] }) {
  const [open, setOpen] = useState(false);
  const columns = useMemo<Column<Line>[]>(() => [
    { key: 'date', label: 'Date', type: 'date', value: l => l.occurredOn, width: 120 },
    { key: 'line', label: 'Line', value: l => l.description, text: l => (l.reference && !l.booking ? `${l.description} · ${l.reference}` : l.description), hideable: false, width: 300,
      render: l => (
        <span className="block truncate" title={l.description}>
          {l.booking?.ref ? <a href={`#/reservations/bookings?q=${encodeURIComponent(l.booking.ref)}`} className="text-ink underline underline-offset-2">{l.description}</a>
            : l.expenseId ? <a href="#/finance/expenses" className="text-ink underline underline-offset-2">{l.description}</a>
            : l.description}
          {l.reference && !l.booking && <span className="text-muted-ink"> · {l.reference}</span>}
        </span>
      ) },
    { key: 'unit', label: 'Unit', value: l => l.unitLabel, hidden: true, width: 160 },
    { key: 'qty', label: 'Qty', value: l => qtyText(l), align: 'right', width: 80, filter: false,
      render: l => <span className="tabular-nums text-muted-ink">{qtyText(l)}</span> },
    { key: 'amount', label: 'Amount', type: 'money', value: l => l.amount, width: 130,
      render: l => <span className="tabular-nums whitespace-nowrap">{signed(l.amount)}</span> },
  ], []);
  if (!lines.length) return null;
  return (
    <div className="[border-top:1px_solid_var(--color-line-soft)]">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-3 bg-card hover:bg-page text-meta font-medium text-ink border-none cursor-pointer [font-family:inherit] text-left">
        <span>{open ? 'Hide' : 'Show'} the {lines.length} {lines.length === 1 ? 'line' : 'lines'} behind these figures</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" />
      </button>
      {open && (
        <DataTable<Line>
          id="statement.lines" urlPrefix={`l${id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}.`} columns={columns} rows={lines} rowKey={l => l.id}
          pageSize={0} bare noViews noun={['line', 'lines']} exportName="statement-lines" maxHeight="480px"
        />
      )}
    </div>
  );
}
