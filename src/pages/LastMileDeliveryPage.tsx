import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { SLOT_LABEL, schedFallback, type Sched, type SchedPayload, type SchedStatus } from '../lib/schedule';

/** Last Mile Delivery — dispatch scheduled deliveries and mark them delivered. A focused view
 *  over delivery_schedule; ported from 2990's SCM (manual). */

const FILTERS: ('active' | 'SCHEDULED' | 'DISPATCHED' | 'DELIVERED')[] = ['active', 'SCHEDULED', 'DISPATCHED', 'DELIVERED'];
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { active: 'All open', SCHEDULED: 'Scheduled', DISPATCHED: 'In transit', DELIVERED: 'Delivered' };
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
  useResetOnReload(data, () => { setEdits({}); });

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, status: edits[r.id] ?? r.status })), [data, edits]);
  const rows = all.filter(r => filter === 'active' ? (r.status === 'SCHEDULED' || r.status === 'DISPATCHED') : r.status === filter);

  function act(r: Sched, action: 'dispatch' | 'deliver', next: SchedStatus, label: string) {
    setEdits(e => ({ ...e, [r.id]: next }));
    persist(api.patch(`/delivery-schedule/${r.id}`, { action }), { reload, ok: () => toast({ tone: 'success', title: label, body: `${r.soDocNo} · ${r.customerName}` }) });
  }

  const columns = useMemo<Column<Sched>[]>(() => [
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo, hideable: false, render: r => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold whitespace-nowrap">{r.soDocNo}</span> },
    { key: 'customer', label: 'Customer', value: r => r.customerName },
    { key: 'date', label: 'Date / slot', type: 'date', value: r => r.plannedDate, render: r => <span className="text-[12.5px] text-muted-ink tabular-nums whitespace-nowrap">{r.plannedDate ? date(r.plannedDate) : '—'}{r.timeSlot ? ` · ${SLOT_LABEL[r.timeSlot]}` : ''}</span> },
    { key: 'crew', label: 'Driver / vehicle', value: r => (r.driverName || r.vehicleCode ? `${r.driverName || '—'}${r.vehicleCode ? ` · ${r.vehicleCode}` : ''}` : 'Unassigned') },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'delivery_schedule' },
    { key: 'act', label: '', noExport: true, sortable: false, filter: false, width: 150, align: 'right', render: r => <>
      {canWrite && r.status === 'SCHEDULED' && <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); act(r, 'dispatch', 'DISPATCHED', 'Dispatched.'); }}>Dispatch</Button>}
      {canWrite && r.status === 'DISPATCHED' && <Button size="sm" variant="primary" onClick={e => { e.stopPropagation(); act(r, 'deliver', 'DELIVERED', 'Marked delivered.'); }}>Mark delivered</Button>}
    </> },
  ], [canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Last mile delivery" sub="Dispatch scheduled deliveries and confirm they arrived" />
      <DataTable<Sched>
        id="scm.last-mile-delivery" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['delivery', 'deliveries']} exportName="last-mile-delivery"
        toolbar={<Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: FILTER_LABEL[f] }))} value={filter} onChange={setFilter} />}
        empty={{ title: 'Nothing here.', body: 'Scheduled deliveries appear here to dispatch and confirm.' }} />
    </>
  );
}
