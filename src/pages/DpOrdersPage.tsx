import { mayRun } from '../lib/areaAccess';
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Segmented } from '../components/Metric';
import { DataTable, type Column } from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { SLOT_LABEL, DRIVERS_FALLBACK, VEHICLES_FALLBACK, SO_FALLBACK, schedFallback, type Sched, type SchedPayload, type SchedStatus, type TimeSlot } from '../lib/schedule';
import { statusLabel } from '../lib/status';
import { StatusBadge } from '../components/StatusBadge';
import { CloseButton } from '../components/CloseButton';

/** DP Orders — the delivery-planning queue. One row per sales order to be delivered; the entry
 *  point for the Transportation scheduling cluster. Ported from 2990's SCM (manual). */

const FILTERS: (SchedStatus | 'all')[] = ['all', 'UNPLANNED', 'SCHEDULED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
const FALLBACK = schedFallback([
  { id: 's1', soDocNo: 'SO-2026-0001', customerName: 'Vista Jaya Residences', status: 'UNPLANNED' },
  { id: 's2', soDocNo: 'SO-2026-0004', customerName: 'Arcoris Owner', plannedDate: '2026-09-25', timeSlot: 'MORNING', driverId: 'd1', driverName: 'Ahmad Zaki', vehicleCode: 'LRY-01', status: 'SCHEDULED' },
]);

export default function DpOrdersPage() {
  const { data, loading, error, reload } = useApi<SchedPayload>('/delivery-schedule', FALLBACK);
  const openSos = (useApi('/sales-orders', SO_FALLBACK).data?.data ?? []).filter((s: { status: string }) => !['CANCELLED', 'CLOSED', 'DELIVERED', 'INVOICED'].includes(s.status));
  const toast = useToast();
  const { user } = useSession();
  const canWrite = mayRun(user, 'scTransportPlan');
  const [statusFilter, setStatusFilter] = useState<SchedStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'edit'; row: Sched } | null>(null);
  const [added, setAdded] = useState<Sched[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Sched>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (statusFilter === 'all' || r.status === statusFilter) && (!q || `${r.soDocNo} ${r.customerName}`.toLowerCase().includes(q)));

  const columns = useMemo<Column<Sched>[]>(() => [
    { key: 'so', label: 'Sales order', type: 'ref', value: r => r.soDocNo, hideable: false, width: 150 },
    { key: 'customer', label: 'Customer', value: r => r.customerName, width: 200 },
    { key: 'planned', label: 'Planned date', type: 'date', value: r => r.plannedDate || null, width: 130 },
    { key: 'slot', label: 'Slot', value: r => (r.timeSlot ? SLOT_LABEL[r.timeSlot] : null), text: r => `${r.timeSlot ? SLOT_LABEL[r.timeSlot] : ''}${r.plannedTime ? ` ${r.plannedTime}` : ''}`.trim(),
      render: r => <span className="text-muted-ink">{r.timeSlot ? SLOT_LABEL[r.timeSlot] : '—'}{r.plannedTime ? ` · ${r.plannedTime}` : ''}</span>, width: 120, filter: { kind: 'select' } },
    { key: 'driver', label: 'Driver / vehicle', value: r => (r.driverName || r.vehicleCode ? `${r.driverName || '—'}${r.vehicleCode ? ` · ${r.vehicleCode}` : ''}` : 'Unassigned'), width: 180 },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, entity: 'delivery_schedule', width: 130 },
  ], []);

  function created(r: Sched, req: Promise<unknown>) { setAdded(a => [r, ...a]); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Added to the schedule.', body: `${r.soDocNo} · ${r.customerName}` }) }); }
  function saved(r: Sched, req: Promise<unknown>) { setEdits(e => ({ ...e, [r.id]: { ...e[r.id], ...r } })); setDrawer(null); persist(req, { reload, ok: () => toast({ tone: 'success', title: 'Schedule updated.', body: r.soDocNo }) }); }
  function remove(r: Sched) { setRemoved(s => new Set(s).add(r.id)); setDrawer(null); persist(api.del(`/delivery-schedule/${r.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Removed from schedule.', body: r.soDocNo }) }); }

  return (
    <>
      <PageHeader title="DP orders" sub={data ? `${all.length} ${all.length === 1 ? 'delivery' : 'deliveries'} in the planning queue` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>Schedule a sales order</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <Segmented label="Status" options={FILTERS.map(f => ({ key: f, label: f === 'all' ? 'All' : statusLabel('delivery_schedule', f) }))} value={statusFilter} onChange={setStatusFilter} />
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO or customer..." aria-label="Search DP orders"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
      </div>
      <DataTable<Sched> id="dp-orders" columns={columns} rows={data || all.length ? rows : null} rowKey={r => r.id}
        loading={loading && all.length === 0} onRowClick={canWrite ? r => setDrawer({ mode: 'edit', row: r }) : undefined}
        noun={['delivery', 'deliveries']} exportName="dp-orders" pageSize={0} filtered={!!q || statusFilter !== 'all'}
        onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        empty={{ title: 'Nothing in the queue.', body: 'Add a sales order to the schedule, then arrange its date, time and driver.' }} />
      {drawer?.mode === 'new' && <NewDrawer openSos={openSos.filter((s: { id: string }) => !all.some(r => r.salesOrderId === s.id))} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'edit' && <EditDrawer row={drawer.row} onClose={() => setDrawer(null)} onSaved={saved} onDelete={() => remove(drawer.row)} />}
    </>
  );
}

function NewDrawer({ openSos, onClose, onCreated }: { openSos: { id: string; docNo: string; customerName: string }[]; onClose: () => void; onCreated: (r: Sched, req: Promise<unknown>) => void }) {
  const [soId, setSoId] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [notes, setNotes] = useState('');
  const so = openSos.find(s => s.id === soId);
  function submit() {
    const req = api.post('/delivery-schedule', { salesOrderId: soId, plannedDate: plannedDate || null, notes });
    onCreated(schedFallback([{ id: `dsch-new-${crypto.randomUUID().slice(0, 8)}`, salesOrderId: soId, soDocNo: so?.docNo ?? '', customerName: so?.customerName ?? '', plannedDate, notes, status: 'UNPLANNED' }]).data[0], req);
  }
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">Schedule a sales order</h2><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Sales order</label>
          <select value={soId} onChange={e => setSoId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="">Select a sales order…</option>
            {openSos.map(s => <option key={s.id} value={s.id}>{s.docNo} · {s.customerName}</option>)}
          </select>
        </div>
        <DateField label="Planned date (optional)" value={plannedDate} onChange={setPlannedDate} />
        <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={soId === ''} disabledReason="Pick a sales order" onClick={submit}>Add to schedule</Button>
      </div>
    </Drawer>
  );
}

function EditDrawer({ row, onClose, onSaved, onDelete }: { row: Sched; onClose: () => void; onSaved: (r: Sched, req: Promise<unknown>) => void; onDelete: () => void }) {
  const drivers = useApi('/drivers', DRIVERS_FALLBACK).data?.data ?? [];
  const vehicles = useApi('/vehicles', VEHICLES_FALLBACK).data?.data ?? [];
  const [f, setF] = useState<Sched>(row);
  function save() {
    const driverName = drivers.find((d: { id: string }) => d.id === f.driverId)?.name ?? '';
    const vehicleCode = vehicles.find((v: { id: string }) => v.id === f.vehicleId)?.code ?? '';
    const status: SchedStatus = (row.status === 'DISPATCHED' || row.status === 'DELIVERED' || row.status === 'CANCELLED') ? row.status : (f.plannedDate && f.driverId ? 'SCHEDULED' : 'UNPLANNED');
    const req = api.patch(`/delivery-schedule/${row.id}`, { plannedDate: f.plannedDate || null, timeSlot: f.timeSlot || null, plannedTime: f.plannedTime || null, driverId: f.driverId || null, vehicleId: f.vehicleId || null, sequenceNo: f.sequenceNo, notes: f.notes });
    onSaved({ ...f, driverName, vehicleCode, status }, req);
  }
  return (
    <Drawer open onClose={onClose} width={560}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{row.soDocNo}</h2><StatusBadge entity="delivery_schedule" value={f.status} /></div><CloseButton onClick={onClose} /></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="text-[13px] text-muted-ink">{row.customerName}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <DateField label="Planned date" value={f.plannedDate} onChange={v => setF(s => ({ ...s, plannedDate: v }))} />
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Time slot</label>
            <select value={f.timeSlot} onChange={e => setF(s => ({ ...s, timeSlot: e.target.value as TimeSlot }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Any</option><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option><option value="EVENING">Evening</option>
            </select>
          </div>
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Driver</label>
            <select value={f.driverId} onChange={e => setF(s => ({ ...s, driverId: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Unassigned</option>{drivers.map((d: { id: string; driverCode: string; name: string }) => <option key={d.id} value={d.id}>{d.driverCode} · {d.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Vehicle</label>
            <select value={f.vehicleId} onChange={e => setF(s => ({ ...s, vehicleId: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Unassigned</option>{vehicles.map((v: { id: string; code: string; plate: string }) => <option key={v.id} value={v.id}>{v.code}{v.plate ? ` · ${v.plate}` : ''}</option>)}
            </select>
          </div>
        </div>
        <Field label="Notes" placeholder="Optional" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Remove ${row.soDocNo} from the schedule?`, body: 'It comes off the delivery planning queue for good. The sales order itself does not change.', meta: row.customerName, confirmLabel: 'Remove from schedule', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Remove</ConfirmButton>
        <div className="flex gap-2.5"><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save</Button></div>
      </div>
    </Drawer>
  );
}
