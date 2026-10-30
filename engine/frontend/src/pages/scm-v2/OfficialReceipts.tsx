// ----------------------------------------------------------------------------
// OfficialReceipts — /scm/official-receipts, the OR book (GL redesign item 9b).
// Every customer payment's OFFICIAL RECEIPT document lives here: the drafts
// waiting for their money to be confirmed and the formal run per channel.
// Distinct from /scm/receipts (这个月收了什么钱 money-in list) — that page is
// about the ledger, this one is about the paper. Buttons per row — Print
// (DRAFT prints with the watermark) and, on a draft, Confirm received —
// finance's alone (scm.payment_voucher.post; SOP 4.2/4.5, 29 Oct 2026): the
// salesperson records the payment, finance checks the bank statement, picks
// the bank the money landed in (the default bank first) and confirms. Only
// then is the money received: the receipt goes formal, the payment posts and
// the project limit counts it. Waiting for confirmation lists the drafts.
//
// Opens on THIS MONTH (owner 2026-09-16: or 我如何查看 amount 是对的): every
// receipt whose payment day falls in it, oldest first, a total under the
// list, and the month's CHECK above it — the customer payments that arrived
// against the receipts, the difference, and every row behind a difference (a
// payment with no receipt, a receipt whose amount is not its payment's, a
// receipt whose payment is gone). "Any month" is the newest 100, as before.
// ----------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import { fmtSen, fmtDateOrDash } from '../../vendor/shared/format';
import { PageHeader } from '../../components/Layout';
import { PAYMENT_METHOD_CODES, PAYMENT_METHOD_DEFAULT_LABELS } from '../../vendor/scm/lib/payment-methods';
import { humaniseStatusKey } from '../../vendor/scm/lib/status-pill';
import { DataTable, type Column } from '../../components/DataTable';
import { generateReceiptPdf, type ReceiptPdfData } from '../../vendor/scm/lib/receipt-pdf';
import { Modal } from '../../vendor/scm/components/Modal';
import { useNotify } from '../../vendor/scm/components/NotifyDialog';
import { DocAttachments } from '../../components/doc-attachments/DocAttachments';
import { useAuth } from '../../auth/AuthContext';
import { useChooseBank } from '../../conts/ClaimsParts';

type ReceiptRow = ReceiptPdfData & {
  id: number;
  payment_source: string;
  payment_id: string;
  channel_account_code: string | null;
  created_at: string;
};

/** What the confirm answers: the receipt number, and what posted (or why not). */
type ConfirmResult = { ok: boolean; orNumber: string; already?: boolean; posting?: { status: string; jeNo?: string; reason?: string } };
type ConfirmBanks = { defaultCode: string; banks: Array<{ code: string; name: string }> };

/** The confirm's answer in one sentence for the dialog. */
export const confirmedSentence = (r: ConfirmResult): string => {
  const p = r.posting;
  const posted = !p ? ''
    : p.status === 'posted' || p.status === 'already_posted' ? ` Posted to the ledger as ${p.jeNo ?? 'a journal entry'}.`
    : ` Not posted yet (${p.reason ?? p.status.replace(/_/g, ' ')}) — the Self-check card lists it.`;
  return `Receipt ${r.orNumber} issued.${posted}`;
};

export type ReceiptsCheck = {
  month: string;
  payments: { count: number; totalSen: number };
  receipts: { count: number; totalSen: number };
  diffSen: number;
  missing: Array<{ source: string; paymentId: string; docNo: string | null; paidAt: string; method: string; amountSen: number }>;
  mismatched: Array<{ orNumber: string; source: string; paymentId: string; docNo: string | null; paidAt: string; receiptSen: number; paymentSen: number }>;
  orphans: Array<{ orNumber: string; docNo: string | null; paidAt: string; amountSen: number }>;
};

/** Today's month in Malaysia, the way the payment rows are dated. */
export const mytMonth = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
/** "2026-06" → "06/2026". */
export const monthWord = (m: string): string => (/^\d{4}-\d{2}$/.test(m) ? `${m.slice(5)}/${m.slice(0, 4)}` : m);

const methodLabel = (m: string | null): string => {
  const code = PAYMENT_METHOD_CODES.find((c) => c === m);
  return code ? PAYMENT_METHOD_DEFAULT_LABELS[code] : m ? humaniseStatusKey(m) : '—';
};
const soft: React.CSSProperties = { fontSize: 'var(--fs-13)', color: 'var(--text-soft, #8a8578)' };
const good = 'var(--c-secondary-a, #2F5D4F)';
const bad = 'var(--c-festive-b, #B8331F)';
const btn = (primary?: boolean, disabled?: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  border: '1px solid var(--c-line, rgba(34,31,32,0.2))',
  borderRadius: 'var(--radius-sm, 6px)',
  background: primary ? 'var(--c-ink)' : 'transparent',
  color: primary ? 'var(--c-cream)' : 'var(--c-ink)',
  fontSize: 'var(--fs-13)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

export const OfficialReceipts = () => {
  const qc = useQueryClient();
  const { can } = useAuth();
  /* Confirming money is finance's (SOP 4.2): the salesperson records, finance checks the bank. */
  const canConfirm = can('scm.payment_voucher.post');
  const chooseBank = useChooseBank();
  const notify = useNotify();
  const [status, setStatus] = useState<'' | 'DRAFT' | 'FORMAL'>('');
  /* '' = any month: the newest 100 receipts. */
  const [month, setMonth] = useState<string>(mytMonth());
  const [filesFor, setFilesFor] = useState<ReceiptRow | null>(null);
  const listPath = `/accounting/receipts${[status ? `status=${status}` : '', month ? `month=${month}` : ''].filter(Boolean).map((p, i) => (i === 0 ? `?${p}` : `&${p}`)).join('')}`;
  const q = useQuery({
    queryKey: ['official-receipts', status, month],
    queryFn: () => authedFetch<{ receipts: ReceiptRow[] }>(listPath),
    staleTime: 15_000,
  });
  const check = useQuery({
    queryKey: ['official-receipts-check', month],
    queryFn: () => authedFetch<ReceiptsCheck>(`/accounting/receipts/check?month=${encodeURIComponent(month)}`),
    enabled: Boolean(month),
    staleTime: 15_000,
  });
  const banks = useQuery({
    queryKey: ['official-receipts-banks'],
    queryFn: () => authedFetch<ConfirmBanks>('/accounting/receipts/banks'),
    enabled: canConfirm,
    staleTime: 60_000,
  });
  const formalise = useMutation({
    mutationFn: (v: { id: number; accountCode: string }) =>
      authedFetch<ConfirmResult>(`/accounting/receipts/${v.id}/formalise`, { method: 'POST', body: JSON.stringify({ accountCode: v.accountCode }) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['official-receipts'] });
      void qc.invalidateQueries({ queryKey: ['official-receipts-check'] });
      void notify({ title: 'Payment confirmed', body: confirmedSentence(r) });
    },
  });
  /* Which bank did the money land in? The default bank first. */
  const confirmReceived = async (r: ReceiptRow) => {
    const list: ConfirmBanks | undefined = banks.data ?? await qc.fetchQuery({ queryKey: ['official-receipts-banks'], queryFn: () => authedFetch<ConfirmBanks>('/accounting/receipts/banks') });
    if (!list) return;
    const ordered = [...list.banks].sort((a, b) => Number(b.code === list.defaultCode) - Number(a.code === list.defaultCode))
      .map((b) => (b.code === list.defaultCode ? { ...b, name: `${b.name} (default)` } : b));
    const code = await chooseBank(ordered, `${fmtSen(r.amount_sen)} on ${r.doc_no ?? r.or_number} — received in which bank?`);
    if (!code) return;
    formalise.mutate({ id: r.id, accountCode: code });
  };
  const rows = useMemo(() => q.data?.receipts ?? [], [q.data]);
  /* The rows on screen after the table's own funnels: the total adds up THOSE. */
  const [shown, setShown] = useState<ReceiptRow[]>([]);
  const totalSen = shown.reduce((s, r) => s + Number(r.amount_sen), 0);
  const columns = useMemo<Column<ReceiptRow>[]>(() => [
    { key: 'or', label: 'OR No', render: (r) => <b>{r.or_number}</b>, getValue: (r) => r.or_number },
    {
      key: 'status', label: 'Status',
      render: (r) => <span style={{ color: r.status === 'FORMAL' ? 'var(--c-good, #2f5d4f)' : undefined }}>{r.status === 'FORMAL' ? 'Formal' : 'Draft'}</span>,
      getValue: (r) => (r.status === 'FORMAL' ? 'Formal' : 'Draft'),
    },
    { key: 'paid', label: 'Paid', render: (r) => fmtDateOrDash(r.paid_at), getValue: (r) => r.paid_at, exportFormat: 'date' },
    { key: 'document', label: 'Document', render: (r) => r.doc_no ?? '—', getValue: (r) => r.doc_no ?? '' },
    { key: 'customer', label: 'Customer', render: (r) => r.customer_name ?? '—', getValue: (r) => r.customer_name ?? '' },
    { key: 'method', label: 'Method', render: (r) => methodLabel(r.method), getValue: (r) => r.method ?? '' },
    {
      key: 'amount', label: 'Amount', align: 'right', render: (r) => fmtSen(r.amount_sen),
      getValue: (r) => Number(r.amount_sen), exportValue: (r) => Number(r.amount_sen) / 100, exportFormat: 'money',
    },
    {
      key: 'actions', label: '', exportLabel: 'Actions', disableFilter: true,
      render: (r) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <button type="button" style={btn()} onClick={() => { void generateReceiptPdf(r, { action: 'print' }); }}>Print</button>{' '}
          <button type="button" style={btn()} onClick={() => setFilesFor(r)}>Files</button>{' '}
          {r.status !== 'FORMAL' && canConfirm && (
            <button type="button" style={btn(true, formalise.isPending)} disabled={formalise.isPending}
              onClick={() => { void confirmReceived(r); }}>
              Confirm received
            </button>
          )}
        </span>
      ),
    },
  ], [formalise, canConfirm, banks.data]);
  const c = check.data;
  const clean = c != null && c.diffSen === 0 && c.missing.length === 0 && c.mismatched.length === 0 && c.orphans.length === 0;

  return (
    <div className="space-y-3">
      <PageHeader eyebrow="Finance" title="Official Receipts" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {([['', 'All'], ['DRAFT', 'Waiting for confirmation'], ['FORMAL', 'Confirmed']] as const).map(([v, label]) => (
          <button key={v || 'all'} type="button" style={btn(status === v)} onClick={() => setStatus(v)}>{label}</button>
        ))}
        <span style={{ width: 12 }} />
        <input type="month" value={month} aria-label="Receipts month" onChange={(e) => setMonth(e.target.value)}
          style={{ fontSize: 'var(--fs-13)', padding: '3px 6px', border: '1px solid var(--c-line, rgba(34,31,32,0.2))', borderRadius: 'var(--radius-sm, 6px)' }} />
        {month
          ? <button type="button" style={btn()} onClick={() => setMonth('')}>Any month</button>
          : <button type="button" style={btn()} onClick={() => setMonth(mytMonth())}>This month</button>}
        <span style={soft}>Cash and transfers: finance checks the bank statement, then Confirm received. Card payments are confirmed by merchant reconciliation.</span>
      </div>

      {month && (
        <section aria-label="Receipts check" data-testid="receipts-check"
          style={{ padding: '10px 14px', border: `1px solid ${check.isError ? bad : clean ? good : c ? bad : 'var(--c-line, rgba(34,31,32,0.18))'}`, borderRadius: 10, fontSize: 'var(--fs-13)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {check.isLoading && <span style={soft}>Checking {monthWord(month)}…</span>}
          {check.isError && <span style={{ color: bad }}>The check for {monthWord(month)} did not load.</span>}
          {c && (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <b>{monthWord(month)}</b>
                <span>Customer payments {fmtSen(c.payments.totalSen)} ({c.payments.count})</span>
                <span>Receipts {fmtSen(c.receipts.totalSen)} ({c.receipts.count})</span>
                <span style={{ fontWeight: 700, color: clean ? good : bad }}>Difference {fmtSen(c.diffSen)}</span>
                {clean && <span style={{ color: good }}>Every payment of the month has its receipt, for its own amount.</span>}
              </div>
              {c.missing.length > 0 && (
                <div>
                  <b style={{ color: bad }}>Payments without a receipt ({c.missing.length})</b>
                  <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                    {c.missing.map((p) => <li key={`${p.source}:${p.paymentId}`}>{fmtDateOrDash(p.paidAt)} · {p.docNo ?? p.paymentId} · {p.method} · {fmtSen(p.amountSen)}</li>)}
                  </ul>
                </div>
              )}
              {c.mismatched.length > 0 && (
                <div>
                  <b style={{ color: bad }}>Receipts whose amount is not the payment's ({c.mismatched.length})</b>
                  <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                    {c.mismatched.map((m) => <li key={m.orNumber}>{m.orNumber} · {m.docNo ?? m.paymentId} · receipt {fmtSen(m.receiptSen)} · payment {fmtSen(m.paymentSen)}</li>)}
                  </ul>
                </div>
              )}
              {c.orphans.length > 0 && (
                <div>
                  <b style={{ color: bad }}>Receipts whose payment is gone ({c.orphans.length})</b>
                  <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                    {c.orphans.map((o) => <li key={o.orNumber}>{o.orNumber} · {o.docNo ?? '—'} · {fmtDateOrDash(o.paidAt)} · {fmtSen(o.amountSen)}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {formalise.isError && (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--c-danger, #a33)' }}>
          {String((formalise.error as { message?: string } | null)?.message ?? 'The receipt was not confirmed.')}
        </div>
      )}
      <DataTable<ReceiptRow>
        tableId="official-receipts"
        exportName="official-receipts"
        exportXlsx
        columns={columns}
        rows={q.data ? rows : null}
        loading={q.isLoading}
        error={q.isError ? 'The receipts did not load.' : null}
        emptyLabel={month ? `No receipts for ${monthWord(month)}.` : 'No receipts yet — one is born with every customer payment recorded from now on.'}
        getRowKey={(r) => r.id}
        onFilteredRowsChange={setShown}
      />
      {filesFor && (
        <Modal title={`Files — ${filesFor.or_number || `Draft receipt ${filesFor.id}`}`} onClose={() => setFilesFor(null)} width="min(720px, 100%)" ariaLabel="Receipt files">
          <DocAttachments docType="official_receipt" docId={String(filesFor.id)} canEdit bare />
        </Modal>
      )}
      {shown.length > 0 && (
        <div data-testid="receipts-total"
          style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderTop: '2px solid var(--c-ink, #221f20)', fontWeight: 700, fontSize: 'var(--fs-13)' }}>
          <span>{shown.length} receipt{shown.length === 1 ? '' : 's'}{month ? ` in ${monthWord(month)}` : ''}{status ? ` (${status === 'FORMAL' ? 'formal' : 'draft'})` : ''}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSen(totalSen)}</span>
        </div>
      )}
    </div>
  );
};
