import { useMemo, useState, type ReactNode } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, NumberInput, DateField, PhoneInput, phoneProblem } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayRun, mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, plural, todayMyt } from '../../lib/format';
import {
  EMPLOYEE_DEFAULTS, POSITION_LABEL, MALAYSIAN_BANKS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, TAX_RESIDENCIES, TAX_RESIDENCY_LABEL,
  TAX_CATEGORIES, TAX_CATEGORY_LABEL, type Employee, type EmployeeInput,
} from '../../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * HR > Employees > Employee Master: Hookka's Employee Master for the
 * in-house cleaners and technicians (owner, 26 Oct 2026): its columns,
 * Add Employee and its employee form, in The Conts' own look. No IC or
 * passport number is asked for. A person's department is the roster they
 * are on (Cleaning, Maintenance); adding one here puts them on it.
 * ------------------------------------------------------------------ */

const STATUTORY: { key: 'epfEnabled' | 'socsoEnabled' | 'eisEnabled' | 'pcbEnabled'; label: string; hint: string }[] = [
  { key: 'epfEnabled', label: 'EPF', hint: 'KWSP retirement savings' },
  { key: 'socsoEnabled', label: 'SOCSO', hint: 'PERKESO injury cover' },
  { key: 'eisEnabled', label: 'EIS', hint: 'Employment insurance' },
  { key: 'pcbEnabled', label: 'PCB', hint: 'Monthly tax deduction' },
];

const departmentsOf = ({ cleanerId, technicianId }: Pick<Employee, 'cleanerId' | 'technicianId'>): string =>
  [cleanerId && 'Cleaning', technicianId && 'Maintenance'].filter(Boolean).join(', ');
const paidBy = (e: Employee): string => (e.paymentMethod === 'cash' ? 'Cash' : 'Transfer');
const account = (e: Employee): string => (e.paymentMethod === 'cash' || !e.bankAccount ? '' : `****${e.bankAccount.slice(-4)}`);
const statutoryOf = (e: Employee): string => STATUTORY.filter(s => e[s.key]).map(s => s.label).join(' · ') || 'None';
function statusOf(e: Employee): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (e.status === 'resigned') return { label: 'Resigned', tone: 'neutral' };
  if (!e.isActive) return { label: 'Switched off', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

export default function EmployeesTab() {
  const { data, loading, error, reload } = useApi<{ data: Employee[] }>('/employees');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [form, setForm] = useState<{ person: Employee | null } | null>(null);
  const [given, setGiven] = useState<{ name: string; employeeId: string; pin: string } | null>(null);
  const people = data?.data ?? [];

  const columns = useMemo<Column<Employee>[]>(() => [
    { key: 'empNo', label: 'Emp No', value: e => e.employeeId, width: 100 },
    { key: 'name', label: 'Name', value: e => e.name, hideable: false, width: 190, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'departments', label: 'Departments', value: departmentsOf, width: 170 },
    { key: 'position', label: 'Position', value: e => POSITION_LABEL[e.position], width: 120 },
    { key: 'phone', label: 'Phone', type: 'phone', value: e => e.phone, width: 150 },
    { key: 'basic', label: 'Basic Salary', type: 'money', value: e => (e.payBasis === 'daily' ? e.dailyRateSen : e.basicSalarySen), width: 140,
      render: e => e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : rm(e.basicSalarySen) },
    { key: 'hours', label: 'Hrs/Day', type: 'number', value: e => e.workingHoursPerDay, width: 90 },
    { key: 'days', label: 'Days/Mo', type: 'number', value: e => e.workingDaysPerMonth, width: 90 },
    { key: 'ot', label: 'OT ×', type: 'number', value: e => e.otMultiplier, width: 80 },
    { key: 'effAllowance', label: 'Eff. Allowance', type: 'money', value: e => e.efficiencyAllowanceSen, width: 130 },
    { key: 'effThreshold', label: 'Eff. Threshold %', type: 'number', value: e => e.efficiencyThresholdPct, width: 130 },
    { key: 'leader', label: 'Leader Allowance', type: 'money', value: e => e.leaderAllowanceSen, width: 140 },
    { key: 'payBy', label: 'Pay By', value: paidBy, width: 100 },
    { key: 'bank', label: 'Bank', value: e => (e.paymentMethod === 'cash' ? null : e.bankName), width: 140 },
    { key: 'account', label: 'Account No', value: account, width: 120 },
    { key: 'statutory', label: 'Statutory', value: statutoryOf, width: 180 },
    { key: 'joined', label: 'Join Date', type: 'date', value: e => e.joinDate, width: 120 },
    { key: 'nationality', label: 'Nationality', value: e => e.nationality, width: 120 },
    { key: 'status', label: 'Status', type: 'status', value: e => statusOf(e).label, status: statusOf, width: 120 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 100, align: 'right',
      render: e => mayEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setForm({ person: e })}>Edit</Button> : null },
  ], [mayEdit]);

  return (
    <>
      <p className="m-0 mb-4 text-copy text-muted-ink">{data ? plural(people.length, 'employee') : 'Loading the list…'}</p>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<Employee>
        id="employees" columns={columns} rows={loading && people.length === 0 ? null : people}
        rowKey={e => e.cleanerId ?? e.technicianId ?? e.name} pageSize={0} noun={['employee', 'employees']} exportName="employee-master"
        rowTone={e => (e.status === 'resigned' || !e.isActive ? 'muted' : null)}
        onRowClick={mayEdit ? e => setForm({ person: e }) : undefined}
        header={
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Employee Master</span>
              <span className="text-meta text-muted-ink">The company's own cleaners and technicians, with their pay and statutory details.</span>
            </span>
            {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setForm({ person: null })}>Add Employee</Button>}
          </div>
        }
        empty={{ title: 'No employees yet.', body: 'Add the first cleaner or technician.', action: mayEdit ? { label: 'Add Employee', onClick: () => setForm({ person: null }) } : undefined }}
        renderCard={e => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{e.name}</span>
              {statusOf(e).tone !== 'success' && <StatusBadge tone={statusOf(e).tone} label={statusOf(e).label} size="sm" />}
            </span>
            <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap">
              {e.employeeId && <span>{e.employeeId}</span>}
              <span>{departmentsOf(e)} · {POSITION_LABEL[e.position]}</span>
              <span>{e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : `${rm(e.basicSalarySen)} / month`}</span>
            </span>
          </span>
        )}
      />

      {form && (
        <EmployeeForm person={form.person} onClose={() => setForm(null)}
          onSaved={g => { setForm(null); if (g) setGiven(g); reload(); }} />
      )}
      {given && (
        <Modal title={`${given.name} can sign in`} sub="Give them these. The PIN is shown only once." onClose={() => setGiven(null)}
          footer={<Button size="sm" variant="primary" onClick={() => setGiven(null)}>Done</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-control bg-page px-4 py-3"><span className="block text-meta text-muted-ink">Employee ID</span><span className="text-[20px] font-bold tabular-nums">{given.employeeId}</span></div>
            <div className="rounded-control bg-page px-4 py-3"><span className="block text-meta text-muted-ink">First PIN</span><span className="text-[20px] font-bold tabular-nums">{given.pin}</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

type Dept = 'cleaning' | 'maintenance';
const ROSTER: Record<Dept, string> = { cleaning: '/housekeeping/cleaners', maintenance: '/maintenance/technicians' };

/**
 * Add or edit one employee. Adding puts them on the roster of each department ticked (Cleaning first when both) and,
 * when asked, gives them app access; two departments share one login, so both need app access. Name and phone live on
 * the roster and are saved there; everything else is the HR record.
 */
function EmployeeForm({ person, onClose, onSaved }: {
  person: Employee | null; onClose: () => void; onSaved: (given: { name: string; employeeId: string; pin: string } | null) => void;
}) {
  const toast = useToast();
  const { user } = useSession();
  const mayGrant = mayRun(user, 'operations');
  const creating = !person;
  const start: EmployeeInput = person ?? EMPLOYEE_DEFAULTS;
  const [d, setD] = useState<EmployeeInput>(() => {
    if (!person) return { ...EMPLOYEE_DEFAULTS, joinDate: todayMyt() };
    const { id: _id, cleanerId: _c, technicianId: _t, name: _n, phone: _p, employeeId: _e, isActive: _a, ...record } = person;
    return record;
  });
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [depts, setDepts] = useState<Dept[]>(person ? [] : ['cleaning']);
  const [giveAccess, setGiveAccess] = useState(mayGrant);
  const [salaryFrom, setSalaryFrom] = useState(`${todayMyt().slice(0, 7)}-01`);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setD(p => ({ ...p, [k]: v }));
  const daily = d.payBasis === 'daily';
  const salaryChanged = !creating && !daily && d.basicSalarySen > 0 && d.basicSalarySen !== start.basicSalarySen;
  const toggleDept = (dep: Dept, on: boolean) => setDepts(p => (on ? [...p.filter(x => x !== dep), dep] : p.filter(x => x !== dep)).sort());

  async function save() {
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = 'Enter their name.';
    const phoneError = phone.trim() ? phoneProblem(phone) : null;
    if (phoneError) problems.phone = phoneError;
    if (creating && depts.length === 0) problems.departments = 'Tick at least one department.';
    if (creating && depts.length === 2 && !giveAccess) problems.departments = 'Both departments share one app login: give app access, or tick one.';
    if (Object.keys(problems).length) { setErrors(problems); return; }
    setBusy(true);
    setErrors({});
    try {
      let cleanerId = person?.cleanerId ?? null, technicianId = person?.technicianId ?? null;
      let given: { name: string; employeeId: string; pin: string } | null = null;
      const roster = { name: name.trim(), phone: phone.trim() || null };
      if (creating) {
        const [first, second] = depts;
        const { id } = await api.post<{ id: string }>(ROSTER[first], { ...roster, employmentType: 'internal', vendorName: null });
        if (first === 'cleaning') cleanerId = id; else technicianId = id;
        let userId: string | null = null;
        if (giveAccess) {
          const g = await api.post<{ employeeId: string; pin: string; userId: string }>(`${ROSTER[first]}/${id}/access`, {});
          given = { name: roster.name, employeeId: g.employeeId, pin: g.pin };
          userId = g.userId;
        }
        if (second) {
          const { id: id2 } = await api.post<{ id: string }>(ROSTER[second], { ...roster, employmentType: 'internal', vendorName: null, userId });
          technicianId = id2;
        }
      } else {
        // Name and phone are kept on the roster, once per department.
        if (roster.name !== person.name || roster.phone !== person.phone) {
          if (cleanerId) await api.patch(`${ROSTER.cleaning}/${cleanerId}`, { name: roster.name, phone: roster.phone ?? '' });
          if (technicianId) await api.patch(`${ROSTER.maintenance}/${technicianId}`, { name: roster.name, phone: roster.phone ?? '' });
        }
      }
      await api.put('/employees', { ...d, cleanerId, technicianId, ...(salaryChanged ? { salaryEffectiveFrom: salaryFrom } : {}) });
      toast({ tone: 'success', title: creating ? 'Employee added.' : 'Employee saved.', body: roster.name });
      onSaved(given);
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={creating ? 'Add Employee' : name || 'Employee'} sub={creating ? 'A cleaner or technician on the company payroll.' : [person.employeeId, departmentsOf(person), POSITION_LABEL[d.position]].filter(Boolean).join(' · ')}
      onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : creating ? 'Add Employee' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <Section title="Details">
          <Field label="Employee No" value={person?.employeeId ?? ''} readOnly placeholder={creating ? 'Given with app access' : 'No app access yet'}
            help={creating ? undefined : 'Given when app access is set up on Operations > Workers.'} />
          <Field label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Nurul Huda" error={errors.name} />
          <PhoneInput label="Phone" value={phone} onChange={setPhone} error={errors.phone} />
          <label className="sm:col-span-2 flex items-center gap-2.5 min-h-10 cursor-pointer">
            <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={d.position === 'leader'}
              onChange={e => setD(p => ({ ...p, position: e.target.checked ? 'leader' : 'employee', leaderAllowanceSen: e.target.checked ? p.leaderAllowanceSen : 0 }))} />
            <span className="flex flex-col">
              <span className="text-copy font-medium">Leader</span>
              <span className="text-meta text-muted-ink">Leads a team and can get the leader allowance. Unticked: a normal employee.</span>
            </span>
          </label>
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <span className="text-meta font-medium text-muted-ink">Departments</span>
            {creating ? (
              <span className="flex gap-5 flex-wrap">
                {(['cleaning', 'maintenance'] as const).map(dep => (
                  <label key={dep} className="flex items-center gap-2.5 min-h-10 cursor-pointer">
                    <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={depts.includes(dep)} onChange={e => toggleDept(dep, e.target.checked)} />
                    <span className="text-copy">{dep === 'cleaning' ? 'Cleaning' : 'Maintenance'}</span>
                  </label>
                ))}
              </span>
            ) : <span className="text-copy min-h-10 flex items-center">{departmentsOf(person)}</span>}
            {errors.departments && <span className="text-meta text-danger">{errors.departments}</span>}
          </div>
          <Select label="Status" showLabel size="md" value={d.status} onChange={v => set('status', v === 'resigned' ? 'resigned' : 'active')}
            options={[{ value: 'active', label: 'Active' }, { value: 'resigned', label: 'Resigned' }]} />
          <DateField label="Join date" value={d.joinDate ?? ''} onChange={v => set('joinDate', v || null)} error={errors.joinDate} />
          {d.status === 'resigned' && (
            <DateField label="Last working day" value={d.resignedAt ?? ''} onChange={v => set('resignedAt', v || null)} required error={errors.resignedAt} />
          )}
          <Field label="Nationality" value={d.nationality ?? ''} onChange={e => set('nationality', e.target.value)} placeholder="Malaysian" error={errors.nationality} />
          {creating && mayGrant && (
            <label className="sm:col-span-2 flex items-center gap-2.5 min-h-10 cursor-pointer">
              <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={giveAccess} onChange={e => setGiveAccess(e.target.checked)} />
              <span className="text-copy">Give app access now (employee ID and first PIN)</span>
            </label>
          )}
        </Section>

        <Section title="Pay">
          <label className="sm:col-span-2 flex items-center gap-2.5 min-h-10 cursor-pointer">
            <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={daily} onChange={e => set('payBasis', e.target.checked ? 'daily' : 'monthly')} />
            <span className="text-copy">Paid per day instead of a monthly salary</span>
          </label>
          {daily
            ? <MoneyInput label="Rate per day (RM)" valueSen={d.dailyRateSen || null} onChangeSen={v => set('dailyRateSen', v ?? 0)} error={errors.dailyRateSen} />
            : <MoneyInput label="Basic salary (RM)" valueSen={d.basicSalarySen || null} onChangeSen={v => set('basicSalarySen', v ?? 0)} error={errors.basicSalarySen} />}
          <NumberInput label="Days / month" value={d.workingDaysPerMonth} onChange={v => set('workingDaysPerMonth', v ?? 26)} min={1} max={31} help="The divisor for the day rate." error={errors.workingDaysPerMonth} />
          {salaryChanged && (
            <DateField label="New salary takes effect from" value={salaryFrom} onChange={v => v && setSalaryFrom(v)} required
              help="Months ending on or after this day are paid on the new salary. Approved payslips stay as they are." />
          )}
          <NumberInput label="Hours / day" value={d.workingHoursPerDay} onChange={v => set('workingHoursPerDay', v ?? 8)} decimals={2} min={0.5} max={24}
            help="Their standard day: the overtime line, and what a short day is short of." error={errors.workingHoursPerDay} />
          <NumberInput label="OT multiplier" value={d.otMultiplier} onChange={v => set('otMultiplier', v ?? 1.5)} decimals={2} min={1} max={5} error={errors.otMultiplier} />
          {d.position === 'leader' && (
            <MoneyInput label="Leader allowance (RM)" valueSen={d.leaderAllowanceSen || null} onChangeSen={v => set('leaderAllowanceSen', v ?? 0)}
              help="Each month, less the share of working days missed." error={errors.leaderAllowanceSen} />
          )}
          <MoneyInput label="Eff. allowance (RM)" valueSen={d.efficiencyAllowanceSen || null} onChangeSen={v => set('efficiencyAllowanceSen', v ?? 0)}
            help="Paid once production time is decided." error={errors.efficiencyAllowanceSen} />
          <NumberInput label="Eff. threshold %" value={d.efficiencyThresholdPct} onChange={v => set('efficiencyThresholdPct', v ?? 100)} min={0} max={200} error={errors.efficiencyThresholdPct} />
        </Section>

        <Section title="How they are paid">
          <Select label="Method" showLabel size="md" value={d.paymentMethod} onChange={v => set('paymentMethod', PAYMENT_METHODS.find(m => m === v) ?? 'transfer')}
            options={PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
          {d.paymentMethod === 'transfer' && <>
            <Select label="Bank" showLabel size="md" value={d.bankName ?? ''} placeholder="Pick a bank" onChange={v => set('bankName', MALAYSIAN_BANKS.find(b => b === v) ?? null)}
              options={MALAYSIAN_BANKS.map(b => ({ value: b, label: b }))} />
            <Field label="Account number" inputMode="numeric" value={d.bankAccount ?? ''} onChange={e => set('bankAccount', e.target.value)} placeholder="Digits only" error={errors.bankAccount} />
          </>}
        </Section>

        <Section title="Statutory" note="Each one is taken from their pay only when ticked.">
          {STATUTORY.map(s => (
            <label key={s.key} className="flex items-center gap-2.5 min-h-10 cursor-pointer">
              <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={d[s.key]} onChange={e => set(s.key, e.target.checked)} />
              <span className="flex flex-col">
                <span className="text-copy font-medium">{s.label}</span>
                <span className="text-meta text-muted-ink">{s.hint}</span>
              </span>
            </label>
          ))}
        </Section>

        {d.pcbEnabled && (
          <Section title="PCB tax declaration" note="Leave a field empty until the employee declares it: PCB is not worked out on a guess.">
            <Select label="Tax residency" showLabel size="md" value={d.taxResidency ?? ''} placeholder="Not declared"
              onChange={v => set('taxResidency', TAX_RESIDENCIES.find(r => r === v) ?? null)}
              options={TAX_RESIDENCIES.map(r => ({ value: r, label: TAX_RESIDENCY_LABEL[r] }))} />
            <Select label="Marital category" showLabel size="md" value={d.taxCategory ?? ''} placeholder="Not declared"
              onChange={v => set('taxCategory', TAX_CATEGORIES.find(c => c === v) ?? null)}
              options={TAX_CATEGORIES.map(c => ({ value: c, label: TAX_CATEGORY_LABEL[c] }))} />
            <MoneyInput label="Child relief a year (RM)" valueSen={d.taxChildReliefSen} onChangeSen={v => set('taxChildReliefSen', v)} placeholder="Not declared" error={errors.taxChildReliefSen} />
          </Section>
        )}

        {errors.form && <p className="m-0 text-meta text-danger">{errors.form}</p>}
        {person && person.status === 'active' && d.status === 'resigned' && (
          <p className="m-0 text-meta text-muted-ink">Resigning keeps the record. To stop their app sign-in and new jobs, switch them off on Operations &gt; Workers.</p>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 [border-bottom:1px_solid_var(--color-line-soft)] pb-2">
        <h3 className="m-0 text-copy font-semibold">{title}</h3>
        {note && <p className="m-0 text-meta text-muted-ink">{note}</p>}
      </div>
      <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">{children}</div>
    </section>
  );
}
