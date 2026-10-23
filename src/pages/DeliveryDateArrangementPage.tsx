import { mayWork } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { DateField } from '../components/inputs';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { date } from '../lib/format';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
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
  const canWrite = mayWork(user, 'scTransportPlan');
  const [edits, setEdits] = useState<Record<string, string>>({});
  useResetOnReload(data, () => { setEdits({}); });
  const [onlyUndated, setOnlyUndated] = useState(true);

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, plannedDate: edits[r.id] ?? r.plannedDate })), [data, edits]);
  const rows = all.filter(r => r.status !== 'CANCELLED' && r.status !== 'DELIVERED' && (!onlyUndated || !r.plannedDate));

  function setDate(r: Sched, value: string) {
    setEdits(e => ({ ...e, [r.id]: value }));
    persist(api.patch(`/delivery-schedule/${r.id}`, { plannedDate: value || null }), { reload, ok: () => { if (value) toast({ tone: 'success', title: 'Delivery date set.', body: `${r.soDocNo} · ${date(value)}` }); } });
  }

  const columns = useMemo<Column<Sched>[]>(() => [
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo, hideable: false, render: r => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold whitespace-nowrap">{r.soDocNo}</span> },
    { key: 'customer', label: 'Customer', value: r => r.customerName },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'delivery_schedule' },
    { key: 'date', label: 'Planned date', type: 'date', value: r => r.plannedDate, align: 'right', width: 170, render: r => <span onClick={e => e.stopPropagation()}><DateField aria-label={`Planned date for ${r.soDocNo}`} disabled={!canWrite} value={r.plannedDate} onChange={v => setDate(r, v)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60" /></span> },
  ], [canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Delivery date arrangement" sub="Give each queued delivery a planned date" />
      <DataTable<Sched>
        id="scm.delivery-date-arrangement" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['delivery', 'deliveries']} exportName="delivery-dates"
        toolbar={<label className="flex items-center gap-2.5 cursor-pointer text-[13px] text-muted-ink"><input type="checkbox" checked={onlyUndated} onChange={e => setOnlyUndated(e.target.checked)} className="w-4 h-4 accent-black cursor-pointer" />Only show deliveries without a date</label>}
        empty={onlyUndated ? { title: 'All deliveries have a date.', body: 'Uncheck the filter to amend an existing date.' } : { title: 'No deliveries queued.' }} />
    </>
  );
}
