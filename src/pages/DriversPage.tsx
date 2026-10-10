import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { Drawer } from '../components/Dialog';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { useSession } from '../lib/session';
import { cx } from '../lib/design-tokens';
import { StatusBadge } from '../components/StatusBadge';
import { PhoneText } from '../components/PhoneText';

/** Drivers master — ported 1:1 from 2990's SCM `drivers`, drawn in Conts. */

interface Driver { id: string; driverCode: string; name: string; phone: string; icNumber: string; vehicle: string; active: boolean }
interface Payload { data: Driver[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'd1', driverCode: 'DRV-01', name: 'Rahman bin Ali', phone: '+60122334455', icNumber: '850101-14-5566', vehicle: 'WXY 1234', active: true },
    { id: 'd2', driverCode: 'DRV-02', name: 'Lim Chee Kong', phone: '+60127788990', icNumber: '', vehicle: 'VBA 8890', active: true },
    { id: 'd3', driverCode: 'DRV-03', name: 'Suresh a/l Kumar', phone: '+60133445566', icNumber: '', vehicle: '', active: false },
  ],
};
type Draft = Driver & { isNew: boolean };
const emptyDraft = (): Draft => ({ id: '', driverCode: '', name: '', phone: '', icNumber: '', vehicle: '', active: true, isNew: true });

export default function DriversPage() {
  const { data, loading, error, reload } = useApi<Payload>('/drivers', FALLBACK);
  const toast = useToast();
  const { user } = useSession();
  const canWrite = !!user && ['management', 'operations_manager', 'finance_admin'].includes(user.role);
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const [added, setAdded] = useState<Driver[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Driver>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const rows = useMemo(() => [...added, ...(data?.data ?? [])].filter(d => !removed.has(d.id)).map(d => ({ ...d, ...edits[d.id] })), [added, data, edits, removed]);

  function save(d: Draft) {
    const body = { driverCode: d.driverCode.trim(), name: d.name.trim(), phone: d.phone.trim(), icNumber: d.icNumber.trim(), vehicle: d.vehicle.trim(), active: d.active };
    if (d.isNew) { setAdded(a => [{ ...body, id: `drv-new-${crypto.randomUUID().slice(0, 8)}` }, ...a]); api.post('/drivers', body).catch(notifyFailure); toast({ tone: 'success', title: 'Driver added.', body: body.name }); }
    else { setEdits(e => ({ ...e, [d.id]: { ...e[d.id], ...body } })); api.patch(`/drivers/${d.id}`, body).catch(notifyFailure); toast({ tone: 'success', title: 'Driver updated.', body: body.name }); }
    setDrawer(null);
  }
  function remove(d: Driver) { setRemoved(r => new Set(r).add(d.id)); api.del(`/drivers/${d.id}`).catch(notifyFailure); toast({ tone: 'success', title: 'Driver removed.', body: d.driverCode }); setDrawer(null); }

  return (
    <>
      <PageHeader title="Drivers" sub={`${rows.length} drivers · ${rows.filter(d => d.active).length} active`}
        right={canWrite ? <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setDrawer(emptyDraft())}>New driver</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last driver list we have. ${error}`} onRetry={reload} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[620px]">
            <thead><tr className="bg-muted [border-bottom:1px_solid_var(--color-line)]">
              {['Code', 'Name', 'Phone', 'Vehicle', 'Status'].map(h => <th key={h} className="py-[11px] px-4 text-left text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-ink whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={5}><div className="py-[38px] px-[22px] text-center text-[14px] font-semibold">No drivers yet.</div></td></tr>
              : rows.map(d => (
                <tr key={d.id} onClick={() => { if (canWrite) setDrawer({ ...d, isNew: false }); }} className={cx('[border-bottom:1px_solid_var(--color-line-soft)]', canWrite ? 'cursor-pointer hover:bg-muted' : '')}>
                  <td className="py-[13px] px-4"><span className="[font-family:var(--font-mono,ui-monospace,monospace)] text-[13px] bg-muted border border-solid border-line rounded-full px-2.5 py-0.5">{d.driverCode}</span></td>
                  <td className="py-[13px] px-4 text-[13.5px]">{d.name}</td>
                  <td className="py-[13px] px-4 text-[12.5px] text-muted-ink tabular-nums"><PhoneText value={d.phone} whatsapp={false} /></td>
                  <td className="py-[13px] px-4 text-[12.5px] text-[var(--color-ink-2)]">{d.vehicle || '—'}</td>
                  <td className="py-[13px] px-4"><StatusBadge entity="active_flag" value={d.active ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {drawer && <DriverDrawer draft={drawer} onClose={() => setDrawer(null)} onSave={save} onDelete={drawer.isNew ? undefined : () => { const d = rows.find(x => x.id === drawer.id); if (d) remove(d); }} />}
    </>
  );
}


function DriverDrawer({ draft, onClose, onSave, onDelete }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const set = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value as Draft[K] }));
  const canSave = f.driverCode.trim() !== '' && f.name.trim() !== '';
  return (
    <Drawer open onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 pt-[22px] pb-3.5">
        <h2 className="m-0 text-[19px] font-semibold">{draft.isNew ? 'New driver' : 'Edit driver'}</h2>
        <button onClick={onClose} aria-label="Close" className="bg-transparent border-none cursor-pointer text-muted-ink p-1.5 rounded-[8px] hover:bg-muted">✕</button>
      </div>
      <div className="px-6 pb-5 overflow-y-auto grow">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Driver code" placeholder="e.g. DRV-01" value={f.driverCode} onChange={set('driverCode')} />
          <Field label="Name" value={f.name} onChange={set('name')} />
          <Field label="Phone" value={f.phone} onChange={set('phone')} />
          <Field label="IC number" value={f.icNumber} onChange={set('icNumber')} />
          <Field label="Vehicle" placeholder="Plate / label" value={f.vehicle} onChange={set('vehicle')} />
          <div className="flex flex-col gap-[7px]">
            <label className="text-[12px] font-medium text-muted-ink">Status</label>
            <select value={f.active ? '1' : '0'} onChange={e => setF(s => ({ ...s, active: e.target.value === '1' }))} className="h-10 w-full box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer">
              <option value="1">Active</option><option value="0">Inactive</option>
            </select>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center gap-2.5 px-6 py-3.5 [border-top:1px_solid_var(--color-line)] bg-page">
        <div>{onDelete && <ConfirmButton icon={<Trash2 size={15} strokeWidth={1.75} />} confirm={{ title: `Delete driver ${draft.name}?`, body: 'It is deleted for good and drops off the driver list.', confirmLabel: 'Delete driver', cancelLabel: 'Keep it' }} onConfirm={onDelete}>Delete</ConfirmButton>}</div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!canSave} disabledReason="Enter a code and a name" onClick={() => onSave(f)}>{draft.isNew ? 'Create' : 'Save'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
