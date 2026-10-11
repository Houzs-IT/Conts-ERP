import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, DateField } from '../components/inputs';
import { Drawer } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { persist, useResetOnReload } from '../lib/persist';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { rm, date, todayMyt } from '../lib/format';
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

const today = () => todayMyt();

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
  useResetOnReload(data, () => { setAdded([]); setEdits({}); setRemoved(new Set()); });

  const all = useMemo(() => [...added, ...(data?.data ?? [])].filter(r => !removed.has(r.id)).map(r => ({ ...r, ...edits[r.id] })), [added, data, edits, removed]);
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (vehFilter === 'all' || r.vehicleId === vehFilter) && (!q || `${r.vehicleCode} ${r.vehiclePlate} ${r.vendor}`.toLowerCase().includes(q)));
  // A due date stops counting once a later record of the same kind is logged for that vehicle.
  const isOverdue = (r: Rec) => !!r.nextDueDate && r.nextDueDate < today() && !all.some(g => g.vehicleId === r.vehicleId && g.recordType === r.recordType && g.serviceDate > r.serviceDate);
  const overdue = all.filter(isOverdue).length;

  const columns = useMemo<Column<Rec>[]>(() => [
    { key: 'date', label: 'Date', type: 'date', value: r => r.serviceDate },
    { key: 'vehicle', label: 'Vehicle', value: r => r.vehicleCode, text: r => `${r.vehicleCode} ${r.vehiclePlate}`, hideable: false, render: r => <span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] font-semibold">{r.vehicleCode}</span>, sub: r => r.vehiclePlate || null },
    { key: 'type', label: 'Type', value: r => TYPE_LABEL[r.recordType], filter: { kind: 'select' } },
    { key: 'cost', label: 'Cost', type: 'money', value: r => r.costSen, render: r => r.costSen ? <span className="tabular-nums whitespace-nowrap">{rm(r.costSen)}</span> : <span className="text-muted-ink">—</span> },
    { key: 'due', label: 'Next due', type: 'date', value: r => r.nextDueDate, render: r => {
      if (!r.nextDueDate) return <span className="text-muted-ink">—</span>;
      const late = isOverdue(r);
      return <span className={cx('whitespace-nowrap tabular-nums', late ? cx(TONE.critical.text, 'font-semibold') : 'text-muted-ink')}>{date(r.nextDueDate)}{late ? ' · overdue' : ''}</span>;
    } },
    { key: 'status', label: 'Status', type: 'status', value: r => r.status, status: r => (r.status === 'DONE' ? { label: 'Done', tone: 'success' } : { label: 'Scheduled', tone: 'info' }) },
  ], [all]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(draft: Rec, isNew: boolean) {
    const v = vehicles.find(x => x.id === draft.vehicleId);
    const withV = { ...draft, vehicleCode: v?.code ?? draft.vehicleCode, vehiclePlate: v?.plate ?? draft.vehiclePlate };
    const body = { vehicleId: draft.vehicleId, recordType: draft.recordType, serviceDate: draft.serviceDate, odometerKm: draft.odometerKm, costSen: draft.costSen, nextDueDate: draft.nextDueDate || null, nextDueKm: draft.nextDueKm, status: draft.status, vendor: draft.vendor, notes: draft.notes };
    if (isNew) { setAdded(a => [{ ...withV, id: `fmr-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); persist(api.post('/fleet-health', body), { reload, ok: () => toast({ tone: 'success', title: 'Record logged.', body: `${TYPE_LABEL[draft.recordType]} · ${withV.vehicleCode}` }) }); }
    else { setEdits(e => ({ ...e, [draft.id]: { ...e[draft.id], ...withV } })); persist(api.patch(`/fleet-health/${draft.id}`, body), { reload, ok: () => toast({ tone: 'success', title: 'Record updated.', body: withV.vehicleCode }) }); }
    setDrawer(null);
  }
  function remove(r: Rec) { setRemoved(s => new Set(s).add(r.id)); persist(api.del(`/fleet-health/${r.id}`), { reload, ok: () => toast({ tone: 'success', title: 'Record removed.', body: r.vehicleCode }) }); setDrawer(null); }

  const emptyRec = (): Rec => ({ id: '', vehicleId: vehicles[0]?.id ?? '', recordType: 'SERVICE', serviceDate: today(), odometerKm: null, costSen: 0, nextDueDate: '', nextDueKm: null, status: 'DONE', vendor: '', notes: '', vehicleCode: '', vehiclePlate: '' });

  return (
    <>
      <PageHeader title="Fleet health" sub={data ? `${all.length} ${all.length === 1 ? 'record' : 'records'}${overdue ? ` · ${overdue} overdue` : ''}` : '\u00a0'}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer({ draft: emptyRec(), isNew: true })}>Log maintenance</Button> : undefined} />
      <DataTable<Rec>
        id="scm.fleet-health" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
        loading={loading} error={error} onRetry={reload} pageSize={0}
        onRowClick={canWrite ? r => setDrawer({ draft: r, isNew: false }) : undefined}
        noun={['record', 'records']} exportName="fleet-health"
        toolbar={<>
          <div className="flex items-center gap-2.5">
            <label className="text-[12px] font-medium text-muted-ink">Vehicle</label>
            <select value={vehFilter} onChange={e => setVehFilter(e.target.value)} className="h-9 box-border px-3 py-0 font-sans text-[13px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="all">All vehicles</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.code}{v.plate ? ` · ${v.plate}` : ''}</option>)}
            </select>
          </div>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicle / vendor..." aria-label="Search fleet health"
            className="h-9 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none w-[220px] max-w-full" />
        </>}
        filtered={!!q || vehFilter !== 'all'} onClearFilters={() => { setSearch(''); setVehFilter('all'); }}
        empty={{ title: 'No fleet records yet.', body: 'Log services, repairs, road tax and inspections per vehicle, with the next-due reminder.', action: canWrite ? { label: 'Log maintenance', onClick: () => setDrawer({ draft: emptyRec(), isNew: true }) } : undefined }} />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete this record for ${draft.vehicleCode}?`, body: 'The maintenance record is deleted for good.', confirmLabel: 'Delete record', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason={dueBeforeService ? 'The next due date cannot be before the service date' : 'Pick a vehicle and a service date'} onClick={() => onSave(f, isNew)}>{isNew ? 'Log record' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
