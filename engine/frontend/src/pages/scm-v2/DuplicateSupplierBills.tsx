// ----------------------------------------------------------------------------
// DuplicateSupplierBills — /scm/ap-invoices/duplicates, the supplier bills
// booked more than once before the server started refusing a second copy
// (ported from Houzs). One row per copy, grouped by supplier + bill number;
// what paid or knocked off each copy sits beside it, so a bill paid twice
// stands out. Read-only: Finance opens the wrong copy and cancels it on its own
// page. Reached from the AP invoices page. Server:
// backend/src/scm/routes/ap-duplicate-bills.ts.
//
// Conts: a quotation booked before its formal invoice never pairs with the
// formal invoice; two quotations of one number show as quotations.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDuplicateSupplierBills, type DuplicateBillCopy, type DuplicateBillGroup } from '../../vendor/scm/lib/ap-invoice-queries';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/Layout';
import { useOpenDocInTab } from '../../lib/openDocInTab';
import { fmtDateOrDash, fmtSen } from '../../vendor/shared/format';
import { humaniseStatusKey } from '../../vendor/scm/lib/status-pill';
import styles from './SalesOrderDetail.module.css';

type Row = DuplicateBillCopy & { group: DuplicateBillGroup; first: boolean };

const soft: React.CSSProperties = { fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' };
const flag: React.CSSProperties = { color: 'var(--c-orange)', fontWeight: 600, fontSize: 'var(--fs-12)' };
const link: React.CSSProperties = { color: 'var(--c-orange)', fontFamily: 'var(--font-mono)' };

/** Where a copy opens: a purchase invoice on its own page, an AP invoice in the AP invoices page's pop-out. */
export const billHref = (kind: DuplicateBillGroup['kind'], id: string): string =>
  kind === 'PI' ? `/scm/purchase-invoices/${encodeURIComponent(id)}` : `/scm/ap-invoices?open=${encodeURIComponent(id)}`;

const kindWord = (g: DuplicateBillGroup): string =>
  g.kind === 'PI' ? 'Purchase invoice' : g.quotation ? 'AP invoice (quotation)' : 'AP invoice';

export const DuplicateSupplierBills = () => {
  const q = useDuplicateSupplierBills();
  const openInTab = useOpenDocInTab();
  const groups = q.data?.groups;
  const rows = useMemo<Row[] | null>(() => (groups
    ? groups.flatMap((g) => g.copies.map((c, i) => ({ ...c, group: g, first: i === 0 })))
    : null), [groups]);
  const paidTwice = (groups ?? []).filter((g) => g.paidMoreThanOnce).length;

  const columns: Column<Row>[] = useMemo(() => [
    {
      key: 'bill', label: 'Supplier bill',
      render: (r) => (r.first ? (
        <span>
          <strong>{r.group.supplierName ?? r.group.supplierCode ?? 'Unknown supplier'}</strong>
          <span style={soft}> · {r.supplierInvoiceRef ?? r.group.billKey} · {r.group.copies.length} copies</span>
          {r.group.paidMoreThanOnce && <> <span style={flag}>Money on more than one copy</span></>}
        </span>
      ) : <span style={soft}>same bill</span>),
      getValue: (r) => `${r.group.supplierName ?? ''} ${r.group.billKey}`,
    },
    {
      key: 'doc', label: 'Document',
      render: (r) => <Link to={billHref(r.group.kind, r.id)} style={link}>{r.invoiceNumber}</Link>,
      getValue: (r) => r.invoiceNumber,
    },
    { key: 'kind', label: 'Kind', render: (r) => kindWord(r.group), getValue: (r) => kindWord(r.group) },
    { key: 'ref', label: 'Bill no. as keyed', render: (r) => r.supplierInvoiceRef ?? '—', getValue: (r) => r.supplierInvoiceRef ?? '' },
    { key: 'date', label: 'Date', render: (r) => fmtDateOrDash(r.invoiceDate), getValue: (r) => r.invoiceDate ?? '' },
    { key: 'total', label: 'Total', align: 'right', render: (r) => fmtSen(r.totalSen), getValue: (r) => r.totalSen },
    { key: 'status', label: 'Status', render: (r) => humaniseStatusKey(r.status), getValue: (r) => r.status },
    { key: 'paid', label: 'Paid', align: 'right', render: (r) => fmtSen(r.paidSen), getValue: (r) => r.paidSen },
    {
      key: 'settled', label: 'Paid or knocked off by',
      render: (r) => (r.settlements.length === 0 ? <span style={soft}>nothing</span> : (
        <span>
          {r.settlements.map((s, i) => (
            <span key={`${s.kind}-${s.id}-${i}`}>
              {i > 0 && ', '}
              {s.kind === 'PV'
                ? <Link to={`/scm/payment-vouchers/${encodeURIComponent(s.id)}`} style={link}>{s.number}</Link>
                : s.number}
              <span style={soft}> {fmtSen(s.amountSen)} ({humaniseStatusKey(s.status)})</span>
            </span>
          ))}
        </span>
      )),
      getValue: (r) => r.settlements.map((s) => s.number).join(' '),
    },
  ], []);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Finance · AP invoices" title="Duplicate supplier bills" />
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <span style={soft}>
            The same supplier bill number booked on more than one live invoice of the same supplier, from before the system refused it.
            A quotation and the formal invoice that replaces it are not counted.
            Open the wrong copy and cancel it there; one with money on it needs the payment sorted first.
            {paidTwice > 0 && <> <strong>{paidTwice} of {groups?.length} {paidTwice === 1 ? 'has' : 'have'} money on more than one copy.</strong></>}
          </span>
        </div>
        <div className={styles.cardBody} style={{ overflowX: 'auto' }}>
          <DataTable<Row>
            tableId="duplicate-supplier-bills"
            exportName="duplicate-supplier-bills"
            columns={columns}
            rows={rows}
            loading={q.isLoading}
            error={q.isError ? `The list could not be loaded — ${q.error instanceof Error ? q.error.message : 'something went wrong.'}` : null}
            emptyLabel="No supplier bill is booked twice."
            getRowKey={(r) => `${r.group.kind}-${r.id}`}
            onRowDoubleClick={(r) => openInTab(billHref(r.group.kind, r.id))}
          />
        </div>
      </section>
    </div>
  );
};
