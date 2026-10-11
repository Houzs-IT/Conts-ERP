import { useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { StatRow, StatTile, Segmented } from '../components/Metric';

/** Accounting — AP (owed to suppliers, from purchase invoices) + AR (owed by customers,
 *  from sales invoices), ported from 2990's SCM. Read-only, finance-gated. Ties the two
 *  ledgers together. Aging buckets are a follow-up. */

interface Payable { code: string; name: string; outstandingSen: number; invoices: number; overdue: number }
interface Receivable { name: string; outstandingSen: number; invoices: number; overdue: number }
interface Payload { payables: Payable[]; receivables: Receivable[]; apTotalSen: number; arTotalSen: number; restricted?: boolean; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  payables: [
    { code: 'SUP-HILTON', name: 'Hilton Bedding Manufacturing', outstandingSen: 220000, invoices: 1, overdue: 0 },
    { code: 'SUP-NORDIC', name: 'Nordic Woodcraft', outstandingSen: 378000, invoices: 1, overdue: 0 },
  ],
  receivables: [
    { name: 'Vista Jaya Residences', outstandingSen: 684000, invoices: 1, overdue: 0 },
  ],
  apTotalSen: 598000, arTotalSen: 684000,
};

export default function AccountingPage() {
  const { data, loading, error, reload } = useApi<Payload>('/accounting', FALLBACK);
  const [tab, setTab] = useState<'ap' | 'ar'>('ap');
  // Never the sample figures: until the real ones arrive (or if they are refused) the cards show a dash.
  const d: Payload = data ?? { generatedAt: '', payables: [], receivables: [], apTotalSen: 0, arTotalSen: 0 };
  const net = d.arTotalSen - d.apTotalSen;
  // A skeleton while loading, a dash if the figures never came.
  const fig = (v: string) => (data ? v : loading ? undefined : '—');

  const overdueCell = (n: number): ReactNode => <span className={cx('tabular-nums', n ? 'text-danger font-semibold' : 'text-muted-ink')}>{n || '—'}</span>;
  const apColumns = useMemo<Column<Payable>[]>(() => [
    { key: 'supplier', label: 'Supplier', value: p => p.name, hideable: false, width: 260, sub: p => p.code },
    { key: 'code', label: 'Supplier code', type: 'ref', value: p => p.code, hidden: true },
    { key: 'invoices', label: 'Open invoices', type: 'number', value: p => p.invoices, width: 120 },
    { key: 'overdue', label: 'Overdue', type: 'number', value: p => p.overdue, width: 110, render: p => overdueCell(p.overdue) },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: p => p.outstandingSen, width: 140,
      render: p => <span className="tabular-nums whitespace-nowrap font-semibold">{rm(p.outstandingSen)}</span> },
  ], []);
  const arColumns = useMemo<Column<Receivable>[]>(() => [
    { key: 'customer', label: 'Customer', value: r => r.name, hideable: false, width: 260 },
    { key: 'invoices', label: 'Open invoices', type: 'number', value: r => r.invoices, width: 120 },
    { key: 'overdue', label: 'Overdue', type: 'number', value: r => r.overdue, width: 110, render: r => overdueCell(r.overdue) },
    { key: 'outstanding', label: 'Outstanding', type: 'money', value: r => r.outstandingSen, width: 140,
      render: r => <span className="tabular-nums whitespace-nowrap font-semibold">{rm(r.outstandingSen)}</span> },
  ], []);

  if (d.restricted) return (<><PageHeader title="Accounting" sub="Payables and receivables" /><Card><div className="py-[38px] px-[22px] text-center text-[13px] text-muted-ink">Accounting figures are visible to finance roles only.</div></Card></>);

  const tabsRow = (
    <div className="py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
      <Segmented<'ap' | 'ar'> label="Ledger" value={tab} onChange={setTab}
        options={[{ key: 'ap', label: data ? `Payables (${d.payables.length})` : 'Payables' }, { key: 'ar', label: data ? `Receivables (${d.receivables.length})` : 'Receivables' }]} />
    </div>
  );

  return (
    <>
      <PageHeader title="Accounting" sub="Payables and receivables · outstanding" />

      <StatRow cols={3}>
        <StatTile label="Payables (AP)" value={fig(rm(d.apTotalSen, { cents: false }))} hint="Owed to suppliers" hintTone="warning" />
        <StatTile label="Receivables (AR)" value={fig(rm(d.arTotalSen, { cents: false }))} hint="Owed by customers" hintTone="info" />
        <StatTile className="col-span-2 sm:col-span-1" label="Net position" value={fig(rm(net, { cents: false }))}
          hint={!data ? 'Receivables less payables' : net >= 0 ? 'Receivables exceed payables' : 'Payables exceed receivables'}
          tone={!data || net >= 0 ? 'success' : 'critical'} />
      </StatRow>

      {tab === 'ap' ? (
        <DataTable<Payable>
          id="accounting.payables" urlPrefix="ap." columns={apColumns} rows={data ? d.payables : null} rowKey={p => p.code}
          loading={loading} error={error} onRetry={reload} pageSize={0}
          noun={['supplier', 'suppliers']} exportName="payables" empty={{ title: 'Nothing owed to suppliers.' }}
          header={tabsRow}
        />
      ) : (
        <DataTable<Receivable>
          id="accounting.receivables" urlPrefix="ar." columns={arColumns} rows={data ? d.receivables : null} rowKey={r => r.name}
          loading={loading} error={error} onRetry={reload} pageSize={0}
          noun={['customer', 'customers']} exportName="receivables" empty={{ title: 'Nothing owed by customers.' }}
          header={tabsRow}
        />
      )}
    </>
  );
}
