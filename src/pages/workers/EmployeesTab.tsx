import { useMemo, useState, type ReactNode } from 'react';
import PageHeader from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, NumberInput, DateField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, plural } from '../../lib/format';
import {
  MALAYSIAN_BANKS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PAY_BASES, PAY_BASIS_LABEL, TAX_RESIDENCIES, TAX_RESIDENCY_LABEL,
  TAX_CATEGORIES, TAX_CATEGORY_LABEL, type Employee, type EmployeeInput,
} from '../../../functions/_lib/hrFields';

/* ------------------------------------------------------------------ *
 * HR > Workers > Employees: the HR record of every in-house cleaner and
 * technician (migration 0162), ported from Hookka's Employee Master.
 * People are added on the Cleaners and Technicians tabs; this tab keeps
 * their IC, pay, bank, statutory and tax details for payroll.
 * ------------------------------------------------------------------ */

const STATUTORY: { key: 'epfEnabled' | 'socsoEnabled' | 'eisEnabled' | 'pcbEnabled'; label: string; hint: string }[] = [
  { key: 'epfEnabled', label: 'EPF', hint: 'KWSP retirement savings' },
  { key: 'socsoEnabled', label: 'SOCSO', hint: 'PERKESO injury cover' },
  { key: 'eisEnabled', label: 'EIS', hint: 'Employment insurance' },
  { key: 'pcbEnabled', label: 'PCB', hint: 'Monthly tax deduction' },
];

const roleOf = ({ cleanerId, technicianId }: Employee): string =>
  cleanerId && technicianId ? 'Cleaner and technician' : cleanerId ? 'Cleaner' : 'Technician';
const payOf = (e: Employee): string => e.payBasis === 'daily' ? `${rm(e.dailyRateSen)} / day` : `${rm(e.basicSalarySen)} / month`;
const paidBy = (e: Employee): string =>
  e.paymentMethod === 'cash' ? 'Cash' : e.bankName ? `${e.bankName}${e.bankAccount ? ` ·${e.bankAccount.slice(-4)}` : ''}` : 'Bank not set';
const statutoryOf = (e: Employee): string => STATUTORY.filter(s => e[s.key]).map(s => s.label).join(' · ') || 'None';
function statusOf(e: Employee): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (e.status === 'resigned') return { label: 'Resigned', tone: 'neutral' };
  if (!e.isActive) return { label: 'Switched off', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

export default function EmployeesTab({ tabs }: { tabs: ReactNode }) {
  const { data, loading, error, reload } = useApi<{ data: Employee[] }>('/employees');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [editing, setEditing] = useState<Employee | null>(null);

  const people = data?.data ?? [];
  const notSet = people.filter(e => e.status === 'active' && !e.id).length;

  const columns = useMemo<Column<Employee>[]>(() => [
    { key: 'name', label: 'Name', value: e => e.name, hideable: false, width: 200, render: e => <span className="font-semibold">{e.name}</span> },
    { key: 'empNo', label: 'Employee ID', value: e => e.employeeId, width: 120 },
    { key: 'role', label: 'Works as', value: roleOf, width: 170 },
    { key: 'joined', label: 'Joined', type: 'date', value: e => e.joinDate, width: 120 },
    { key: 'pay', label: 'Pay', type: 'money', value: e => (e.payBasis === 'daily' ? e.dailyRateSen : e.basicSalarySen), render: payOf, width: 170 },
    { key: 'paidBy', label: 'Paid by', value: paidBy, width: 170 },
    { key: 'statutory', label: 'Statutory', value: statutoryOf, width: 190 },
    { key: 'status', label: 'Status', type: 'status', value: e => statusOf(e).label, status: statusOf, width: 120 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 110, align: 'right',
      render: e => mayEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(e)}>Edit</Button> : null },
  ], [mayEdit]);

  return (
    <>
      <PageHeader title="Workers" sub={data ? `${plural(people.length, 'employee')}${notSet ? ` · ${notSet} without a record yet` : ''}` : 'Loading the list…'} />
      <div className="mb-4">{tabs}</div>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<Employee>
        id="employees" columns={columns} rows={loading && people.length === 0 ? null : people}
        rowKey={e => e.cleanerId ?? e.technicianId ?? e.name} pageSize={0} noun={['employee', 'employees']} exportName="employees"
        rowTone={e => (e.status === 'resigned' || !e.isActive ? 'muted' : null)}
        onRowClick={mayEdit ? setEditing : undefined}
        header={
          <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">In-house staff</span>
            <span className="text-meta text-muted-ink">Pay, bank, statutory and tax details for payroll. Add people on the Cleaners or Technicians tab.</span>
          </div>
        }
        empty={{ title: 'No in-house staff yet.', body: 'Add an internal cleaner or an in-house technician first; they show here.' }}
        renderCard={e => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{e.name}</span>
              {statusOf(e).tone !== 'success' && <StatusBadge tone={statusOf(e).tone} label={statusOf(e).label} size="sm" />}
              {!e.id && e.status === 'active' && <StatusBadge tone="warning" label="No record yet" size="sm" />}
            </span>
            <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap">
              {e.employeeId && <span>{e.employeeId}</span>}
              <span>{roleOf(e)}</span>
              <span>{payOf(e)}</span>
              <span>{paidBy(e)}</span>
            </span>
            {mayEdit && <span className="flex justify-start pt-1"><Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(e)}>Edit</Button></span>}
          </span>
        )}
      />

      {editing && <EmployeeModal person={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function EmployeeModal({ person, onClose, onSaved }: { person: Employee; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { id: _id, cleanerId, technicianId, name, phone: _phone, employeeId, isActive: _isActive, ...start } = person;
  const [d, setD] = useState<EmployeeInput>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) => setD(p => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.put('/employees', { ...d, cleanerId, technicianId });
      toast({ tone: 'success', title: 'Employee record saved.', body: `${name}.` });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  const daily = d.payBasis === 'daily';
  return (
    <Modal title={name} sub={[employeeId, roleOf(person)].filter(Boolean).join(' · ')} onClose={onClose} width={620}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <Section title="Details">
          <Field label="IC number" value={d.icNumber ?? ''} onChange={e => set('icNumber', e.target.value)} placeholder="900101-14-5678" error={errors.icNumber} />
          <Field label="Passport number" value={d.passportNumber ?? ''} onChange={e => set('passportNumber', e.target.value)} placeholder="For non-Malaysians" error={errors.passportNumber} />
          <Field label="Nationality" value={d.nationality ?? ''} onChange={e => set('nationality', e.target.value)} placeholder="Malaysian" error={errors.nationality} />
          <DateField label="Joined on" value={d.joinDate ?? ''} onChange={v => set('joinDate', v || null)} error={errors.joinDate} />
          <Select label="Status" showLabel size="md" value={d.status} onChange={v => set('status', v === 'resigned' ? 'resigned' : 'active')}
            options={[{ value: 'active', label: 'Active' }, { value: 'resigned', label: 'Resigned' }]} />
          {d.status === 'resigned' && (
            <DateField label="Last working day" value={d.resignedAt ?? ''} onChange={v => set('resignedAt', v || null)} required error={errors.resignedAt} />
          )}
        </Section>

        <Section title="Pay">
          <Select label="Paid by" showLabel size="md" value={d.payBasis} onChange={v => set('payBasis', PAY_BASES.find(b => b === v) ?? 'monthly')}
            options={PAY_BASES.map(b => ({ value: b, label: PAY_BASIS_LABEL[b] }))} />
          {daily
            ? <MoneyInput label="Rate per day (RM)" valueSen={d.dailyRateSen} onChangeSen={v => set('dailyRateSen', v ?? 0)} error={errors.dailyRateSen} />
            : <MoneyInput label="Basic salary (RM a month)" valueSen={d.basicSalarySen} onChangeSen={v => set('basicSalarySen', v ?? 0)} error={errors.basicSalarySen} />}
          <NumberInput label="Working days a month" value={d.workingDaysPerMonth} onChange={v => set('workingDaysPerMonth', v ?? 26)} min={1} max={31} error={errors.workingDaysPerMonth} />
          <NumberInput label="Hours a day" value={d.workingHoursPerDay} onChange={v => set('workingHoursPerDay', v ?? 8)} decimals={2} min={0.5} max={24} error={errors.workingHoursPerDay} />
          <NumberInput label="Overtime rate (times hourly pay)" value={d.otMultiplier} onChange={v => set('otMultiplier', v ?? 1.5)} decimals={2} min={1} max={5} error={errors.otMultiplier} />
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

        <Section title="Statutory" note="Each one is taken from their pay only when ticked. All start off.">
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

        <Section title="Leave" note="Empty follows the Employment Act for their years of service.">
          <NumberInput label="Annual leave days a year" value={d.annualLeaveDays} onChange={v => set('annualLeaveDays', v)} min={0} max={60} placeholder="By the Act" error={errors.annualLeaveDays} />
          <NumberInput label="Medical leave days a year" value={d.medicalLeaveDays} onChange={v => set('medicalLeaveDays', v)} min={0} max={60} placeholder="By the Act" error={errors.medicalLeaveDays} />
        </Section>

        {errors.form && <p className="m-0 text-meta text-danger">{errors.form}</p>}
        {!person.id && <p className="m-0 text-meta text-muted-ink">No record has been saved for {name} yet: these are the starting values.</p>}
        {person.status === 'active' && d.status === 'resigned' && (
          <p className="m-0 text-meta text-muted-ink">Resigning keeps the record. To stop their app sign-in and new jobs, deactivate them on the {person.cleanerId ? 'Cleaners' : 'Technicians'} tab.</p>
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
