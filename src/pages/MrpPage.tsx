import { useState } from 'react';
import { Search } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
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

  return (
    <>
      <PageHeader title="MRP" sub={`${shortItems} items short · ${totalNet} units to buy`} />
      {error && <StaleBanner message={`Showing the last requirements we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <button onClick={() => setShortfallOnly(v => !v)} aria-pressed={shortfallOnly}
          className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', shortfallOnly ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>Shortfall only</button>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item..." aria-label="Search requirements"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
        </div>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Item code', 'Description', 'Demand', 'On hand', 'On order', 'Net to buy'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i >= 2 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={6} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">{shortfallOnly ? 'Nothing short — stock and orders cover demand.' : 'No open demand.'}</div></td></tr>
              : rows.map(r => (
                <tr key={r.itemCode} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.itemCode}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.itemName || '—'}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{r.demand}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] text-muted-ink">{r.onHand}</td>
                  <td className="py-[13px] px-4 text-right tabular-nums text-[13px] text-muted-ink">{r.onOrder}</td>
                  <td className={cx('py-[13px] px-4 text-right tabular-nums text-[14px] font-semibold', r.net > 0 ? 'text-[var(--color-critical-fg)]' : 'text-muted-ink')}>{r.net > 0 ? r.net : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
