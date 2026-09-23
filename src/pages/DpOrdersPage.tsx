import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import { STATUS_LABEL, STATUS_TONE, SLOT_LABEL, DRIVERS_FALLBACK, VEHICLES_FALLBACK, SO_FALLBACK, schedFallback, type Sched, type SchedPayload, type SchedStatus, type TimeSlot } from '../lib/schedule';

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
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [statusFilter, setStatusFilter] = useState<SchedStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'new' } | { mode: 'edit'; row: Sched } | null>(null);
  const [added, setAdded] = useState<Sched[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Sched>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (statusFilter === 'all' || r.status === statusFilter) && (!q || `${r.soDocNo} ${r.customerName}`.toLowerCase().includes(q)));

  function created(r: Sched) { setAdded(a => [r, ...a]); toast({ tone: 'success', title: 'Added to the schedule.', body: `${r.soDocNo} · ${r.customerName}` }); setDrawer(null); }
  function saved(r: Sched) { setEdits(e => ({ ...e, [r.id]: { ...e[r.id], ...r } })); toast({ tone: 'success', title: 'Schedule updated.', body: r.soDocNo }); setDrawer(null); }
  function remove(r: Sched) { setRemoved(s => new Set(s).add(r.id)); api.del(`/delivery-schedule/${r.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Removed from schedule.', body: r.soDocNo }); setDrawer(null); }

  return (
    <>
      <PageHeader title="DP orders" sub={`${all.length} deliveries in the planning queue`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ mode: 'new' })}>Schedule a sales order</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last schedule we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">{FILTERS.map(f => <Chip key={f} label={f === 'all' ? 'All' : STATUS_LABEL[f]} active={statusFilter === f} onClick={() => setStatusFilter(f)} />)}</div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SO or customer..." aria-label="Search DP orders"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[240px] max-w-full" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Sales order', 'Customer', 'Planned date', 'Slot', 'Driver / vehicle', 'Status'].map(h => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={5} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || statusFilter !== 'all' ? 'No deliveries match.' : 'Nothing in the queue.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Add a sales order to the schedule, then arrange its date, time and driver.</span></div></td></tr>
              : rows.map(r => (
                <tr key={r.id} onClick={() => { if (canWrite) setDrawer({ mode: 'edit', row: r }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4 [font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.soDocNo}</td>
                  <td className="py-[13px] px-4 text-[13.5px]">{r.customerName}</td>
                  <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)] tabular-nums">{r.plannedDate ? date(r.plannedDate) : '—'}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{r.timeSlot ? SLOT_LABEL[r.timeSlot] : '—'}{r.plannedTime ? ` · ${r.plannedTime}` : ''}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink">{r.driverName || r.vehicleCode ? `${r.driverName || '—'}${r.vehicleCode ? ` · ${r.vehicleCode}` : ''}` : 'Unassigned'}</td>
                  <td className="py-[13px] px-4"><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer?.mode === 'new' && <NewDrawer openSos={openSos} onClose={() => setDrawer(null)} onCreated={created} />}
      {drawer?.mode === 'edit' && <EditDrawer row={drawer.row} onClose={() => setDrawer(null)} onSaved={saved} onDelete={() => remove(drawer.row)} />}
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} aria-pressed={active} className={cx('h-8 flex items-center px-4 py-0 rounded-full cursor-pointer font-sans text-[13px] font-semibold border border-solid', active ? 'border-black bg-black text-white' : 'border-line bg-card text-ink')}>{label}</button>;
}
export function StatusPill({ status }: { status: SchedStatus }) {
  const t = STATUS_TONE[status];
  return <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', TONE[t].bg, TONE[t].text)}><span className="w-1.5 h-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}

function NewDrawer({ openSos, onClose, onCreated }: { openSos: { id: string; docNo: string; customerName: string }[]; onClose: () => void; onCreated: (r: Sched) => void }) {
  const [soId, setSoId] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [notes, setNotes] = useState('');
  const so = openSos.find(s => s.id === soId);
  function submit() {
    api.post('/delivery-schedule', { salesOrderId: soId, plannedDate: plannedDate || null, notes }).catch(notifyFailure);
    onCreated(schedFallback([{ id: `dsch-new-${crypto.randomUUID().slice(0, 8)}`, salesOrderId: soId, soDocNo: so?.docNo ?? '', customerName: so?.customerName ?? '', plannedDate, notes, status: 'UNPLANNED' }]).data[0]);
  }
  return (
    <Drawer open onClose={onClose} width={520}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">Schedule a sales order</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Sales order</label>
          <select value={soId} onChange={e => setSoId(e.target.value)} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="">Select a sales order…</option>
            {openSos.map(s => <option key={s.id} value={s.id}>{s.docNo} · {s.customerName}</option>)}
          </select>
        </div>
        <Field label="Planned date (optional)" type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
        <Field label="Notes" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={soId === ''} disabledReason="Pick a sales order" onClick={submit}>Add to schedule</Button>
      </div>
    </Drawer>
  );
}

function EditDrawer({ row, onClose, onSaved, onDelete }: { row: Sched; onClose: () => void; onSaved: (r: Sched) => void; onDelete: () => void }) {
  const drivers = useApi('/drivers', DRIVERS_FALLBACK).data?.data ?? [];
  const vehicles = useApi('/vehicles', VEHICLES_FALLBACK).data?.data ?? [];
  const [f, setF] = useState<Sched>(row);
  function save() {
    const driverName = drivers.find((d: { id: string }) => d.id === f.driverId)?.name ?? '';
    const vehicleCode = vehicles.find((v: { id: string }) => v.id === f.vehicleId)?.code ?? '';
    const status: SchedStatus = (row.status === 'DISPATCHED' || row.status === 'DELIVERED' || row.status === 'CANCELLED') ? row.status : (f.plannedDate && f.driverId ? 'SCHEDULED' : 'UNPLANNED');
    api.patch(`/delivery-schedule/${row.id}`, { plannedDate: f.plannedDate || null, timeSlot: f.timeSlot || null, plannedTime: f.plannedTime || null, driverId: f.driverId || null, vehicleId: f.vehicleId || null, sequenceNo: f.sequenceNo, notes: f.notes }).catch(notifyFailure);
    onSaved({ ...f, driverName, vehicleCode, status });
  }
  return (
    <Drawer open onClose={onClose} width={560}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><div className="flex items-center gap-3"><h2 className="m-0 text-[19px] font-semibold">{row.soDocNo}</h2><StatusPill status={f.status} /></div><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="text-[13px] text-muted-ink">{row.customerName}</div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Planned date" type="date" value={f.plannedDate} onChange={e => setF(s => ({ ...s, plannedDate: e.target.value }))} />
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
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Remove</Button>
        <div className="flex gap-2.5"><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save</Button></div>
      </div>
    </Drawer>
  );
}
