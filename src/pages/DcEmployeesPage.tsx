import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { Field } from '../components/Field';
import { Select } from '../components/Select';
import { DateField, PhoneInput, phoneProblem } from '../components/inputs';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../lib/api';
import { mayWork } from '../lib/areaAccess';
import { useSession } from '../lib/session';
import { plural, todayMyt } from '../lib/format';
import type { DcEmployee, DcEmployeeInput } from '../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees: Dream Crafter's own staff (owner,
 * 30 Oct 2026, migration 0185), kept apart from The Conts' cleaners and
 * technicians. Details only for now: pay, app access and clock-in come
 * with Dream Crafter payroll and attendance.
 * ------------------------------------------------------------------ */

const statusOf = (e: DcEmployee): { label: string; tone: 'success' | 'neutral' } =>
  e.status === 'resigned' ? { label: 'Resigned', tone: 'neutral' } : { label: 'Active', tone: 'success' };

export default function DcEmployeesPage() {
  const { data, loading, error, reload } = useApi<{ data: DcEmployee[] }>('/employees/dream-crafter');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [form, setForm] = useState<{ person: DcEmployee | null } | null>(null);
  const people = data?.data ?? [];
  const add = () => setForm({ person: null });

  const columns = useMemo<Column<DcEmployee>[]>(() => [
    { key: 'name', label: 'Name', value: e => e.name, hideable: false, width: 200, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'jobTitle', label: 'Job title', value: e => e.jobTitle, width: 180 },
    { key: 'phone', label: 'Phone', value: e => e.phone, width: 160 },
    { key: 'joinDate', label: 'Join date', type: 'date', value: e => e.joinDate, width: 130 },
    { key: 'status', label: 'Status', type: 'status', value: e => statusOf(e).label, status: statusOf, width: 120 },
  ], []);

  return (
    <>
      <PageHeader title="Employees" sub={data ? `Dream Crafter staff · ${plural(people.length, 'employee')}` : 'Dream Crafter staff'}
        primary={mayEdit ? <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={add}>Add Employee</Button> : undefined} />
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<DcEmployee>
        id="dc-employees" columns={columns} rows={loading && people.length === 0 ? null : people}
        rowKey={e => e.id} pageSize={0} noun={['employee', 'employees']} exportName="dream-crafter-employees"
        rowTone={e => (e.status === 'resigned' ? 'muted' : null)}
        onRowClick={mayEdit ? e => setForm({ person: e }) : undefined}
        empty={{ title: 'No Dream Crafter employees yet.', body: 'Add the first person who works for Dream Crafter.', icon: 'Users', action: mayEdit ? { label: 'Add Employee', onClick: add } : undefined }}
      />

      {form && <DcEmployeeForm person={form.person} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </>
  );
}

/** Add or edit one Dream Crafter employee. */
function DcEmployeeForm({ person, onClose, onSaved }: { person: DcEmployee | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const creating = !person;
  const [d, setD] = useState<DcEmployeeInput>(() => {
    if (!person) return { name: '', phone: null, jobTitle: null, joinDate: todayMyt(), status: 'active', resignedAt: null };
    const { id: _id, ...record } = person;
    return record;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DcEmployeeInput>(k: K, v: DcEmployeeInput[K]) => setD(p => ({ ...p, [k]: v }));

  async function save() {
    const problems: Record<string, string> = {};
    if (!d.name.trim()) problems.name = 'Enter their name.';
    const phoneError = d.phone ? phoneProblem(d.phone) : undefined;
    if (phoneError) problems.phone = phoneError;
    if (d.status === 'resigned' && !d.resignedAt) problems.resignedAt = 'Give the last working day.';
    if (Object.keys(problems).length) { setErrors(problems); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.put('/employees/dream-crafter', { ...d, id: person?.id });
      toast({ tone: 'success', title: creating ? 'Employee added.' : 'Employee saved.', body: d.name.trim() });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={creating ? 'Add Employee' : d.name || 'Employee'} sub="Someone who works for Dream Crafter." onClose={onClose} width={560}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : creating ? 'Add Employee' : 'Save'}</Button>
      </>}>
      <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Name" value={d.name} onChange={e => set('name', e.target.value)} placeholder="Ahmad Firdaus" error={errors.name} />
        <Field label="Job title" value={d.jobTitle ?? ''} onChange={e => set('jobTitle', e.target.value || null)} placeholder="Site supervisor" error={errors.jobTitle} />
        <PhoneInput label="Phone" value={d.phone ?? ''} onChange={v => set('phone', v || null)} error={errors.phone} />
        <DateField label="Join date" value={d.joinDate ?? ''} onChange={v => set('joinDate', v || null)} error={errors.joinDate} />
        <Select label="Status" showLabel size="md" value={d.status} onChange={v => set('status', v === 'resigned' ? 'resigned' : 'active')}
          options={[{ value: 'active', label: 'Active' }, { value: 'resigned', label: 'Resigned' }]} />
        {d.status === 'resigned' && (
          <DateField label="Last working day" value={d.resignedAt ?? ''} onChange={v => set('resignedAt', v || null)} required error={errors.resignedAt} />
        )}
      </div>
    </Modal>
  );
}
