import { useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

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
  const d = data ?? FALLBACK;
  const net = d.arTotalSen - d.apTotalSen;

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
    <div className="flex gap-2 py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]">
      <Chip label={`Payables (${d.payables.length})`} active={tab === 'ap'} onClick={() => setTab('ap')} />
      <Chip label={`Receivables (${d.receivables.length})`} active={tab === 'ar'} onClick={() => setTab('ar')} />
    </div>
  );

  return (
    <>
      <PageHeader title="Accounting" sub="Payables and receivables · outstanding" />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Stat label="Payables (AP)" value={rm(d.apTotalSen, { cents: false })} hint="Owed to suppliers" tone="warning" />
        <Stat label="Receivables (AR)" value={rm(d.arTotalSen, { cents: false })} hint="Owed by customers" tone="info" />
        <Stat label="Net position" value={rm(net, { cents: false })} hint={net >= 0 ? 'Receivables exceed payables' : 'Payables exceed receivables'} tone={net >= 0 ? 'success' : 'critical'} />
      </div>

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

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'warning' | 'info' | 'success' | 'critical' }) {
  return (
    <div className="flex flex-col gap-[3px] py-[13px] px-[15px] rounded-card bg-card border border-solid border-line">
      <span className={cx('text-[19px] font-semibold tabular-nums', TONE[tone].text)}>{value}</span>
      <span className="text-[12px] font-medium">{label}</span>
      <span className="text-[11px] text-muted-ink">{hint}</span>
    </div>
  );
}
