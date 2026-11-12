import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { ChoiceChips } from '../../components/ChoiceChips';
import { StatusBadge } from '../../components/StatusBadge';
import { PhoneCard, ToolbarSearch } from '../../components/ListToolbar';
import { Field } from '../../components/Field';
import { useConfirm } from '../../components/ConfirmDialog';
import { AccessModal, type AccessTarget } from './AccessModal';
import { DateField, PhoneInput, phoneProblem } from '../../components/inputs';
import { EmployeePaySections, Section } from './EmployeePaySections';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayRun, mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, plural, todayMyt } from '../../lib/format';
import { EMPLOYEE_DEFAULTS, POSITION_LABEL, DC_DEPARTMENT_LABEL, type DcEmployee, type DcEmployeeInput } from '../../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Employee Master: Dream Crafter's own
 * staff (owner, 30 Oct 2026, migration 0185), kept apart from The Conts'
 * cleaners and technicians. The same record as The Conts' (pay, bank,
 * statutory), saved for Dream Crafter payroll. Give app access / Reset PIN
 * gives them the phone app's Clock screen (employee ID and PIN); Switch off
 * stops their login and takes them off Attendance.
 * ------------------------------------------------------------------ */

const statusOf = (e: DcEmployee): { label: string; tone: 'success' | 'neutral' | 'warning' } => {
  if (e.status === 'resigned') return { label: 'Resigned', tone: 'neutral' };
  if (!e.isActive) return { label: 'Switched off', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
};

export default function DcEmployeesTab({ onChanged }: { onChanged: () => void }) {
  const { data, loading, error, reload } = useApi<{ data: DcEmployee[]; hasAppAccess: boolean }>('/employees/dream-crafter');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'dcHr');
  // Same rule as the roster route: Full on Dream Crafter > HR > Employees to give app access. Both buttons wait for migration 0311.
  const mayGrant = mayRun(user, 'dcHr') && !!data?.hasAppAccess;
  const maySwitch = mayEdit && !!data?.hasAppAccess;
  const [confirmDialog, ask] = useConfirm();
  const toast = useToast();
  const [access, setAccess] = useState<AccessTarget | null>(null);
  const [form, setForm] = useState<{ person: DcEmployee | null } | null>(null);
  const [query, setQuery] = useState('');
  const all = data?.data ?? [];
  const needle = query.trim().toLowerCase();
  const people = needle ? all.filter(e => [e.name, e.phone ?? '', POSITION_LABEL[e.position]].join(' ').toLowerCase().includes(needle)) : all;
  const add = () => setForm({ person: null });

  const columns = useMemo<Column<DcEmployee>[]>(() => [
    { key: 'empNo', label: 'Emp No', value: e => e.employeeId, width: 100 },
    { key: 'name', label: 'Name', value: e => e.name, hideable: false, width: 200, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'department', label: 'Department', value: () => DC_DEPARTMENT_LABEL, width: 170 },
    { key: 'position', label: 'Position', value: e => POSITION_LABEL[e.position], width: 120 },
    { key: 'basic', label: 'Basic Salary', type: 'money', value: e => (e.payBasis === 'daily' ? e.dailyRateSen : e.basicSalarySen), width: 140,
      render: e => e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : rm(e.basicSalarySen) },
    { key: 'status', label: 'Status', type: 'status', value: e => statusOf(e).label, status: statusOf, width: 120 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 340, align: 'right', render: e => actions(e) },
  ], [mayEdit, mayGrant, maySwitch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(person: DcEmployee) {
    if (person.isActive && await ask({ title: `Switch off ${person.name}?`, body: 'They come off the Attendance list unless they punched, and their app login stops. Their record stays as it is. You can switch them back on at any time.', confirmLabel: 'Switch off', danger: true }) === null) return;
    try {
      const { id, employeeId: _employeeId, isActive: _isActive, ...record } = person;
      await api.put('/employees/dream-crafter', { ...record, id, isActive: !person.isActive });
      toast({ tone: person.isActive ? 'warning' : 'success', title: person.isActive ? `${person.name} switched off.` : `${person.name} switched on.`, body: person.isActive ? 'Their app login has stopped.' : 'They can sign in and clock in again.' });
    } catch (err) { notifyFailure(err); }
    reload();
    onChanged();
  }

  function giveAccess(person: DcEmployee) {
    setAccess({ id: person.id, name: person.name, employeeId: person.employeeId, rosterApi: '/employees/dream-crafter', jobs: 'clock-ins', appName: 'the Dream Crafter app' });
  }

  function actions(person: DcEmployee, align: 'start' | 'end' = 'end'): ReactNode {
    // The row itself opens the form, so a click or Enter on a button here must not reach it.
    return (
      <span className={`flex gap-[7px] items-center flex-wrap ${align === 'start' ? 'justify-start' : 'justify-end'}`} onClick={ev => ev.stopPropagation()} onKeyDown={ev => ev.stopPropagation()}>
        {mayGrant && person.isActive && (
          <Button size="sm" variant="tertiary" icon={<Icon name="KeyRound" size="sm" />} onClick={() => giveAccess(person)}>{person.employeeId ? 'Reset PIN' : 'Give app access'}</Button>
        )}
        {mayEdit && <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setForm({ person })}>Edit</Button>}
        {maySwitch && (
          <Button size="sm" variant="tertiary" icon={<Icon name={person.isActive ? 'UserMinus' : 'UserCheck'} size="sm" />} onClick={() => void toggleActive(person)}>
            {person.isActive ? 'Switch off' : 'Switch on'}
          </Button>
        )}
      </span>
    );
  }

  return (
    <>
      {confirmDialog}
      <p className="m-0 mb-4 text-copy text-muted-ink">{data ? (needle ? `${plural(people.length, 'employee')} of ${all.length} match` : plural(all.length, 'employee')) : 'Loading the list…'}</p>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<DcEmployee>
        id="dc-employees" columns={columns} rows={loading && all.length === 0 ? null : people}
        toolbar={<ToolbarSearch value={query} onChange={setQuery} placeholder="Name, phone or position" label="Search employees" />}
        filtered={!!needle} onClearFilters={() => setQuery('')}
        rowKey={e => e.id} pageSize={0} noun={['employee', 'employees']} exportName="dream-crafter-employees"
        rowTone={e => (e.status === 'resigned' || !e.isActive ? 'muted' : null)}
        onRowClick={mayEdit ? e => setForm({ person: e }) : undefined}
        header={
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-heading font-bold tracking-[-0.005em]">Employee Master</span>
              <span className="text-meta text-muted-ink">The people who work for Dream Crafter. Open a person for their pay, bank and statutory details.</span>
            </span>
            {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={add}>Add employee</Button>}
          </div>
        }
        empty={{ title: 'No Dream Crafter employees yet.', body: 'Add the first person who works for Dream Crafter.', icon: 'Users', action: mayEdit ? { label: 'Add employee', onClick: add } : undefined }}
        renderCard={e => (
          <span className="flex flex-col gap-2 min-w-0">
            <PhoneCard title={e.name} right={e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : rm(e.basicSalarySen)}
              meta={[e.employeeId, DC_DEPARTMENT_LABEL, POSITION_LABEL[e.position]].filter(Boolean).join(' · ')}
              badge={<StatusBadge tone={statusOf(e).tone} label={statusOf(e).label} size="sm" />} />
            {(mayGrant || mayEdit || maySwitch) && actions(e, 'start')}
          </span>
        )}
      />

      {access && <AccessModal target={access} onClose={() => setAccess(null)} onDone={reload} />}
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
    const { id: _id, employeeId: _employeeId, isActive: _isActive, ...record } = person;
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
    <Modal title={creating ? 'Add employee' : d.name || 'Employee'} eyebrow="Employee Master" sub={creating ? 'Someone who works for Dream Crafter.' : [DC_DEPARTMENT_LABEL, POSITION_LABEL[d.position]].join(' · ')}
      onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : creating ? 'Add employee' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <Section title="Details">
          <Field label="Employee No" value={person?.employeeId ?? ''} readOnly placeholder={creating ? 'Given with app access' : 'No app access yet'}
            help={creating ? undefined : 'Given with app access: use Give app access on the list.'} />
          <Field label="Name" value={d.name} onChange={e => set('name', e.target.value)} placeholder="Ahmad Firdaus" error={errors.name} />
          <PhoneInput label="Phone" value={d.phone ?? ''} onChange={v => set('phone', v || null)} error={errors.phone} />
          <Field label="Department" value={DC_DEPARTMENT_LABEL} readOnly />
          {/* Main's Leader tick as one-tap chips: Leader, or a normal employee; leaving Leader clears the leader allowance. */}
          <div className="sm:col-span-2">
            <ChoiceChips label="Position" value={d.position} help="A leader leads a team and can get the leader allowance."
              options={[{ value: 'employee', label: POSITION_LABEL.employee }, { value: 'leader', label: POSITION_LABEL.leader }]}
              onChange={v => setD(p => ({ ...p, position: v, leaderAllowanceSen: v === 'leader' ? p.leaderAllowanceSen : 0 }))} />
          </div>
          <ChoiceChips label="Status" value={d.status} onChange={v => set('status', v === 'resigned' ? 'resigned' : 'active')}
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
