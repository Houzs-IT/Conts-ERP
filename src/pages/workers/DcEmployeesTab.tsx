import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { DateField, PhoneInput, phoneProblem } from '../../components/inputs';
import { EmployeePaySections, Section } from './EmployeePaySections';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, plural, todayMyt } from '../../lib/format';
import { EMPLOYEE_DEFAULTS, POSITION_LABEL, DC_DEPARTMENT_LABEL, type DcEmployee, type DcEmployeeInput } from '../../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Employee Master: Dream Crafter's own
 * staff (owner, 30 Oct 2026, migration 0185), kept apart from The Conts'
 * cleaners and technicians. The same record as The Conts' (pay, bank,
 * statutory), saved for Dream Crafter payroll; app access and clock-in
 * come with Dream Crafter payroll and attendance.
 * ------------------------------------------------------------------ */

const statusOf = (e: DcEmployee): { label: string; tone: 'success' | 'neutral' } =>
  e.status === 'resigned' ? { label: 'Resigned', tone: 'neutral' } : { label: 'Active', tone: 'success' };

export default function DcEmployeesTab({ onChanged }: { onChanged: () => void }) {
  const { data, loading, error, reload } = useApi<{ data: DcEmployee[] }>('/employees/dream-crafter');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'dcHr');
  const [form, setForm] = useState<{ person: DcEmployee | null } | null>(null);
  const people = data?.data ?? [];
  const add = () => setForm({ person: null });

  const columns = useMemo<Column<DcEmployee>[]>(() => [
    { key: 'name', label: 'Name', value: e => e.name, hideable: false, width: 200, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'department', label: 'Department', value: () => DC_DEPARTMENT_LABEL, width: 170 },
    { key: 'position', label: 'Position', value: e => POSITION_LABEL[e.position], width: 120 },
    { key: 'basic', label: 'Basic Salary', type: 'money', value: e => (e.payBasis === 'daily' ? e.dailyRateSen : e.basicSalarySen), width: 140,
      render: e => e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : rm(e.basicSalarySen) },
    { key: 'status', label: 'Status', type: 'status', value: e => statusOf(e).label, status: statusOf, width: 120 },
  ], []);

  return (
    <>
      <p className="m-0 mb-4 text-copy text-muted-ink">{data ? plural(people.length, 'employee') : 'Loading the list…'}</p>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<DcEmployee>
        id="dc-employees" columns={columns} rows={loading && people.length === 0 ? null : people}
        rowKey={e => e.id} pageSize={0} noun={['employee', 'employees']} exportName="dream-crafter-employees"
        rowTone={e => (e.status === 'resigned' ? 'muted' : null)}
        onRowClick={mayEdit ? e => setForm({ person: e }) : undefined}
        header={
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Employee Master</span>
              <span className="text-meta text-muted-ink">The people who work for Dream Crafter. Open a person for their pay, bank and statutory details.</span>
            </span>
            {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={add}>Add employee</Button>}
          </div>
        }
        empty={{ title: 'No Dream Crafter employees yet.', body: 'Add the first person who works for Dream Crafter.', icon: 'Users', action: mayEdit ? { label: 'Add employee', onClick: add } : undefined }}
        renderCard={e => (
          <span className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center justify-between gap-3">
              <span className="text-copy font-semibold min-w-0 truncate">{e.name}</span>
              <StatusBadge tone={statusOf(e).tone} label={statusOf(e).label} size="sm" />
            </span>
            <span className="text-meta text-muted-ink">{[DC_DEPARTMENT_LABEL, POSITION_LABEL[e.position]].join(' · ')}</span>
            <span className="text-copy tabular-nums">{e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : `${rm(e.basicSalarySen)} / month`}</span>
          </span>
        )}
      />

      {form && <DcEmployeeForm person={form.person} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); onChanged(); }} />}
    </>
  );
}

/** Add or edit one Dream Crafter employee. */
function DcEmployeeForm({ person, onClose, onSaved }: { person: DcEmployee | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const creating = !person;
  const [d, setD] = useState<DcEmployeeInput>(() => {
    if (!person) return { ...EMPLOYEE_DEFAULTS, name: '', phone: null, joinDate: todayMyt(), status: 'active' };
    const { id: _id, ...record } = person;
    return record;
  });
  const [salaryFrom, setSalaryFrom] = useState(`${todayMyt().slice(0, 7)}-01`);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DcEmployeeInput>(k: K, v: DcEmployeeInput[K]) => setD(p => ({ ...p, [k]: v }));
  const salaryChanged = !creating && d.payBasis === 'monthly' && d.basicSalarySen > 0 && d.basicSalarySen !== person.basicSalarySen;

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
      await api.put('/employees/dream-crafter', { ...d, id: person?.id, ...(salaryChanged ? { salaryEffectiveFrom: salaryFrom } : {}) });
      toast({ tone: 'success', title: creating ? 'Employee added.' : 'Employee saved.', body: d.name.trim() });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={creating ? 'Add employee' : d.name || 'Employee'} sub={creating ? 'Someone who works for Dream Crafter.' : [DC_DEPARTMENT_LABEL, POSITION_LABEL[d.position]].join(' · ')}
      onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : creating ? 'Add employee' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <Section title="Details">
          <Field label="Name" value={d.name} onChange={e => set('name', e.target.value)} placeholder="Ahmad Firdaus" error={errors.name} />
          <PhoneInput label="Phone" value={d.phone ?? ''} onChange={v => set('phone', v || null)} error={errors.phone} />
          <Field label="Department" value={DC_DEPARTMENT_LABEL} readOnly />
          <label className="sm:col-span-2 flex items-center gap-2.5 min-h-10 cursor-pointer">
            <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={d.position === 'leader'}
              onChange={e => setD(p => ({ ...p, position: e.target.checked ? 'leader' : 'employee', leaderAllowanceSen: e.target.checked ? p.leaderAllowanceSen : 0 }))} />
            <span className="flex flex-col">
              <span className="text-copy font-medium">Leader</span>
              <span className="text-meta text-muted-ink">Leads a team and can get the leader allowance. Unticked: a normal employee.</span>
            </span>
          </label>
          <Select label="Status" showLabel size="md" value={d.status} onChange={v => set('status', v === 'resigned' ? 'resigned' : 'active')}
            options={[{ value: 'active', label: 'Active' }, { value: 'resigned', label: 'Resigned' }]} />
          <DateField label="Join date" value={d.joinDate ?? ''} onChange={v => set('joinDate', v || null)} error={errors.joinDate} />
          {d.status === 'resigned' && (
            <DateField label="Last working day" value={d.resignedAt ?? ''} onChange={v => set('resignedAt', v || null)} required error={errors.resignedAt} />
          )}
          <Field label="Nationality" value={d.nationality ?? ''} onChange={e => set('nationality', e.target.value)} placeholder="Malaysian" error={errors.nationality} />
        </Section>

        <EmployeePaySections record={d} onChange={(key, value) => setD(previous => ({ ...previous, [key]: value }))} errors={errors}
          salaryChanged={salaryChanged} salaryFrom={salaryFrom} onSalaryFromChange={setSalaryFrom}
          payNote="Saved for Dream Crafter payroll, which is not set up yet." />

        {errors.form && <p className="m-0 text-meta text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
