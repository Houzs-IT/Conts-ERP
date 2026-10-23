import { mayRun } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { TimeField } from '../components/inputs';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { SLOT_LABEL, schedFallback, type Sched, type SchedPayload, type TimeSlot } from '../lib/schedule';

/** Delivery Time Arrangement — set the time slot (and optional specific time) per dated
 *  delivery. A focused view over delivery_schedule; ported from 2990's SCM (manual). */

const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', plannedDate: '2026-09-25', timeSlot: 'MORNING', status: 'SCHEDULED', driverId: 'd1', driverName: 'Ahmad Zaki' },
  { id: 's2', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', plannedDate: '2026-09-26', timeSlot: '', status: 'UNPLANNED' },
]);

export default function DeliveryTimeArrangementPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayRun(user, 'scTransportPlan');
  const [slotEdits, setSlotEdits] = useState<Record<string, TimeSlot>>({});
  const [timeEdits, setTimeEdits] = useState<Record<string, string>>({});
  useResetOnReload(data, () => { setSlotEdits({}); setTimeEdits({}); });

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, timeSlot: slotEdits[r.id] ?? r.timeSlot, plannedTime: timeEdits[r.id] ?? r.plannedTime })), [data, slotEdits, timeEdits]);
  const rows = all.filter(r => r.plannedDate && r.status !== 'CANCELLED' && r.status !== 'DELIVERED');

  function setSlot(r: Sched, value: TimeSlot) { setSlotEdits(e => ({ ...e, [r.id]: value })); persist(api.patch(`/delivery-schedule/${r.id}`, { timeSlot: value || null }), { reload, ok: () => toast({ tone: 'success', title: 'Time slot set.', body: r.soDocNo }) }); }
  function setTime(r: Sched, value: string) { setTimeEdits(e => ({ ...e, [r.id]: value })); persist(api.patch(`/delivery-schedule/${r.id}`, { plannedTime: value || null }), { reload }); }

  const columns = useMemo<Column<Sched>[]>(() => [
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo, hideable: false, render: r => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold whitespace-nowrap">{r.soDocNo}</span> },
    { key: 'customer', label: 'Customer', value: r => r.customerName },
    { key: 'date', label: 'Date', type: 'date', value: r => r.plannedDate },
    { key: 'slot', label: 'Time slot', value: r => r.timeSlot, text: r => (r.timeSlot ? SLOT_LABEL[r.timeSlot] : 'Any'), filter: { kind: 'select' }, render: r => (
      <select disabled={!canWrite} value={r.timeSlot} onClick={e => e.stopPropagation()} onChange={e => setSlot(r, e.target.value as TimeSlot)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60">
        <option value="">Any</option><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option><option value="EVENING">Evening</option>
      </select>
    ) },
    { key: 'time', label: 'Specific time', value: r => r.plannedTime, filter: false, render: r => <span onClick={e => e.stopPropagation()}><TimeField aria-label={`Specific time for ${r.soDocNo}`} disabled={!canWrite} value={r.plannedTime} onChange={v => setTime(r, v)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60" /></span> },
  ], [canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Delivery time arrangement" sub="Assign a time slot to each dated delivery" />
      <DataTable<Sched>
        id="scm.delivery-time-arrangement" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['delivery', 'deliveries']} exportName="delivery-times"
        empty={{ title: 'No dated deliveries.', body: 'Give deliveries a date first in Delivery date arrangement.' }} />
    </>
  );
}
