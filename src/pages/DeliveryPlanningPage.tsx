import { mayRun } from '../lib/areaAccess';
import { todayMyt } from '../lib/format';
import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useSession } from '../lib/session';
import { DateField, NumberInput } from '../components/inputs';
import { DRIVERS_FALLBACK, VEHICLES_FALLBACK, schedFallback, type Sched, type SchedPayload } from '../lib/schedule';
/** Delivery Planning — for a chosen day, assign a driver, vehicle and route sequence to each
 *  delivery. A focused planning board over delivery_schedule; ported from 2990's SCM as a
 *  MANUAL planner (no Google Maps auto-routing). */

const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', address: 'Mont Kiara', plannedDate: '2026-09-25', driverId: 'd1', driverName: 'Ahmad Zaki', vehicleId: 'v1', vehicleCode: 'LRY-01', sequenceNo: 1, status: 'SCHEDULED' },
  { id: 's2', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', address: 'Cyberjaya', plannedDate: '2026-09-25', status: 'UNPLANNED' },
]);
const firstDate = (rows: Sched[]) => rows.map(r => r.plannedDate).filter(Boolean).sort()[0] ?? todayMyt();

export default function DeliveryPlanningPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const drivers = useApi('/drivers', DRIVERS_FALLBACK).data?.data ?? [];
  const vehicles = useApi('/vehicles', VEHICLES_FALLBACK).data?.data ?? [];
  const { user } = useSession();
  const canWrite = mayRun(user, 'scTransportPlan');
  const [edits, setEdits] = useState<Record<string, Partial<Sched>>>({});
  useResetOnReload(data, () => { setEdits({}); });
  const [day, setDay] = useState<string>('');
  // Sequence edits are held until the field is left so the list does not re-sort under the cursor mid-typing.
  const [seqDraft, setSeqDraft] = useState<Record<string, number | null>>({});

  const base = useMemo(() => (data?.data ?? []).map(r => ({ ...r, ...edits[r.id] })), [data, edits]);
  const activeDay = day || firstDate(base);
  const rows = base.filter(r => r.plannedDate === activeDay && r.status !== 'CANCELLED' && r.status !== 'DELIVERED').sort((a, b) => (a.sequenceNo ?? 99) - (b.sequenceNo ?? 99));

  function patch(r: Sched, body: Partial<Sched>, apiBody: Record<string, unknown>) {
    const driverName = body.driverId !== undefined ? (drivers.find((d: { id: string }) => d.id === body.driverId)?.name ?? '') : r.driverName;
    const vehicleCode = body.vehicleId !== undefined ? (vehicles.find((v: { id: string }) => v.id === body.vehicleId)?.code ?? '') : r.vehicleCode;
    const merged = { ...r, ...body, driverName, vehicleCode };
    const status = (r.status === 'DISPATCHED' || r.status === 'DELIVERED') ? r.status : (merged.plannedDate && merged.driverId ? 'SCHEDULED' as const : 'UNPLANNED' as const);
    setEdits(e => ({ ...e, [r.id]: { ...e[r.id], ...body, driverName, vehicleCode, status } }));
    persist(api.patch(`/delivery-schedule/${r.id}`, apiBody), { reload });
  }
  function commitSeq(r: Sched) {
    if (!(r.id in seqDraft)) return;
    const v = seqDraft[r.id];
    if (v != null && v < 1) return;
    setSeqDraft(d => { const n = { ...d }; delete n[r.id]; return n; });
    if (v !== (r.sequenceNo ?? null)) patch(r, { sequenceNo: v }, { sequenceNo: v });
  }

  const columns = useMemo<Column<Sched>[]>(() => [
    { key: 'seq', label: 'Seq', type: 'number', value: r => r.sequenceNo, align: 'center', width: 80, filter: false, render: r => <span onClick={e => e.stopPropagation()}><NumberInput aria-label={`Route sequence for ${r.soDocNo}`} min={1} grouping={false} disabled={!canWrite} value={r.id in seqDraft ? seqDraft[r.id] : (r.sequenceNo ?? null)} onChange={v => setSeqDraft(d => ({ ...d, [r.id]: v }))} onBlur={() => commitSeq(r)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="h-8 w-[56px] box-border px-2 py-0 text-center font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60" /></span> },
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo, hideable: false, render: r => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold whitespace-nowrap">{r.soDocNo}</span> },
    { key: 'customer', label: 'Customer / address', value: r => r.customerName, text: r => `${r.customerName} ${r.address}`, sub: r => r.address || null },
    { key: 'driver', label: 'Driver', value: r => r.driverName, render: r => <select disabled={!canWrite} value={r.driverId} onClick={e => e.stopPropagation()} onChange={e => patch(r, { driverId: e.target.value }, { driverId: e.target.value || null })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60"><option value="">Unassigned</option>{drivers.map((d: { id: string; driverCode: string; name: string }) => <option key={d.id} value={d.id}>{d.driverCode} · {d.name}</option>)}</select> },
    { key: 'vehicle', label: 'Vehicle', value: r => r.vehicleCode, render: r => <select disabled={!canWrite} value={r.vehicleId} onClick={e => e.stopPropagation()} onChange={e => patch(r, { vehicleId: e.target.value }, { vehicleId: e.target.value || null })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60"><option value="">Unassigned</option>{vehicles.map((v: { id: string; code: string }) => <option key={v.id} value={v.id}>{v.code}</option>)}</select> },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'delivery_schedule' },
  ], [canWrite, drivers, vehicles, seqDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Delivery planning" sub="Assign drivers, vehicles and route order for the day" />
      <DataTable<Sched>
        id="scm.delivery-planning" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['delivery', 'deliveries']} exportName="delivery-planning"
        toolbar={<div className="flex items-center gap-2.5 flex-wrap">
          <label className="text-[12px] font-medium text-muted-ink">Delivery day</label>
          <DateField aria-label="Delivery day" value={activeDay} onChange={setDay} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
          {data && <span className="text-[12.5px] text-muted-ink">{rows.length} {rows.length === 1 ? 'delivery' : 'deliveries'}</span>}
        </div>}
        empty={{ title: 'Nothing planned for this day.', body: 'Give deliveries this date in Delivery date arrangement, then assign them here.' }} />
    </>
  );
}
