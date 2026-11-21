// ----------------------------------------------------------------------------
// UnmatchedPayments — money not matched yet, two lists under one date range.
// Ported from Houzs (pages/scm-v2/UnmatchedPayments.tsx) and cut to Conts:
//   Payments   — a customer payment finance has not confirmed yet (a card waits
//                for Merchant recon), or confirmed and not matched to a bank
//                statement line yet (Bank recon);
//   Bank lines — a bank statement line, money in or out, that no entry in the
//                books is matched to and nobody has set aside.
// Houzs' merchant report lines list, its DuitNow QR money and its "previous
// records" are not Conts concepts and are left out. Each list exports what it
// shows to Excel (the table's Export) or prints it (PDF); every row links the
// screen that unsticks it. The rules are the server's.
// ----------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateField } from '../../vendor/scm/components/DateField';
import { fmtDate, fmtSenPlain } from '../../vendor/shared/format';
import {
  useUnmatchedBankLines, useUnmatchedPayments, type BankLineWhat, type UnmatchedBankLine, type UnmatchedPayment, type UnmatchedState,
} from './unmatched-payments-queries';

type ListKey = 'payments' | 'bank';
const LISTS: ReadonlyArray<{ key: ListKey; label: string; sub: string; file: string }> = [
  { key: 'payments', label: 'Payments', sub: 'recorded, not confirmed or not on the bank', file: 'unmatched-payments' },
  { key: 'bank', label: 'Bank lines', sub: 'on the statement, nothing matched', file: 'unmatched-bank-lines' },
];

const ABOUT: Record<ListKey, string> = {
  payments: 'Every customer payment on a sales order or invoice that is not matched yet: still waiting for finance to confirm it '
    + '(a card payment is confirmed on Merchant recon), or confirmed and not matched to a bank statement line on Bank recon. '
    + 'Not listed: money moved between orders, customer credit applied, payments dated before the books start, and cancelled orders.',
  bank: 'Lines on an uploaded bank statement that no entry in the books is matched to and nobody has set aside: a card payout waiting '
    + 'for its merchant report, and other money in or out — each with the entries of the same amount it could be.',
};

/** Where each payment is stuck, in words, and the screen that unsticks it. */
export const STATE_WORDS: Record<UnmatchedState, { label: string; to: string; go: string }> = {
  WAITING_CONFIRMATION: { label: 'Waiting for finance to confirm', to: '/scm/official-receipts', go: 'Official receipts' },
  CARD_NOT_REPORTED: { label: 'Card: no merchant report has it yet', to: '/scm/merchant-recon', go: 'Merchant recon' },
  CARD_TO_CONFIRM: { label: 'Card: on a merchant report, not confirmed', to: '/scm/merchant-recon', go: 'Merchant recon' },
  CONFIRMED_NOT_POSTED: { label: 'Confirmed, not in the books', to: '/scm/accounting?tab=check', go: 'Self-check' },
  NOT_MATCHED: { label: 'Not matched to the bank statement', to: '/scm/bank-recon', go: 'Bank recon' },
  NO_STATEMENT: { label: 'Bank statement not uploaded yet', to: '/scm/bank-recon', go: 'Bank recon' },
};
const PAYMENT_STATES = (Object.keys(STATE_WORDS) as UnmatchedState[]).map((k) => ({ key: k, label: STATE_WORDS[k].label }));

export const WHAT_WORDS: Record<BankLineWhat, string> = { CARD: 'Card payout', IN: 'Money in', OUT: 'Money out' };
const BANK_KINDS = (Object.keys(WHAT_WORDS) as BankLineWhat[]).map((k) => ({ key: k, label: WHAT_WORDS[k] }));

const KIND_WORDS: Record<UnmatchedPayment['kind'], string> = { card: 'Card', transfer: 'Transfer', cash: 'Cash' };

const myt = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const daysBefore = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const rm = (sen: number): string => `RM ${fmtSenPlain(sen)}`;

const moneyColumn = <T,>(sen: (r: T) => number): Column<T> => ({
  key: 'amount', label: 'Amount (RM)', align: 'right',
  render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSenPlain(sen(r))}</span>,
  getValue: sen, exportValue: (r) => sen(r) / 100, exportFormat: 'money',
  total: (rows) => fmtSenPlain(rows.reduce((s, r) => s + sen(r), 0)),
});
const daysColumn = <T,>(age: (r: T) => number): Column<T> => ({
  key: 'days', label: 'Days', align: 'right',
  render: (r) => <span style={{ color: age(r) > 14 ? 'var(--c-festive-b, #b3261e)' : undefined, fontWeight: age(r) > 14 ? 700 : undefined }}>{age(r)}</span>,
  getValue: age, exportFormat: 'number',
});

export const PAYMENT_COLUMNS: Column<UnmatchedPayment>[] = [
  { key: 'paidOn', label: 'Paid on', render: (r) => fmtDate(r.paidOn), getValue: (r) => r.paidOn, exportFormat: 'date' },
  daysColumn<UnmatchedPayment>((r) => r.ageDays),
  {
    key: 'doc', label: 'Document',
    render: (r) => (r.source === 'SOPAY' ? <Link to={`/scm/sales-orders/${encodeURIComponent(r.docNo)}`}>{r.docNo}</Link> : r.docNo),
    getValue: (r) => r.docNo,
  },
  { key: 'customer', label: 'Customer', render: (r) => r.customerName ?? '—', getValue: (r) => r.customerName ?? '' },
  { key: 'collectedBy', label: 'Collected by', render: (r) => r.collectedByName ?? '—', getValue: (r) => r.collectedByName ?? '' },
  { key: 'salesperson', label: 'Salesperson', defaultHidden: true, render: (r) => r.salespersonName ?? '—', getValue: (r) => r.salespersonName ?? '' },
  { key: 'kind', label: 'Method', render: (r) => `${KIND_WORDS[r.kind]}${r.channel ? ` · ${r.channel}` : ''}`, getValue: (r) => `${KIND_WORDS[r.kind]}${r.channel ? ` · ${r.channel}` : ''}` },
  { key: 'reference', label: 'Reference', render: (r) => r.reference ?? '—', getValue: (r) => r.reference ?? '' },
  { key: 'receipt', label: 'Receipt', render: (r) => r.orNumber ?? '—', getValue: (r) => r.orNumber ?? '' },
  moneyColumn<UnmatchedPayment>((r) => r.amountSen),
  { key: 'state', label: 'Where it is', render: (r) => STATE_WORDS[r.state].label, getValue: (r) => STATE_WORDS[r.state].label },
  {
    key: 'bank', label: 'Bank', defaultHidden: true,
    render: (r) => (r.bankAccountCode ? `${r.bankAccountCode}${r.statementUpTo ? ` · statements to ${fmtDate(r.statementUpTo)}` : ' · no statement'}` : '—'),
    getValue: (r) => r.bankAccountCode ?? '',
  },
  { key: 'entry', label: 'Entry', defaultHidden: true, render: (r) => r.jeNo ?? '—', getValue: (r) => r.jeNo ?? '' },
  { key: 'go', label: '', render: (r) => <Link to={STATE_WORDS[r.state].to}>{STATE_WORDS[r.state].go}</Link>, disableSort: true, disableFilter: true },
];

export const BANK_COLUMNS: Column<UnmatchedBankLine>[] = [
  { key: 'bookedOn', label: 'Date', render: (r) => fmtDate(r.bookedOn), getValue: (r) => r.bookedOn, exportFormat: 'date' },
  daysColumn<UnmatchedBankLine>((r) => r.ageDays),
  { key: 'account', label: 'Bank', render: (r) => r.bankName ? `${r.accountCode} · ${r.bankName}` : r.accountCode, getValue: (r) => r.bankName ? `${r.accountCode} · ${r.bankName}` : r.accountCode },
  { key: 'description', label: 'Description', render: (r) => r.description || '—', getValue: (r) => r.description },
  { key: 'reference', label: 'Reference', render: (r) => r.reference ?? '—', getValue: (r) => r.reference ?? '' },
  moneyColumn<UnmatchedBankLine>((r) => r.amountSen),
  { key: 'what', label: 'What', render: (r) => `${WHAT_WORDS[r.what]}${r.acquirerCode ? ` · ${r.acquirerCode}` : ''}`, getValue: (r) => WHAT_WORDS[r.what] },
  { key: 'note', label: 'Why it is open', render: (r) => r.note ?? '—', getValue: (r) => r.note ?? '' },
  { key: 'go', label: '', render: () => <Link to="/scm/bank-recon">Bank recon</Link>, disableSort: true, disableFilter: true },
];

type Chip = { key: string; label: string; n: number; sen: number };
const chipsOf = <T,>(rows: readonly T[], sen: (r: T) => number, defs: ReadonlyArray<{ key: string; label: string }>, keyOf: (r: T) => string): Chip[] => [
  { key: 'all', label: 'All', n: rows.length, sen: rows.reduce((s, r) => s + sen(r), 0) },
  ...defs.map((d) => {
    const mine = rows.filter((r) => keyOf(r) === d.key);
    return { key: d.key, label: d.label, n: mine.length, sen: mine.reduce((s, r) => s + sen(r), 0) };
  }).filter((c) => c.n > 0),
];

/** The cells a printed list carries: what each column exports, as text. */
const printedCells = <T,>(rows: readonly T[], cols: Column<T>[]): string[][] => rows.map((r) => cols.map((c) => {
  if (c.key === 'amount') return fmtSenPlain(Number(c.getValue?.(r) ?? 0));
  if (c.exportFormat === 'date') return fmtDate(String(c.getValue?.(r) ?? ''));
  return String(c.getValue?.(r) ?? '');
}));

export const UnmatchedPayments = () => {
  const today = myt();
  const [from, setFrom] = useState(daysBefore(today, 180));
  const [to, setTo] = useState(today);
  const backwards = from > to;
  const [params, setParams] = useSearchParams();
  const list: ListKey = params.get('list') === 'bank' ? 'bank' : 'payments';
  const choose = (k: ListKey) => setParams((prev) => { const next = new URLSearchParams(prev); next.set('list', k); return next; }, { replace: true });
  const [chip, setChip] = useState<Record<ListKey, string>>({ payments: 'all', bank: 'all' });
  const [printError, setPrintError] = useState<string | null>(null);

  const payQ = useUnmatchedPayments(from, to, !backwards);
  const bankQ = useUnmatchedBankLines(from, to, !backwards);
  const payments = backwards ? null : payQ.data?.rows ?? null;
  const bank = backwards ? null : bankQ.data?.rows ?? null;

  const chips: Record<ListKey, Chip[]> = {
    payments: chipsOf(payments ?? [], (r) => r.amountSen, PAYMENT_STATES, (r) => r.state),
    bank: chipsOf(bank ?? [], (r) => r.amountSen, BANK_KINDS, (r) => r.what),
  };
  const on = (k: ListKey): string => (chips[k].some((c) => c.key === chip[k]) ? chip[k] : 'all');
  const rowsOn = {
    payments: payments == null ? null : on('payments') === 'all' ? payments : payments.filter((r) => r.state === on('payments')),
    bank: bank == null ? null : on('bank') === 'all' ? bank : bank.filter((r) => r.what === on('bank')),
  };
  const loaded: Record<ListKey, boolean> = { payments: payments != null, bank: bank != null };
  const oldest: Record<ListKey, number> = {
    payments: Math.max(0, ...(payments ?? []).map((r) => r.ageDays)),
    bank: Math.max(0, ...(bank ?? []).map((r) => r.ageDays)),
  };

  /* What each table shows after its own filters, for its PDF. Told on every render, read on a press. */
  const seen = useRef<{ payments: UnmatchedPayment[] | null; bank: UnmatchedBankLine[] | null }>({ payments: null, bank: null });
  const seenPayments = useCallback((r: UnmatchedPayment[]) => { seen.current.payments = r; }, []);
  const seenBank = useCallback((r: UnmatchedBankLine[]) => { seen.current.bank = r; }, []);

  const range = `Dated ${fmtDate(from)} to ${fmtDate(to)}`;
  const chipWords = (k: ListKey): string => {
    const c = chips[k].find((x) => x.key === on(k));
    return c && c.key !== 'all' ? ` · Filter: ${c.label}` : '';
  };
  const print = async (k: ListKey) => {
    setPrintError(null);
    try {
      const { generateUnmatchedPdf } = await import('../../vendor/scm/lib/unmatched-payments-pdf');
      const meta = LISTS.find((l) => l.key === k)!;
      if (k === 'payments') {
        const rows = seen.current.payments ?? rowsOn.payments ?? [];
        const cols = PAYMENT_COLUMNS.filter((c) => !c.defaultHidden && c.key !== 'go');
        await generateUnmatchedPdf({
          title: 'Unmatched payments', subtitle: `${range}${chipWords(k)}`, head: cols.map((c) => c.label), body: printedCells(rows, cols),
          amountColumn: cols.findIndex((c) => c.key === 'amount'), totalSen: rows.reduce((s, r) => s + r.amountSen, 0), fileName: meta.file,
        });
      } else {
        const rows = seen.current.bank ?? rowsOn.bank ?? [];
        const cols = BANK_COLUMNS.filter((c) => !c.defaultHidden && c.key !== 'go');
        await generateUnmatchedPdf({
          title: 'Unmatched bank lines', subtitle: `${range}${chipWords(k)}`, head: cols.map((c) => c.label), body: printedCells(rows, cols),
          amountColumn: cols.findIndex((c) => c.key === 'amount'), totalSen: rows.reduce((s, r) => s + r.amountSen, 0), fileName: meta.file,
        });
      }
    } catch (e) {
      setPrintError(`The file could not be made — ${e instanceof Error ? e.message : 'something went wrong.'}`);
    }
  };

  const summary = (k: ListKey): string => {
    const c = chips[k].find((x) => x.key === on(k))!;
    return k === 'payments'
      ? `${plural(c.n, 'payment')} not matched, ${rm(c.sen)} in total.`
      : `${plural(c.n, 'bank line')} with no entry matched, ${rm(c.sen)} net.`;
  };
  const errorOf = (k: ListKey): string | null => {
    if (backwards) return 'The From date is after the To date.';
    if (k === 'payments') return payQ.isError ? 'The payments did not load.' : null;
    return bankQ.isError ? 'The bank lines did not load.' : null;
  };
  const printButton = (k: ListKey) => (
    <Button variant="secondary" className="h-8" disabled={!loaded[k]} onClick={() => void print(k)}>
      <FileText size={14} strokeWidth={1.75} /> PDF
    </Button>
  );
  const chipClass = (active: boolean) => `whitespace-nowrap rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${active
    ? 'bg-primary text-white shadow-sm' : 'text-ink-secondary hover:bg-primary-soft hover:text-primary'}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader eyebrow="Finance · Bank & cards" title="Unmatched payments" description="Money not matched yet, on one page: customer payments, and bank statement lines." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>Dated from</span>
        <DateField value={from} onChange={(v) => { if (v) setFrom(v); }} aria-label="Dated from" />
        <span style={{ fontSize: 13 }}>to</span>
        <DateField value={to} onChange={(v) => { if (v) setTo(v); }} aria-label="Dated to" />
      </div>
      {printError && <div role="alert" style={{ color: 'var(--c-festive-b, #b3261e)', fontSize: 12 }}>{printError}</div>}

      <div role="tablist" aria-label="Lists" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {LISTS.map((l) => {
          const all = chips[l.key][0]!;
          const active = list === l.key;
          return (
            <button key={l.key} type="button" role="tab" aria-selected={active} onClick={() => choose(l.key)}
              className={`rounded-md border px-4 py-3 text-left ${active ? 'border-primary bg-primary-soft' : 'border-border bg-surface'}`} style={{ minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{l.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{loaded[l.key] ? all.n : '…'}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{loaded[l.key] ? `${rm(all.sen)} · ${l.sub}` : l.sub}</div>
              {loaded[l.key] && all.n > 0 && (
                <div style={{ fontSize: 12, color: oldest[l.key] > 14 ? 'var(--c-festive-b, #b3261e)' : undefined }}>oldest {plural(oldest[l.key], 'day')}</div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>{ABOUT[list]}</div>
      {loaded[list] && (
        <div role="group" aria-label={`${LISTS.find((l) => l.key === list)!.label} filter`} className="inline-flex flex-wrap gap-0.5 self-start rounded-md border border-border bg-surface p-1">
          {chips[list].map((c) => (
            <button key={c.key} type="button" aria-pressed={on(list) === c.key} className={chipClass(on(list) === c.key)}
              onClick={() => setChip((prev) => ({ ...prev, [list]: c.key }))}>
              {`${c.label} (${c.n})`}
            </button>
          ))}
        </div>
      )}
      {loaded[list] && <div style={{ fontSize: 13 }} aria-live="polite">{summary(list)}</div>}

      <div hidden={list !== 'payments'}>
        <DataTable<UnmatchedPayment>
          tableId="unmatched-payments"
          exportName="unmatched-payments"
          exportXlsx
          toolbarExtra={printButton('payments')}
          onFilteredRowsChange={seenPayments}
          columns={PAYMENT_COLUMNS}
          rows={rowsOn.payments}
          loading={!backwards && payQ.isLoading}
          error={errorOf('payments')}
          emptyLabel="Every customer payment in these dates is confirmed and matched."
          getRowKey={(r) => `${r.source}:${r.paymentId}`}
        />
      </div>
      <div hidden={list !== 'bank'}>
        <DataTable<UnmatchedBankLine>
          tableId="unmatched-bank-lines"
          exportName="unmatched-bank-lines"
          exportXlsx
          toolbarExtra={printButton('bank')}
          onFilteredRowsChange={seenBank}
          columns={BANK_COLUMNS}
          rows={rowsOn.bank}
          loading={!backwards && bankQ.isLoading}
          error={errorOf('bank')}
          emptyLabel="Every bank line in these dates is matched or set aside."
          getRowKey={(r) => r.lineId}
        />
      </div>
    </div>
  );
};
