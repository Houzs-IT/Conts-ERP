import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { cx } from '../lib/design-tokens';
import { schedFallback, type Sched, type SchedPayload, type TimeSlot } from '../lib/schedule';

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
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [slotEdits, setSlotEdits] = useState<Record<string, TimeSlot>>({});
  const [timeEdits, setTimeEdits] = useState<Record<string, string>>({});

  const all = useMemo(() => (data?.data ?? []).map(r => ({ ...r, timeSlot: slotEdits[r.id] ?? r.timeSlot, plannedTime: timeEdits[r.id] ?? r.plannedTime })), [data, slotEdits, timeEdits]);
  const rows = all.filter(r => r.plannedDate && r.status !== 'CANCELLED' && r.status !== 'DELIVERED');

  function setSlot(r: Sched, value: TimeSlot) { setSlotEdits(e => ({ ...e, [r.id]: value })); api.patch(`/delivery-schedule/${r.id}`, { timeSlot: value || null }).catch(notifyFailure); toast({ tone: 'success', title: 'Time slot set.', body: r.soDocNo }); }
  function setTime(r: Sched, value: string) { setTimeEdits(e => ({ ...e, [r.id]: value })); api.patch(`/delivery-schedule/${r.id}`, { plannedTime: value || null }).catch(notifyFailure); }

  return (
    <>
      <PageHeader title="Delivery time arrangement" sub="Assign a time slot to each dated delivery" />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line)]">
              {['Sales order', 'Customer', 'Date', 'Time slot', 'Specific time'].map(h => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">No dated deliveries.</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Give deliveries a date first in Delivery date arrangement.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.soDocNo}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)] tabular-nums">{date(r.plannedDate)}</td>
                  <td className="py-[13px] px-4">
                    <select disabled={!canWrite} value={r.timeSlot} onChange={e => setSlot(r, e.target.value as TimeSlot)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer disabled:opacity-60">
                      <option value="">Any</option><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option><option value="EVENING">Evening</option>
                    </select>
                  </td>
                  <td className="py-[13px] px-4"><input type="time" disabled={!canWrite} value={r.plannedTime} onChange={e => setTime(r, e.target.value)} className={cx('h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:opacity-60')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
