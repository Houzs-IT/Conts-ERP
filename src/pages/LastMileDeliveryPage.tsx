import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { SLOT_LABEL, schedFallback, type Sched, type SchedPayload, type SchedStatus } from '../lib/schedule';
import { StatusBadge } from '../components/StatusBadge';

/** Last Mile Delivery — dispatch scheduled deliveries and mark them delivered. A focused view
 *  over delivery_schedule; ported from 2990's SCM (manual). */

const FILTERS: ('active' | 'SCHEDULED' | 'DISPATCHED' | 'DELIVERED')[] = ['active', 'SCHEDULED', 'DISPATCHED', 'DELIVERED'];
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { active: 'Out today', SCHEDULED: 'Scheduled', DISPATCHED: 'In transit', DELIVERED: 'Delivered' };
const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', plannedDate: '2026-09-25', timeSlot: 'MORNING', driverName: 'Ahmad Zaki', vehicleCode: 'LRY-01', status: 'SCHEDULED' },
  { id: 's2', soDocNo: 'SO-2026-0003', customerName: 'Emporium Suites', plannedDate: '2026-09-25', timeSlot: 'AFTERNOON', driverName: 'Ravi Kumar', vehicleCode: 'LRY-02', status: 'DISPATCHED' },
]);

export default function LastMileDeliveryPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('active');
  const [edits, setEdits] = useState<Record<string, SchedStatus>>({});

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, status: edits[r.id] ?? r.status })), [data, edits]);
  const rows = all.filter(r => filter === 'active' ? (r.status === 'SCHEDULED' || r.status === 'DISPATCHED') : r.status === filter);

  function act(r: Sched, action: 'dispatch' | 'deliver', next: SchedStatus, label: string) {
    setEdits(e => ({ ...e, [r.id]: next }));
    api.patch(`/delivery-schedule/${r.id}`, { action }).catch(notifyFailure);
    toast({ tone: 'success', title: label, body: `${r.soDocNo} · ${r.customerName}` });
  }

  return (
    <>
      <PageHeader title="Last mile delivery" sub="Dispatch scheduled deliveries and confirm they arrived" />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', filter === f ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{FILTER_LABEL[f]}</button>)}</div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line)]">
              {['Sales order', 'Customer', 'Date / slot', 'Driver / vehicle', 'Status', ''].map((h, i) => <th key={i} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 5 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={5} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">Nothing here.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Scheduled deliveries appear here to dispatch and confirm.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.soDocNo}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink tabular-nums">{r.plannedDate ? date(r.plannedDate) : '—'}{r.timeSlot ? ` · ${SLOT_LABEL[r.timeSlot]}` : ''}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{r.driverName || r.vehicleCode ? `${r.driverName || '—'}${r.vehicleCode ? ` · ${r.vehicleCode}` : ''}` : 'Unassigned'}</td>
                  <td className="py-[13px] px-4"><StatusBadge entity="delivery_schedule" value={r.status} /></td>
                  <td className="py-[13px] px-4 text-right">
                    {canWrite && r.status === 'SCHEDULED' && <Button size="sm" variant="secondary" onClick={() => act(r, 'dispatch', 'DISPATCHED', 'Dispatched.')}>Dispatch</Button>}
                    {canWrite && r.status === 'DISPATCHED' && <Button size="sm" variant="primary" onClick={() => act(r, 'deliver', 'DELIVERED', 'Marked delivered.')}>Mark delivered</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
