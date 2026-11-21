// ----------------------------------------------------------------------------
// Payment listing — the vouchers to pay, a line each, with what each is for and
// the bank each pays into. Ported from Houzs (pages/scm-v2/PaymentListing.tsx)
// onto the Conts voucher: the departments and projects of its lines, and the
// payee's bank from the supplier, or from the claim it pays back.
//
// It opens on what is not posted yet (Prepared and Checked) dated up to today;
// the reader picks the days, the stages, the payee and the account it is paid
// from. Excel from the table's Export; Print prints the rows on screen.
// Server: GET /payment-vouchers/listing (payment-vouchers-listing.ts).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateField } from '../../vendor/scm/components/DateField';
import { useAccounts } from '../../vendor/scm/lib/accounting-queries';
import { todayMyt } from '../../vendor/scm/lib/dates';
import { usePaymentListing, type PaymentListingRow, type PaymentListingStage } from '../../vendor/scm/lib/payment-voucher-queries';
import type { PaymentListingLine } from '../../vendor/scm/lib/payment-listing-pdf';
import { fmtDate, fmtMoneySen, fmtSenPlain } from '../../vendor/shared/format';
import { TAG } from '../../conts/voucherPurpose';
import styles from './SalesOrderDetail.module.css';

/* The four layers' words: a posted voucher reads Approved. */
export const LISTING_STAGES: Array<{ key: PaymentListingStage; word: string }> = [
  { key: 'DRAFT', word: 'Draft' },
  { key: 'PREPARED', word: 'Prepared' },
  { key: 'CHECKED', word: 'Checked' },
  { key: 'POSTED', word: 'Approved' },
  { key: 'CANCELLED', word: 'Cancelled' },
];
const DEFAULT_STAGES: PaymentListingStage[] = ['PREPARED', 'CHECKED'];
const stageWord = (s: PaymentListingStage): string => LISTING_STAGES.find((x) => x.key === s)?.word ?? s;

const isForeign = (r: PaymentListingRow): boolean => String(r.currency ?? 'MYR').toUpperCase() !== 'MYR';
/** What leaves the bank in ringgit: a voucher in another currency at its own rate. */
export const ringgitSenOf = (r: PaymentListingRow): number =>
  Math.round(Number(r.total_sen ?? 0) * (isForeign(r) ? Number(r.exchange_rate) || 1 : 1));
const payeeOf = (r: PaymentListingRow): string => r.payee_name || r.supplier?.name || '';
const departmentsOf = (r: PaymentListingRow): string =>
  (r.departments ?? []).map((d) => (d in TAG ? TAG[d as keyof typeof TAG] : d)).join(', ');
const projectsOf = (r: PaymentListingRow): string => (r.projects ?? []).join(', ');

/** The sentence on top of the printed listing: the days, the stages and the filters it was cut to. */
export function listingSubtitle(f: { from: string; to: string; stages: PaymentListingStage[]; payee: string; payFrom: string }): string {
  const words = f.stages.map(stageWord);
  return [
    `Vouchers dated ${f.from ? `${fmtDate(f.from)} to ${fmtDate(f.to)}` : `up to ${fmtDate(f.to)}`}, at ${words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? 'no stage'}.`,
    f.payee.trim() ? `Payee: ${f.payee.trim()}.` : '',
    f.payFrom ? `Pay from: ${f.payFrom}.` : '',
    'All amounts in RM; a voucher in another currency shows its own amount under the ringgit.',
  ].filter(Boolean).join(' ');
}

/** A row as the paper prints it. */
export const printedLine = (r: PaymentListingRow): PaymentListingLine => ({
  pvNumber: r.pv_number,
  voucherDate: r.voucher_date,
  payee: payeeOf(r),
  description: r.description_text?.trim() ?? '',
  department: departmentsOf(r),
  bank: r.pay_bank ?? '',
  accountNo: r.pay_account_no ?? '',
  accountName: r.pay_account_name ?? '',
  ringgitSen: ringgitSenOf(r),
  currency: String(r.currency ?? 'MYR'),
  totalSen: Number(r.total_sen ?? 0),
  stage: stageWord(r.stage),
});

const pillClass = (on: boolean) => `whitespace-nowrap rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${on
  ? 'bg-primary text-white shadow-sm' : 'text-ink-secondary hover:bg-primary-soft hover:text-primary'}`;

export const PaymentListing = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => todayMyt());
  const [stages, setStages] = useState<PaymentListingStage[]>(DEFAULT_STAGES);
  const [payee, setPayee] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [printError, setPrintError] = useState<string | null>(null);
  const q = usePaymentListing({ from, to, stages });
  const accounts = useAccounts();
  const accountName = useMemo(() => new Map((accounts.data?.accounts ?? []).map((a) => [a.account_code, a.account_name])), [accounts.data]);
  const payFromLabel = (code: string) => `${code}${accountName.get(code) ? ` · ${accountName.get(code)}` : ''}`;

  const all = useMemo(() => q.data?.vouchers ?? [], [q.data]);
  const payFromCodes = useMemo(() => [...new Set(all.map((r) => String(r.credit_account_code ?? '')).filter(Boolean))].sort(), [all]);
  const rows = useMemo(() => {
    const want = payee.trim().toUpperCase();
    return all.filter((r) => (!want || payeeOf(r).toUpperCase().includes(want)) && (!payFrom || r.credit_account_code === payFrom));
  }, [all, payee, payFrom]);
  const totalSen = rows.reduce((s, r) => s + ringgitSenOf(r), 0);
  const byStage = LISTING_STAGES.map((s) => ({ ...s, n: rows.filter((r) => r.stage === s.key).length })).filter((s) => s.n > 0);

  const toggleStage = (s: PaymentListingStage) =>
    setStages((was) => (was.includes(s) ? was.filter((x) => x !== s) : LISTING_STAGES.map((x) => x.key).filter((k) => k === s || was.includes(k))));

  const columns = useMemo<Column<PaymentListingRow>[]>(() => [
    {
      key: 'pv_number', label: 'PV No.',
      render: (r) => <Link to={`/scm/payment-vouchers/${r.id}`} style={{ fontWeight: 600 }}>{r.pv_number}</Link>,
      getValue: (r) => r.pv_number,
    },
    { key: 'voucher_date', label: 'Date', render: (r) => fmtDate(r.voucher_date), getValue: (r) => r.voucher_date ?? '', exportFormat: 'date' },
    { key: 'payee', label: 'Payee', render: (r) => payeeOf(r) || '—', getValue: (r) => payeeOf(r) },
    /* What is paid for, as the bills say it; the typed Remark rides hidden. */
    { key: 'description', label: 'Description', render: (r) => r.description_text?.trim() || '—', getValue: (r) => r.description_text?.trim() ?? '' },
    { key: 'remark', label: 'Remark', render: (r) => r.notes?.trim() || '—', getValue: (r) => r.notes?.trim() ?? '', defaultHidden: true },
    { key: 'department', label: 'Department', render: (r) => departmentsOf(r) || '—', getValue: (r) => departmentsOf(r) },
    { key: 'project', label: 'Project', render: (r) => projectsOf(r) || '—', getValue: (r) => projectsOf(r), defaultHidden: true },
    { key: 'bank', label: 'Bank', render: (r) => r.pay_bank || '—', getValue: (r) => r.pay_bank ?? '' },
    { key: 'accountNo', label: 'Account no.', render: (r) => r.pay_account_no || '—', getValue: (r) => r.pay_account_no ?? '' },
    { key: 'accountName', label: 'Account name', render: (r) => r.pay_account_name || '—', getValue: (r) => r.pay_account_name ?? '' },
    {
      key: 'payFrom', label: 'Pay from', defaultHidden: true,
      render: (r) => (r.credit_account_code ? payFromLabel(r.credit_account_code) : '—'),
      getValue: (r) => r.credit_account_code ?? '',
    },
    {
      key: 'amount', label: 'Amount (RM)', align: 'right',
      render: (r) => (
        <span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSenPlain(ringgitSenOf(r))}</span>
          {isForeign(r) && <span style={{ display: 'block', fontSize: 11, opacity: 0.7 }}>{fmtMoneySen(Number(r.total_sen ?? 0), String(r.currency))}</span>}
        </span>
      ),
      getValue: (r) => ringgitSenOf(r), exportValue: (r) => ringgitSenOf(r) / 100, exportFormat: 'money',
      total: (shown) => fmtSenPlain(shown.reduce((s, r) => s + ringgitSenOf(r), 0)),
    },
    { key: 'stage', label: 'Stage', render: (r) => stageWord(r.stage), getValue: (r) => stageWord(r.stage) },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- payFromLabel reads the account names the memo depends on
  ], [accountName]);

  const subtitle = listingSubtitle({ from, to, stages, payee, payFrom: payFrom ? payFromLabel(payFrom) : '' });
  const print = async () => {
    setPrintError(null);
    try {
      const { generatePaymentListingPdf } = await import('../../vendor/scm/lib/payment-listing-pdf');
      await generatePaymentListingPdf(rows.map(printedLine), { subtitle, action: 'print' });
    } catch (e) {
      setPrintError(`The listing could not be printed — ${e instanceof Error ? e.message : 'something went wrong.'}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader eyebrow="Finance · Money out" title="Payment listing"
        description="Each day's payments to make and post: one line per voucher, with what it is for and the bank it pays into." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <label className={styles.field} style={{ minWidth: 150 }}>
          <span className={styles.fieldLabel}>From</span>
          <DateField fullWidth value={from} onChange={(iso) => setFrom(iso)} className={styles.fieldInput} aria-label="From" />
        </label>
        <label className={styles.field} style={{ minWidth: 150 }}>
          <span className={styles.fieldLabel}>To</span>
          <DateField fullWidth value={to} onChange={(iso) => setTo(iso || todayMyt())} className={styles.fieldInput} aria-label="To" />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Stage</span>
          <div role="group" aria-label="Stage" className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-surface p-1">
            {LISTING_STAGES.map((s) => (
              <button key={s.key} type="button" aria-pressed={stages.includes(s.key)} className={pillClass(stages.includes(s.key))} onClick={() => toggleStage(s.key)}>
                {s.word}
              </button>
            ))}
          </div>
        </div>
        <label className={styles.field} style={{ minWidth: 180 }}>
          <span className={styles.fieldLabel}>Payee</span>
          <input type="search" className={styles.fieldInput} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Any payee" aria-label="Payee" />
        </label>
        <label className={styles.field} style={{ minWidth: 200 }}>
          <span className={styles.fieldLabel}>Pay from</span>
          <select className={styles.fieldInput} value={payFrom} onChange={(e) => setPayFrom(e.target.value)} aria-label="Pay from">
            <option value="">Any account</option>
            {payFromCodes.map((code) => <option key={code} value={code}>{payFromLabel(code)}</option>)}
          </select>
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 13 }} aria-live="polite">
        {stages.length === 0
          ? 'Pick at least one stage.'
          : q.data
            ? `${rows.length} voucher${rows.length === 1 ? '' : 's'} · RM ${fmtSenPlain(totalSen)}${byStage.length > 0 ? ` · ${byStage.map((s) => `${s.word} ${s.n}`).join(' · ')}` : ''}`
            : ' '}
      </p>
      {printError && <div role="alert" style={{ color: 'var(--c-festive-b, #b3261e)', fontSize: 12 }}>{printError}</div>}
      <DataTable<PaymentListingRow>
        tableId="payment-listing"
        exportName="payment-listing"
        exportXlsx
        toolbarExtra={(
          <Button variant="secondary" className="h-8" disabled={rows.length === 0} onClick={() => void print()}>
            <Printer size={14} strokeWidth={1.75} /> Print
          </Button>
        )}
        columns={columns}
        rows={stages.length === 0 ? [] : q.data ? rows : null}
        loading={q.isLoading && stages.length > 0}
        error={q.isError ? `The listing could not be loaded — ${q.error instanceof Error ? q.error.message : 'something went wrong.'}` : null}
        emptyLabel={stages.length === 0 ? 'Pick at least one stage.' : all.length > 0 ? 'No voucher for this payee or account — clear the filter.' : 'No voucher at these stages in these days.'}
        getRowKey={(r) => r.id}
      />
    </div>
  );
};
