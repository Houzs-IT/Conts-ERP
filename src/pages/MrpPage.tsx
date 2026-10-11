import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { cx } from '../lib/design-tokens';

/** MRP — material requirements planning (first cut), ported from 2990's SCM. Per item:
 *  open sales demand − on-hand − on-order = net to buy. Read-only. Lead-time / lot-size /
 *  BOM explosion are follow-ups. */

interface Row { itemCode: string; itemName: string; demand: number; onHand: number; onOrder: number; net: number }
interface Payload { data: Row[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { itemCode: 'SF-3S-GRY', itemName: 'Emma 3-Seater Sofa', demand: 2, onHand: 4, onOrder: 0, net: 0 },
    { itemCode: 'BF-KG-OAK', itemName: 'Nordic Bedframe, Oak', demand: 1, onHand: 2, onOrder: 0, net: 0 },
    { itemCode: 'MT-KG-HIL', itemName: 'Hilton Mattress, King', demand: 3, onHand: 1, onOrder: 1, net: 1 },
    { itemCode: 'DN-TBL-6', itemName: 'Solid Oak Dining Table, 6-Seat', demand: 4, onHand: 0, onOrder: 0, net: 4 },
  ],
};

export default function MrpPage() {
  const { data, loading, error, reload } = useApi<Payload>('/mrp', FALLBACK);
  const [search, setSearch] = useState('');
  const [shortfallOnly, setShortfallOnly] = useState(false);

  const q = search.trim().toLowerCase();
  const rows = (data?.data ?? []).filter(r => (!q || `${r.itemCode} ${r.itemName}`.toLowerCase().includes(q)) && (!shortfallOnly || r.net > 0));
  const totalNet = (data?.data ?? []).reduce((s, r) => s + r.net, 0);
  const shortItems = (data?.data ?? []).filter(r => r.net > 0).length;

  const columns = useMemo<Column<Row>[]>(() => [
    { key: 'code', label: 'Item code', type: 'ref', value: r => r.itemCode, hideable: false },
    { key: 'name', label: 'Description', value: r => r.itemName || null },
    { key: 'demand', label: 'Demand', type: 'number', value: r => r.demand },
    { key: 'onHand', label: 'On hand', type: 'number', value: r => r.onHand, render: r => <span className="tabular-nums text-muted-ink">{r.onHand}</span> },
    { key: 'onOrder', label: 'On order', type: 'number', value: r => r.onOrder, render: r => <span className="tabular-nums text-muted-ink">{r.onOrder}</span> },
    { key: 'net', label: 'Net to buy', type: 'number', value: r => r.net, render: r => <span className={cx('tabular-nums text-[14px] font-semibold', r.net > 0 ? 'text-danger' : 'text-muted-ink')}>{r.net > 0 ? r.net : '—'}</span> },
  ], []);

  return (
    <>
      <PageHeader title="MRP" sub={data ? `${shortItems} ${shortItems === 1 ? 'item' : 'items'} short · ${totalNet} ${totalNet === 1 ? 'unit' : 'units'} to buy` : '\u00a0'} />
      <DataTable<Row>
        id="scm.mrp" columns={columns} rows={data ? rows : null} rowKey={r => r.itemCode}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['item', 'items']} exportName="mrp"
        toolbar={<>
          <button onClick={() => setShortfallOnly(v => !v)} aria-pressed={shortfallOnly}
            className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', shortfallOnly ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>Shortfall only</button>
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item..." aria-label="Search requirements"
              className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
          </div>
        </>}
        filtered={!!q} onClearFilters={() => { setSearch(''); setShortfallOnly(false); }}
        empty={{ title: shortfallOnly ? 'Nothing short — stock and orders cover demand.' : 'No open demand.' }} />
    </>
  );
}
