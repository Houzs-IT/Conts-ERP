import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';
import { StatusPill } from './DpOrdersPage';
import { DateField, NumberInput } from '../components/inputs';
import { DRIVERS_FALLBACK, VEHICLES_FALLBACK, schedFallback, type Sched, type SchedPayload } from '../lib/schedule';

/** Delivery Planning — for a chosen day, assign a driver, vehicle and route sequence to each
 *  delivery. A focused planning board over delivery_schedule; ported from 2990's SCM as a
 *  MANUAL planner (no Google Maps auto-routing). */

const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', address: 'Mont Kiara', plannedDate: '2026-09-25', driverId: 'd1', driverName: 'Ahmad Zaki', vehicleId: 'v1', vehicleCode: 'LRY-01', sequenceNo: 1, status: 'SCHEDULED' },
  { id: 's2', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', address: 'Cyberjaya', plannedDate: '2026-09-25', status: 'UNPLANNED' },
]);
const firstDate = (rows: Sched[]) => rows.map(r => r.plannedDate).filter(Boolean).sort()[0] ?? new Date().toISOString().slice(0, 10);

export default function DeliveryPlanningPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const drivers = useApi('/drivers', DRIVERS_FALLBACK).data?.data ?? [];
  const vehicles = useApi('/vehicles', VEHICLES_FALLBACK).data?.data ?? [];
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [edits, setEdits] = useState<Record<string, Partial<Sched>>>({});
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
    api.patch(`/delivery-schedule/${r.id}`, apiBody).catch(notifyFailure);
  }
  function commitSeq(r: Sched) {
    if (!(r.id in seqDraft)) return;
    const v = seqDraft[r.id];
    if (v != null && v < 1) return;
    setSeqDraft(d => { const n = { ...d }; delete n[r.id]; return n; });
    if (v !== (r.sequenceNo ?? null)) patch(r, { sequenceNo: v }, { sequenceNo: v });
  }

  return (
    <>
      <PageHeader title="Delivery planning" sub="Assign drivers, vehicles and route order for the day" />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center gap-2.5 flex-wrap">
        <label className="text-[12px] font-medium text-muted-ink">Delivery day</label>
        <DateField aria-label="Delivery day" value={activeDay} onChange={setDay} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none" />
        <span className="text-[12.5px] text-muted-ink">{rows.length} deliveries</span>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Seq', 'Sales order', 'Customer / address', 'Driver', 'Vehicle', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 0 ? 'text-center' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && base.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={5} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">Nothing planned for this day.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Give deliveries this date in Delivery date arrangement, then assign them here.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]">
                  <td className="py-[11px] px-4 text-center"><NumberInput aria-label={`Route sequence for ${r.soDocNo}`} min={1} grouping={false} disabled={!canWrite} value={r.id in seqDraft ? seqDraft[r.id] : (r.sequenceNo ?? null)} onChange={v => setSeqDraft(d => ({ ...d, [r.id]: v }))} onBlur={() => commitSeq(r)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="h-8 w-[56px] box-border px-2 py-0 text-center font-sans text-[13px] tabular-nums text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60" /></td>
                  <td className="py-[11px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.soDocNo}</td>
                  <td className="py-[11px] px-4"><div className="flex flex-col"><span className="text-[13px]">{r.customerName}</span>{r.address && <span className="text-[11.5px] text-muted-ink">{r.address}</span>}</div></td>
                  <td className="py-[11px] px-4"><select disabled={!canWrite} value={r.driverId} onChange={e => patch(r, { driverId: e.target.value }, { driverId: e.target.value || null })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60"><option value="">Unassigned</option>{drivers.map((d: { id: string; driverCode: string; name: string }) => <option key={d.id} value={d.id}>{d.driverCode} · {d.name}</option>)}</select></td>
                  <td className="py-[11px] px-4"><select disabled={!canWrite} value={r.vehicleId} onChange={e => patch(r, { vehicleId: e.target.value }, { vehicleId: e.target.value || null })} className="h-8 box-border px-2 py-0 font-sans text-[12.5px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60"><option value="">Unassigned</option>{vehicles.map((v: { id: string; code: string }) => <option key={v.id} value={v.id}>{v.code}</option>)}</select></td>
                  <td className="py-[11px] px-4"><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
