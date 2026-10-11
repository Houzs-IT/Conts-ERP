import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { StatRow, StatTile } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

/** Unbilled deliveries — ported from 2990's SCM, drawn in Conts. Read-only AR report:
 *  delivery orders dispatched but not yet billed (no active sales invoice). Money sen. */

interface Row { id: string; doNumber: string; customerName: string; doDate: string; status: string; soDocNo: string; totalSen: number; lineCount: number }
interface Payload { data: Row[]; totalSen: number; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '', totalSen: 517000,
  data: [
    { id: 'do1', doNumber: 'DO-2026-0002', customerName: 'Arcoris Owner', doDate: '2026-09-18', status: 'DELIVERED', soDocNo: 'SO-2026-0004', totalSen: 189000, lineCount: 1 },
    { id: 'do2', doNumber: 'DO-2026-0003', customerName: 'Vista Jaya Residences', doDate: '2026-09-20', status: 'SIGNED', soDocNo: 'SO-2026-0001', totalSen: 328000, lineCount: 2 },
  ],
};

function ageDays(iso: string): number {
  const d = new Date(iso + 'T00:00:00'); if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

export default function UnbilledDeliveriesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/unbilled-deliveries', FALLBACK);
  const [search, setSearch] = useState('');

  const all = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => all.filter(r => !q || `${r.doNumber} ${r.customerName} ${r.soDocNo}`.toLowerCase().includes(q)), [all, q]);
  const shownTotal = rows.reduce((s, r) => s + r.totalSen, 0);

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'do', label: 'Delivery order', type: 'ref', value: r => r.doNumber, hideable: false },
    { key: 'customer', label: 'Customer', value: r => r.customerName },
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo || null },
    { key: 'delivered', label: 'Delivered', type: 'date', value: r => r.doDate || null },
    { key: 'waiting', label: 'Waiting', type: 'number', value: r => ageDays(r.doDate), title: 'Days since delivery', render: r => { const age = ageDays(r.doDate); return <span className={cx('tabular-nums text-[12.5px] font-semibold', age >= 14 ? TONE.critical.text : 'text-muted-ink')}>{age}d</span>; } },
    { key: 'lines', label: 'Lines', type: 'number', value: r => r.lineCount },
    { key: 'value', label: 'Value', type: 'money', value: r => r.totalSen },
  ], []);

  return (
    <>
      <PageHeader title="Unbilled deliveries" sub={data ? `${all.length} ${all.length === 1 ? 'delivery order' : 'delivery orders'} awaiting a sales invoice` : '\u00a0'} />
      <StatRow cols={4}>
        <StatTile hero label="Uninvoiced value" value={data ? rm(shownTotal) : undefined} />
      </StatRow>
      <DataTable<Row>
        id="scm.unbilled-deliveries" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['delivery order', 'delivery orders']} exportName="unbilled-deliveries"
        toolbar={<div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search DO, SO or customer..." aria-label="Search unbilled deliveries"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
        </div>}
        filtered={!!q} onClearFilters={() => setSearch('')}
        empty={{ title: 'Everything delivered has been billed.', body: 'Delivery orders show here until a sales invoice is raised against them.' }} />
    </>
  );
}
