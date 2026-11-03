import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Field } from '../../components/Field';
import { EmptyState } from '../../components/States';
import { RowsSkeleton } from '../../components/Loading';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, type ConfirmSpec } from '../../components/ConfirmDialog';
import { CentreModal, ModalActions } from '../../components/booking/BookingDrawer';
import { useApi } from '../../lib/useApi';
import { useSession } from '../../lib/session';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';

interface SampleOwner { id: string; name: string; sharePct: number; units: number; reservations: number; createdAt: string }
interface DemoUnit { id: string; unitNumber: string; propertyName: string; sample?: boolean }

/** Owner portal (sample): the owner portal's own screens, fed from Demo mode, for showing a prospective owner. It
 *  replaced the Owner Showcase (owner, 2 Nov 2026). Each sample owner has sample copies of real units and sample
 *  reservations and reviews on them; nothing here is a real owner, statement or payout. */
export function SampleTab() {
  const { user } = useSession();
  const allowed = !!user?.demo?.allowed;
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ data: SampleOwner[] }>(allowed ? '/demo/owners' : null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) {
    return <EmptyState icon="Lock" title="For management and sales staff" body="The sample owner portal uses Demo mode, which management and the Sales department may use." />;
  }
  const owners = data?.data ?? [];
  const remove = (o: SampleOwner) => setConfirm({
    title: `Remove the sample owner ${o.name}?`, body: 'Their sample units, reservations and reviews go too. Nothing real is affected.',
    confirmLabel: 'Remove sample owner', busyLabel: 'Removing…', danger: true,
    onConfirm: async () => {
      setBusy(true);
      try { await api.del(`/demo/owners/${encodeURIComponent(o.id)}`); setConfirm(null); reload(); toast({ tone: 'neutral', title: `${o.name} removed.` }); }
      catch (e) { toast({ tone: 'critical', title: 'Not removed.', body: errorMessage(e, 'Try again in a moment.') }); }
      setBusy(false);
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="m-0 text-copy text-muted-ink max-w-[720px] text-pretty">
          What an owner sees after joining The Conts, on the real owner portal screens, filled with sample data from Demo
          mode. Add a sample owner, open their portal on a laptop or a phone, and walk a prospective owner through it.
        </p>
        <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setAdding(true)}>Add sample owner</Button>
      </div>
      {loading && !data ? <RowsSkeleton rows={3} cols={3} /> : error && !data ? (
        <EmptyState icon="TriangleAlert" title="Sample owners could not load" body={error} action={{ label: 'Try again', onClick: reload }} />
      ) : owners.length === 0 ? (
        <EmptyState icon="FlaskConical" title="No sample owners yet"
          body="Add one: pick a few real units to copy, and three months of sample reservations and reviews are made for them."
          action={{ label: 'Add sample owner', onClick: () => setAdding(true) }} />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {owners.map(o => (
            <div key={o.id} className="bg-card border border-solid border-line rounded-card p-4 flex flex-col gap-3 min-w-0">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-copy font-semibold [overflow-wrap:anywhere]">{o.name}</span>
                <span className="text-meta text-muted-ink">{plural(o.units, 'sample unit')} · {plural(o.reservations, 'sample reservation')} · {o.sharePct}% To Operator</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="primary" icon={<Icon name="Eye" size="sm" />} onClick={() => navigate(`/owner-b/sample/${encodeURIComponent(o.id)}`)}>Open portal</Button>
                <Button size="sm" variant="tertiary" onClick={() => remove(o)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <AddSampleOwner onClose={() => setAdding(false)} onAdded={id => { setAdding(false); reload(); navigate(`/owner-b/sample/${encodeURIComponent(id)}`); }} />}
      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </section>
  );
}

function AddSampleOwner({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const toast = useToast();
  const units = useApi<{ units: DemoUnit[] }>('/demo').data?.units.filter(u => !u.sample) ?? [];
  const [name, setName] = useState('Sample Owner');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [fill, setFill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shown = useMemo(() => units.filter(u => !q || `${u.propertyName} ${u.unitNumber}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [units, q]);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 6 ? p : [...p, id]));
  const missing = !name.trim() ? 'Enter a name.' : !picked.length ? 'Pick at least one unit.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing) return;
    setBusy(true); setErrors({});
    try {
      const r = await api.post<{ id: string; reservations: number }>('/demo/owners', { name: name.trim(), unitIds: picked, fill });
      toast({ tone: 'success', title: 'Sample owner added.', body: fill ? `${plural(r.reservations, 'sample reservation')} made.` : undefined });
      onAdded(r.id);
    } catch (err) {
      setErrors(err instanceof ApiFailure && err.fields ? err.fields : {});
      toast({ tone: 'critical', title: 'Not added.', body: errorMessage(err, 'Try again in a moment.') });
    }
    setBusy(false);
  }

  return (
    <CentreModal title="Sample owner" sub="Saved as sample data only. The units picked are copied; the real units, their owners and channels see no change." onClose={() => { if (!busy) onClose(); }} maxWidth={560}>
      <form onSubmit={submit} className="px-[22px] py-4 flex flex-col gap-[14px] overflow-y-auto min-h-0">
        <Field label="Name the prospect will see" value={name} onChange={e => setName(e.target.value)} required error={errors.name} />
        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium text-muted-ink">Units to copy ({picked.length} of up to 6)</span>
          <Field label="Search units" placeholder="Search unit or building" value={q} onChange={e => setQ(e.target.value)} />
          <div className="max-h-[260px] overflow-y-auto border border-solid border-line rounded-control">
            {shown.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2.5 min-h-11 cursor-pointer [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                <input type="checkbox" className="w-4 h-4 accent-ink cursor-pointer" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="text-copy min-w-0 truncate">{u.propertyName} {u.unitNumber}</span>
              </label>
            ))}
            {!shown.length && <span className="block px-3 py-3 text-meta text-muted-ink">No unit matches.</span>}
          </div>
          {errors.unitIds && <span className="text-meta text-critical">{errors.unitIds}</span>}
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 mt-[2px] accent-ink cursor-pointer" checked={fill} onChange={e => setFill(e.target.checked)} />
          <span className="text-copy">Fill with sample reservations and reviews for the last three months<span className="block text-meta text-muted-ink">Leave it off to add them yourself in Demo mode.</span></span>
        </label>
        <ModalActions>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!!missing} disabledReason={missing ?? undefined}>Add sample owner</Button>
        </ModalActions>
      </form>
    </CentreModal>
  );
}
