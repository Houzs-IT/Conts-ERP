import { useEffect, useRef, useState, type ReactNode } from 'react';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Field } from '../../components/Field';
import { MoneyInput } from '../../components/inputs';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { MoneyText, moneyString } from '../../components/MoneyText';
import { StatusBadge } from '../../components/StatusBadge';
import { Segmented } from '../../components/Metric';
import { useApi } from '../../lib/useApi';
import { useToast } from '../../components/Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { refreshNavCounts } from '../../lib/navBadges';
import { rm, monthLabel, titleCase, date as fmtDate, masked } from '../../lib/format';
import { bankName } from '../../lib/vocabulary';
import { statusOf } from '../../lib/status';
import type { PayoutState, StatementState } from '../../lib/types';
import { Section } from './shared';
import { Link } from 'react-router-dom';

/**
 * Owner statements and owner payouts on the owner (owner, 11 Oct 2026: "owner payout is basically the same as owner;
 * I set it on the owner"). The owner's page takes each step of the month's statement and pays the owner from here;
 * the Owners list's Statements and Payouts tabs do the same for every owner in a month at once.
 */

/** A month-level screen's header: its own page header, or, as a tab of the Owners list (`embedded`), one bar with the
 *  same summary and buttons under the Owners title. */
export function SectionHead({ embedded, title, sub, right, primary }: { embedded: boolean; title: string; sub?: ReactNode; right?: ReactNode; primary?: ReactNode }) {
  if (!embedded) return <PageHeader title={title} sub={sub} right={right} primary={primary} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-copy text-muted-ink min-w-0">{sub}</span>
      <span className="flex flex-wrap items-center gap-[9px]">{right}{primary}</span>
    </div>
  );
}

/* ---------- owner payouts ---------- */

export interface PayoutRow {
  id: string; ref?: string; statementId?: string | null; period?: string | null; ownerName: string; amount: number; state: PayoutState; method: string;
  bankName: string | null; bankLast4: string | null; paidAt: string | null; failureReason: string | null;
}

/** Bank never shows more than the tail; the raw number needs an audited reveal on the owner profile. */
export const payoutDestination = (p: PayoutRow) => p.bankLast4 ? `${bankName(p.bankName) ?? 'Bank'} ${masked(p.bankLast4)}` : (bankName(p.bankName) ?? 'No bank account');
/** One status, the paid date folded in when there is one (owner, 11 Oct 2026: "paid date is not needed; simply merge
 *  it"). 531 of 536 imported payouts have no date, so a separate date column mostly said "Date not recorded". */
export const payoutStatus = (p: PayoutRow) =>
  p.state === 'paid' ? (p.paidAt ? `Paid · ${fmtDate(p.paidAt)}` : 'Paid')
    : p.state === 'processing' ? 'Transfer in progress'
    : p.state === 'failed' ? 'Failed'
    : 'Not paid yet';
export const PayoutBadge = ({ p, size }: { p: PayoutRow; size?: 'sm' | 'md' }) => (
  <StatusBadge label={payoutStatus(p)} tone={statusOf('payout', p.state).tone} size={size} />
);

/** This owner's payouts, newest month first, with the same two steps the Payouts tab has: mark a transfer in
 *  progress as paid, or move a failed one back to processing once the bank details are fixed. */
export function OwnerPayouts({ ownerId, onChanged }: { ownerId: string; onChanged?: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ data: PayoutRow[]; total?: number }>(`/payouts?ownerId=${encodeURIComponent(ownerId)}&pageSize=24`);
  const [confirm, setConfirm] = useState<{ p: PayoutRow; kind: 'paid' | 'retry' } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = [...(data?.data ?? [])].sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''));

  async function move(p: PayoutRow, kind: 'paid' | 'retry') {
    setBusy(true);
    try {
      await api.patch('/payouts', { id: p.id, state: kind === 'paid' ? 'paid' : 'processing' });
      setConfirm(null);
      reload(); onChanged?.(); void refreshNavCounts();
      toast(kind === 'paid'
        ? { tone: 'success', title: 'Recorded as paid.', body: `${moneyString(p.amount, 'exact')} recorded as transferred.` }
        : { tone: 'success', title: 'Payout back to processing.', body: 'Make the transfer at the bank, then mark it paid.' });
    } catch (e) {
      toast({ tone: 'critical', title: 'Payout was not updated.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const spec: ConfirmSpec | null = !confirm ? null : confirm.kind === 'paid' ? {
    title: `Mark ${moneyString(confirm.p.amount, 'exact')} as paid?`,
    body: 'Only once the bank confirms the transfer left the account. The owner statement moves to Paid and the owner is told by email.',
    meta: `${payoutDestination(confirm.p)} · ${confirm.p.method}`,
    danger: true, confirmLabel: 'Mark paid', busyLabel: 'Saving...', onConfirm: () => move(confirm.p, 'paid'),
  } : {
    title: `Try ${moneyString(confirm.p.amount, 'exact')} again?`,
    body: 'Confirm the bank details were corrected first. This moves the payout back to Processing; it does not send money.',
    meta: `${payoutDestination(confirm.p)} · ${confirm.p.method}`,
    danger: true, confirmLabel: 'Move to processing', busyLabel: 'Saving...', onConfirm: () => move(confirm.p, 'retry'),
  };

  return (
    <Section title="Owner payouts" action={<Link to="/owners?view=payouts" className="text-meta text-gold-ink no-underline font-medium">All owners</Link>}>
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {error && !data ? <div className="p-4 text-copy text-critical">{error}</div>
          : loading && !data ? <div className="p-4"><div className="skeleton h-12" /></div>
          : rows.length === 0 ? <div className="p-4 text-copy text-muted-ink">No owner payouts yet. One is made for each owner statement when it is sent.</div>
          : rows.map(p => (
            <div key={p.id} className="flex items-center gap-3 flex-wrap px-4 py-3 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-copy font-medium">{p.period ? monthLabel(p.period) : (p.ref ?? 'Owner payout')}</span>
                <span className="text-meta text-muted-ink truncate">{payoutDestination(p)} · {p.method}{p.state === 'failed' && p.failureReason ? ` · ${p.failureReason}` : ''}</span>
              </span>
              <MoneyText sen={p.amount} mode="exact" strong className="text-copy" />
              <PayoutBadge p={p} size="sm" />
              {p.state === 'processing' && <Button size="sm" variant="secondary" onClick={() => setConfirm({ p, kind: 'paid' })}>Mark paid</Button>}
              {p.state === 'failed' && <Button size="sm" variant="primary" onClick={() => setConfirm({ p, kind: 'retry' })}>Try again</Button>}
            </div>
          ))}
      </div>
      {rows.some(p => p.state === 'pending') && <span className="text-meta text-muted-ink">A payout waiting for a run starts from the Owners list's Payouts tab, with the month's other transfers.</span>}
      <ConfirmDialog spec={spec} busy={busy} onClose={() => { if (!busy) setConfirm(null); }} />
    </Section>
  );
}

/* ---------- the month's statement ---------- */

interface StepsDetail {
  id: string; period: string; state: StatementState;
  owner: { name: string };
  totals: { netPayout: number };
  payout: { id: string; state: string; amount: number } | null;
}

/** The next step the month's owner statement allows, on the owner's page: mark final, send to the owner, mark the
 *  owner payout paid; an adjustment line while it can still change; and the full statement. Same calls as the
 *  statement screen and the Statements tab. */
export function StatementSteps({ statementId, unitsLabel, onChanged }: { statementId: string; unitsLabel: string; onChanged: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ data: StepsDetail }>(`/statements/${encodeURIComponent(statementId)}`);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'send' | 'paid' | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const s = data?.data;
  if (!s) return null;

  const done = () => { reload(); onChanged(); void refreshNavCounts(); };
  async function act(kind: 'finalise' | 'send' | 'paid') {
    if (!s) return;
    setBusy(true);
    try {
      if (kind === 'finalise') await api.post('/statements/finalise', { statementIds: [s.id] });
      if (kind === 'send') await api.post('/statements/send', { statementIds: [s.id] });
      if (kind === 'paid' && s.payout) await api.patch('/payouts', { id: s.payout.id, state: 'paid' });
      toast({ tone: 'success', title: kind === 'finalise' ? 'Statement marked final.' : kind === 'send' ? 'Statement sent to the owner.' : 'Marked as paid.' });
      done();
    } catch (e) {
      toast({ tone: 'critical', title: 'That did not go through.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); setConfirm(null); }
  }
  async function adjust(label: string, amountSen: number) {
    if (!s) return;
    setBusy(true);
    try {
      const res = await api.post<{ netPayout: number }>(`/statements/${encodeURIComponent(s.id)}/adjust`, { label, amount: amountSen });
      setAdjusting(false);
      done();
      toast({ tone: 'success', title: 'Adjustment recorded.', body: `Net Payout to Owner is now ${rm(res.netPayout)}.` });
    } catch (e) {
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'This statement is locked.' : 'Adjustment was not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const editable = s.state === 'provisional' || s.state === 'finalised';
  const unpaid = s.state === 'sent' && s.payout && s.payout.state !== 'paid';
  return (
    <>
      {s.state === 'provisional' && <Button size="sm" variant="secondary" loading={busy && !confirm} onClick={() => void act('finalise')}>Mark final</Button>}
      {s.state === 'finalised' && <Button size="sm" variant="secondary" icon={<Icon name="Send" size="sm" />} onClick={() => setConfirm('send')}>Send to owner</Button>}
      {unpaid && <Button size="sm" variant="secondary" icon={<Icon name="CheckCircle2" size="sm" />} onClick={() => setConfirm('paid')}>Mark paid</Button>}
      {editable && <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setAdjusting(true)}>Add adjustment</Button>}
      {adjusting && (
        <AdjustDialog target={{ ownerName: s.owner.name, unitsLabel, netPayout: s.totals.netPayout }} busy={busy}
          onClose={() => { if (!busy) setAdjusting(false); }} onSubmit={(label, sen) => void adjust(label, sen)} />
      )}
      <ConfirmDialog busy={busy} onClose={() => { if (!busy) setConfirm(null); }}
        spec={!confirm ? null : confirm === 'send' ? {
          title: 'Send this statement to the owner?',
          body: 'The owner is emailed and sees it on the portal. A sent statement cannot be edited.',
          meta: `${rm(s.totals.netPayout)} Net Payout to Owner · ${titleCase(s.owner.name)} · ${monthLabel(s.period)}`,
          confirmLabel: 'Send', busyLabel: 'Sending...', onConfirm: () => act('send'),
        } : {
          title: 'Mark this owner payout as paid?',
          body: 'Record that the money has reached the owner. The statement becomes Paid.',
          meta: `${rm(s.payout?.amount ?? 0)} · ${titleCase(s.owner.name)} · ${monthLabel(s.period)}`,
          danger: true, confirmLabel: 'Mark paid', busyLabel: 'Saving...', onConfirm: () => act('paid'),
        }} />
    </>
  );
}

/** Records a manual +/- line on one statement. The net moves by exactly the amount; gross, fee and expenses stay as
 *  generated. Used by the Statements tab and the owner's page. */
export function AdjustDialog({ target, busy, onClose, onSubmit }: {
  target: { ownerName: string; unitsLabel: string; netPayout: number }; busy: boolean; onClose: () => void; onSubmit: (label: string, amountSen: number) => void;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<'deduct' | 'add'>('deduct');
  const ref = useRef<HTMLDivElement>(null);

  const sen = (amount ?? 0) * (direction === 'deduct' ? -1 : 1);
  const valid = label.trim() !== '' && sen !== 0;
  const preview = valid ? target.netPayout + sen : target.netPayout;

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Adjust statement"
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <form onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit(label.trim(), sen); }}>
          <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-3">
            <h2 className="m-0 text-title font-semibold">Adjust statement</h2>
            <p className="m-0 text-[13px] leading-[1.55] text-muted-ink">
              {target.ownerName} · {target.unitsLabel}. Adds a labelled line to the statement and rebalances the net payout. The gross, fee and expenses are unchanged.
            </p>
            <Field label="What is this adjustment for?" placeholder="e.g. Goodwill credit, prior-month correction" value={label} onChange={e => setLabel(e.target.value)} />
            <div className="flex flex-col gap-[7px]">
              <span className="text-[12px] font-medium text-muted-ink" aria-hidden>Direction</span>
              <Segmented<'deduct' | 'add'> label="Direction" value={direction} onChange={setDirection} className="self-start"
                options={[{ key: 'deduct', label: 'Deduct from payout' }, { key: 'add', label: 'Add to payout' }]} />
            </div>
            <MoneyInput label="Amount (RM)" placeholder="e.g. 150.00" valueSen={amount} onChangeSen={setAmount} />
            <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-[12px] flex items-center justify-between">
              <span className="text-muted-ink">Net Payout to Owner after adjustment</span>
              <span className="font-semibold tabular-nums">{rm(preview)}</span>
            </div>
          </div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
            <Button size="sm" variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!valid} disabledReason="Add a description and a non-zero amount.">
              Record adjustment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
