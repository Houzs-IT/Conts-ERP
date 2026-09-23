import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';
import { StatusPill } from './DpOrdersPage';
import { schedFallback, type Sched, type SchedPayload } from '../lib/schedule';

/** Delivery Date Arrangement — set/amend the planned delivery date per queued sales order.
 *  A focused view over delivery_schedule; ported from 2990's SCM (manual). */

const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'UNPLANNED' },
  { id: 's2', soDocNo: 'SO-2026-0002', customerName: 'Emporium Suites', status: 'UNPLANNED' },
]);

export default function DeliveryDateArrangementPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [onlyUndated, setOnlyUndated] = useState(true);

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, plannedDate: edits[r.id] ?? r.plannedDate })), [data, edits]);
  const rows = all.filter(r => r.status !== 'CANCELLED' && r.status !== 'DELIVERED' && (!onlyUndated || !r.plannedDate));

  function setDate(r: Sched, value: string) {
    setEdits(e => ({ ...e, [r.id]: value }));
    api.patch(`/delivery-schedule/${r.id}`, { plannedDate: value || null }).catch(notifyFailure);
    if (value) toast({ tone: 'success', title: 'Delivery date set.', body: `${r.soDocNo} · ${value}` });
  }

  return (
    <>
      <PageHeader title="Delivery date arrangement" sub="Give each queued delivery a planned date" />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <label className="flex items-center gap-2.5 cursor-pointer text-[13px] text-muted-ink"><input type="checkbox" checked={onlyUndated} onChange={e => setOnlyUndated(e.target.checked)} className="w-4 h-4 accent-black cursor-pointer" />Only show deliveries without a date</label>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Sales order', 'Customer', 'Status', 'Planned date'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={4}><TableSkeleton rows={5} cols={4} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={4}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">All deliveries have a date.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Uncheck the filter to amend an existing date.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.soDocNo}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                  <td className="py-[13px] px-4"><StatusPill status={r.status} /></td>
                  <td className="py-[13px] px-4 text-right"><input type="date" disabled={!canWrite} value={r.plannedDate} onChange={e => setDate(r, e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
