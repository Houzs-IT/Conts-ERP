import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm, date } from '../lib/format';
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
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

export default function UnbilledDeliveriesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/unbilled-deliveries', FALLBACK);
  const [search, setSearch] = useState('');

  const all = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => all.filter(r => !q || `${r.doNumber} ${r.customerName} ${r.soDocNo}`.toLowerCase().includes(q)), [all, q]);
  const shownTotal = rows.reduce((s, r) => s + r.totalSen, 0);

  return (
    <>
      <PageHeader title="Unbilled deliveries" sub={`${all.length} delivery orders awaiting a sales invoice`} />

      {error && <StaleBanner message={`Showing the last unbilled list we have. ${error}`} onRetry={reload} />}

      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink">Uninvoiced value</span>
          <span className="text-[22px] font-semibold tabular-nums">{rm(shownTotal)}</span>
        </div>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search DO, SO or customer..." aria-label="Search unbilled deliveries"
            className="h-9 box-border pl-10 pr-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[280px] max-w-full" />
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
                {['Delivery order', 'Customer', 'Sales order', 'Delivered', 'Waiting', 'Lines', 'Value'].map((h, i) => (
                  <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i >= 4 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && all.length === 0 ? (
                <tr><td colSpan={7}><TableSkeleton rows={5} cols={7} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7}>
                  <div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center">
                    <span className="text-[14px] font-semibold">{q ? 'No deliveries match.' : 'Everything delivered has been billed.'}</span>
                    <span className="text-[12.5px] text-muted-ink max-w-[380px]">Delivery orders show here until a sales invoice is raised against them.</span>
                  </div>
                </td></tr>
              ) : rows.map(r => {
                const age = ageDays(r.doDate);
                return (
                  <tr key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                    <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.doNumber}</td>
                    <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                    <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[12px] text-muted-ink">{r.soDocNo || '—'}</td>
                    <td className="py-[13px] px-4 text-right text-[13px] text-[var(--color-ink-2)] tabular-nums">{r.doDate ? date(r.doDate) : '—'}</td>
                    <td className="py-[13px] px-4 text-right"><span className={cx('inline-block tabular-nums text-[12.5px] font-semibold', age >= 14 ? TONE.critical.text : 'text-muted-ink')}>{age}d</span></td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px] text-muted-ink">{r.lineCount}</td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px] font-semibold">{rm(r.totalSen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
