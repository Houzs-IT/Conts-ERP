import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';

/** Fleet Health — ported from 2990's SCM fleet-maintenance (core), drawn in Conts. Per-vehicle
 *  service / repair / inspection log with cost and a next-due reminder. Money integer sen. */

type RecType = 'SERVICE' | 'REPAIR' | 'INSPECTION' | 'TYRE' | 'ROAD_TAX' | 'INSURANCE' | 'OTHER';
type Status = 'SCHEDULED' | 'DONE';
const TYPE_LABEL: Record<RecType, string> = { SERVICE: 'Service', REPAIR: 'Repair', INSPECTION: 'Inspection', TYRE: 'Tyre', ROAD_TAX: 'Road tax', INSURANCE: 'Insurance', OTHER: 'Other' };
const TYPES = Object.keys(TYPE_LABEL) as RecType[];

interface Rec { id: string; vehicleId: string; recordType: RecType; serviceDate: string; odometerKm: number | null; costSen: number; nextDueDate: string; nextDueKm: number | null; status: Status; vendor: string; notes: string; vehicleCode: string; vehiclePlate: string }
interface Payload { data: Rec[]; generatedAt: string }
interface Vehicle { id: string; code: string; plate: string }

const VEH_FALLBACK: { data: Vehicle[] } = { data: [
  { id: 'v1', code: 'LRY-01', plate: 'WXY 1234' }, { id: 'v2', code: 'LRY-02', plate: 'VBA 5678' },
] };
const FALLBACK: Payload = { generatedAt: '', data: [
  { id: 'f1', vehicleId: 'v1', recordType: 'SERVICE', serviceDate: '2026-09-10', odometerKm: 84200, costSen: 45000, nextDueDate: '2026-12-10', nextDueKm: 94000, status: 'DONE', vendor: 'Toyota SC', notes: '', vehicleCode: 'LRY-01', vehiclePlate: 'WXY 1234' },
  { id: 'f2', vehicleId: 'v2', recordType: 'ROAD_TAX', serviceDate: '2026-08-01', odometerKm: null, costSen: 120000, nextDueDate: '2026-09-25', nextDueKm: null, status: 'DONE', vendor: 'JPJ', notes: 'Renewal', vehicleCode: 'LRY-02', vehiclePlate: 'VBA 5678' },
] };

const today = () => new Date().toISOString().slice(0, 10);

export default function FleetHealthPage() {
  const { data, loading, error, reload } = useApi<Payload>('/fleet-health', FALLBACK);
  const vehicles = useApi<{ data: Vehicle[] }>('/vehicles', VEH_FALLBACK).data?.data ?? [];
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [vehFilter, setVehFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ draft: Rec; isNew: boolean } | null>(null);
  const [added, setAdded] = useState<Rec[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Rec>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (vehFilter === 'all' || r.vehicleId === vehFilter) && (!q || `${r.vehicleCode} ${r.vehiclePlate} ${r.vendor}`.toLowerCase().includes(q)));
  const overdue = all.filter(r => r.nextDueDate && r.nextDueDate < today()).length;

  function save(draft: Rec, isNew: boolean) {
    const v = vehicles.find(x => x.id === draft.vehicleId);
    const withV = { ...draft, vehicleCode: v?.code ?? draft.vehicleCode, vehiclePlate: v?.plate ?? draft.vehiclePlate };
    const body = { vehicleId: draft.vehicleId, recordType: draft.recordType, serviceDate: draft.serviceDate, odometerKm: draft.odometerKm, costSen: draft.costSen, nextDueDate: draft.nextDueDate || null, nextDueKm: draft.nextDueKm, status: draft.status, vendor: draft.vendor, notes: draft.notes };
    if (isNew) { setAdded(a => [{ ...withV, id: `fmr-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); api.post('/fleet-health', body).catch(notifyFailure); toast({ tone: 'success', title: 'Record logged.', body: `${TYPE_LABEL[draft.recordType]} · ${withV.vehicleCode}` }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...withV } })); api.patch(`/fleet-health/${draft.id}`, body).catch(notifyFailure); toast({ tone: 'success', title: 'Record updated.', body: withV.vehicleCode }); }
    setDrawer(null);
  }
  function remove(r: Rec) { setRemoved(s => new Set(s).add(r.id)); api.del(`/fleet-health/${r.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Record removed.', body: r.vehicleCode }); setDrawer(null); }

  const emptyRec = (): Rec => ({ id: '', vehicleId: vehicles[0]?.id ?? '', recordType: 'SERVICE', serviceDate: today(), odometerKm: null, costSen: 0, nextDueDate: '', nextDueKm: null, status: 'DONE', vendor: '', notes: '', vehicleCode: '', vehiclePlate: '' });

  return (
    <>
      <PageHeader title="Fleet health" sub={`${all.length} records${overdue ? ` · ${overdue} overdue` : ''}`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyRec(), isNew: true })}>Log maintenance</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last fleet records we have. ${error}`} onRetry={reload} />}
      <div className="flex items-center justify-between gap-5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <label className="text-[12px] font-medium text-muted-ink">Vehicle</label>
          <select value={vehFilter} onChange={e => setVehFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
            <option value="all">All vehicles</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.code}{v.plate ? ` · ${v.plate}` : ''}</option>)}
          </select>
        </div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicle / vendor..." aria-label="Search fleet health"
          className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[820px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)]">
              {['Date', 'Vehicle', 'Type', 'Cost', 'Next due', 'Status'].map((h, i) => <th key={h} className={cx('py-[11px] px-4 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap', i === 3 ? 'text-right' : 'text-left')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && all.length === 0 ? <tr><td colSpan={6}><TableSkeleton rows={6} cols={6} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={6}><div className="py-[38px] px-[22px] text-center flex flex-col gap-1.5 items-center"><span className="text-[14px] font-semibold">{q || vehFilter !== 'all' ? 'No records match.' : 'No fleet records yet.'}</span><span className="text-[12.5px] text-muted-ink max-w-[380px]">Log services, repairs, road tax and inspections per vehicle, with the next-due reminder.</span></div></td></tr>
              : rows.map(r => {
                const isOverdue = r.nextDueDate && r.nextDueDate < today();
                return (
                  <tr key={r.id} onClick={() => { if (canWrite) setDrawer({ draft: r, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                    <td className="py-[13px] px-4 text-[13px] text-[var(--color-ink-2)] tabular-nums">{r.serviceDate ? date(r.serviceDate) : '—'}</td>
                    <td className="py-[13px] px-4"><div className="flex flex-col"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.vehicleCode}</span>{r.vehiclePlate && <span className="text-[11.5px] text-muted-ink">{r.vehiclePlate}</span>}</div></td>
                    <td className="py-[13px] px-4 text-[13px]">{TYPE_LABEL[r.recordType]}</td>
                    <td className="py-[13px] px-4 text-right tabular-nums text-[13px]">{r.costSen ? rm(r.costSen) : '—'}</td>
                    <td className="py-[13px] px-4 text-[12.5px] tabular-nums">{r.nextDueDate ? <span className={cx(isOverdue ? cx(TONE.critical.text, 'font-semibold') : 'text-muted-ink')}>{date(r.nextDueDate)}{isOverdue ? ' · overdue' : ''}</span> : <span className="text-muted-ink">—</span>}</td>
                    <td className="py-[13px] px-4"><span className={cx('inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-0.5 rounded-full', r.status === 'DONE' ? cx(TONE.success.bg, TONE.success.text) : cx(TONE.info.bg, TONE.info.text))}>{r.status === 'DONE' ? 'Done' : 'Scheduled'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <RecDrawer draft={drawer.draft} isNew={drawer.isNew} vehicles={vehicles} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => remove(drawer.draft)} />}
    </>
  );
}

function RecDrawer({ draft, isNew, vehicles, onClose, onSave, onDelete }: { draft: Rec; isNew: boolean; vehicles: Vehicle[]; onClose: () => void; onSave: (d: Rec, isNew: boolean) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Rec>(draft);
  const dueBeforeService = !!f.nextDueDate && !!f.serviceDate && f.nextDueDate < f.serviceDate;
  const canSave = f.vehicleId !== '' && f.serviceDate !== '' && !dueBeforeService;
  return (
    <Drawer open onClose={onClose} width={600}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5"><h2 className="m-0 text-[19px] font-semibold">{isNew ? 'Log maintenance' : 'Edit record'}</h2><button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted"><X size={18} /></button></div>
      <div className="px-6 pb-5 overflow-y-auto grow flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Vehicle</label>
            <select value={f.vehicleId} onChange={e => setF(s => ({ ...s, vehicleId: e.target.value }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="">Select a vehicle…</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.code}{v.plate ? ` · ${v.plate}` : ''}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Type</label>
            <select value={f.recordType} onChange={e => setF(s => ({ ...s, recordType: e.target.value as RecType }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <DateField label="Service date" required value={f.serviceDate} onChange={v => setF(s => ({ ...s, serviceDate: v }))} />
          <NumberInput label="Odometer (km)" min={0} value={f.odometerKm} onChange={n => setF(s => ({ ...s, odometerKm: n }))} />
          <MoneyInput label="Cost (RM)" valueSen={f.costSen || null} onChangeSen={n => setF(s => ({ ...s, costSen: n ?? 0 }))} />
          <Field label="Vendor" placeholder="Optional" value={f.vendor} onChange={e => setF(s => ({ ...s, vendor: e.target.value }))} />
          <DateField label="Next due date" min={f.serviceDate || undefined} value={f.nextDueDate} onChange={v => setF(s => ({ ...s, nextDueDate: v }))} />
          <NumberInput label="Next due (km)" min={0} value={f.nextDueKm} onChange={n => setF(s => ({ ...s, nextDueKm: n }))} />
          <div className="flex flex-col gap-[7px]"><label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.status} onChange={e => setF(s => ({ ...s, status: e.target.value as Status }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="DONE">Done</option><option value="SCHEDULED">Scheduled</option>
            </select>
          </div>
        </div>
        <Field label="Notes" placeholder="Optional" value={f.notes} onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page">
        <div>{onDelete && <Button size="sm" variant="danger" icon={<Trash2 size={15} strokeWidth={1.75} />} onClick={onDelete}>Delete</Button>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={dueBeforeService ? 'The next due date cannot be before the service date' : 'Pick a vehicle and a service date'} onClick={() => onSave(f, isNew)}>{isNew ? 'Log record' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
