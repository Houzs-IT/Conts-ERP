import { mayWork } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date, todayMyt } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import { CloseButton } from '../components/CloseButton';

/** Driver Leave — ported from 2990's SCM, drawn in Conts. Dated leave periods per driver so
 *  the planner knows who is unavailable. Drivers-only (Conts has no helpers). */

interface Leave { id: string; driverId: string; startDate: string; endDate: string; reason: string; driverCode: string; driverName: string }
interface Payload { data: Leave[]; generatedAt: string }
interface Driver { id: string; driverCode: string; name: string }

const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'l1', driverId: 'd1', startDate: '2026-09-24', endDate: '2026-09-26', reason: 'Annual leave', driverCode: 'DRV-001', driverName: 'Ahmad Zaki' },
  { id: 'l2', driverId: 'd2', startDate: '2026-09-30', endDate: '2026-09-30', reason: 'Medical', driverCode: 'DRV-002', driverName: 'Ravi Kumar' },
] };
const DRIVERS_FALLBACK: { data: Driver[] } = { data: [
  { id: 'd1', driverCode: 'DRV-001', name: 'Ahmad Zaki' },
  { id: 'd2', driverCode: 'DRV-002', name: 'Ravi Kumar' },
] };

function spanDays(a: string, b: string): number {
  const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}
const today = () => todayMyt();

export default function DriverLeavePage() {
  const { data, loading, error, reload } = useApi<Payload>('/driver-leave', FALLBACK);
  const drivers = useApi<{ data: Driver[] }>('/drivers', DRIVERS_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayWork(user, 'scTransportPlan');
  const [driverFilter, setDriverFilter] = useState('all');
  const [drawer, setDrawer] = useState(false);
  const [added, setAdded] = useState<Leave[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(l => !removed.has(l.id)), [added, data, removed]);
  const rows = all.filter(l => driverFilter === 'all' || l.driverId === driverFilter);

  const columns = useMemo<Column<Leave>[]>(() => [
    { key: 'driver', label: 'Driver', value: l => l.driverName, text: l => `${l.driverName} ${l.driverCode}`, hideable: false, sub: l => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[11.5px]">{l.driverCode}</span> },
    { key: 'from', label: 'From', type: 'date', value: l => l.startDate },
    { key: 'to', label: 'To', type: 'date', value: l => l.endDate },
    { key: 'days', label: 'Days', type: 'number', value: l => spanDays(l.startDate, l.endDate), width: 80, render: l => <span className={cx('inline-flex items-center text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE.info.bg, TONE.info.text)}>{spanDays(l.startDate, l.endDate)}d</span> },
    { key: 'reason', label: 'Reason', value: l => l.reason },
    { key: 'remove', label: '', noExport: true, sortable: false, filter: false, width: 56, align: 'right', phone: 'hide', render: l => canWrite ? <button onClick={e => { e.stopPropagation(); remove(l); }} aria-label="Remove leave" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><Trash2 size={15} strokeWidth={1.75} /></button> : null },
  ], [canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  function create(l: Leave) { setAdded(a => [l, ...a]); persist(api.post('/driver-leave', { driverId: l.driverId, startDate: l.startDate, endDate: l.endDate, reason: l.reason }), { reload, ok: () => toast({ tone: 'success', title: 'Leave recorded.', body: `${l.driverName} · ${date(l.startDate)}` }) }); setDrawer(false); }
  function remove(l: Leave) { setRemoved(r => new Set(r).add(l.id)); persist(api.del(`/driver-leave/${l.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Leave removed.', body: l.driverName }) }); }

  return (
    <>
      <PageHeader title="Driver leave" sub={data ? `${all.length} ${all.length === 1 ? 'leave period' : 'leave periods'} on record` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(true)}>New leave</Button> : undefined} />
      <DataTable<Leave>
        id="scm.driver-leave" columns={columns} rows={data ? rows : null} rowKey={l => l.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        noun={['leave period', 'leave periods']} exportName="driver-leave"
        toolbar={<div className="flex items-center gap-2.5 flex-wrap">
          <label className="text-[12px] font-medium text-muted-ink">Driver</label>
          <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All drivers</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.driverCode} · {d.name}</option>)}
          </select>
        </div>}
        filtered={driverFilter !== 'all'} onClearFilters={() => setDriverFilter('all')}
        empty={{ title: 'No leave recorded.', body: 'Record when a driver is away so the delivery planner can route around it.', action: canWrite ? { label: 'New leave', onClick: () => setDrawer(true) } : undefined }} />
      {drawer && <LeaveDrawer drivers={drivers} canWrite={canWrite} onClose={() => setDrawer(false)} onCreate={create} />}
    </>
  );
}

function LeaveDrawer({ drivers, canWrite, onClose, onCreate }: { drivers: Driver[]; canWrite: boolean; onClose: () => void; onCreate: (l: Leave) => void }) {
  const [driverId, setDriverId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const driver = drivers.find(d => d.id === driverId);
  const canSave = canWrite && driverId !== '' && startDate !== '' && endDate !== '' && endDate >= startDate;

  function submit() {
    onCreate({ id: `lve-new-${crypto.randomUUID().slice(0, 8)}`, driverId, startDate, endDate, reason, driverCode: driver?.driverCode ?? '', driverName: driver?.name ?? '' });
  }

  return (
    <Drawer open onClose={onClose} width={560}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">New driver leave</h2><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <label className="text-[12px] font-medium text-muted-ink">Driver</label>
          <select value={driverId} onChange={e => setDriverId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="">Select a driver…</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.driverCode} · {d.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <DateField label="From" required value={startDate} onChange={setStartDate} />
          <DateField label="To" required min={startDate || undefined} value={endDate} onChange={setEndDate} />
        </div>
        <Field label="Reason" placeholder="e.g. Annual leave" value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Pick a driver and a valid date range" onClick={submit}>Record leave</Button>
      </div>
    </Drawer>
  );
}
