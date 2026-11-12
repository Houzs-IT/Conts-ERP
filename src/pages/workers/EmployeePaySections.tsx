import type { ReactNode } from 'react';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, NumberInput, DateField } from '../../components/inputs';
import {
  MALAYSIAN_BANKS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, TAX_RESIDENCIES, TAX_RESIDENCY_LABEL, TAX_CATEGORIES, TAX_CATEGORY_LABEL,
  type EmployeeInput,
} from '../../../functions/_lib/hrFields';

const STATUTORY: { key: 'epfEnabled' | 'socsoEnabled' | 'eisEnabled' | 'pcbEnabled'; label: string; hint: string }[] = [
  { key: 'epfEnabled', label: 'EPF', hint: 'KWSP retirement savings' },
  { key: 'socsoEnabled', label: 'SOCSO', hint: 'PERKESO injury cover' },
  { key: 'eisEnabled', label: 'EIS', hint: 'Employment insurance' },
  { key: 'pcbEnabled', label: 'PCB', hint: 'Monthly tax deduction' },
];

export function EmployeePaySections({ record: d, onChange: set, errors, salaryChanged, salaryFrom, onSalaryFromChange, payNote }: {
  record: EmployeeInput; onChange: <K extends Exclude<keyof EmployeeInput, 'status'>>(key: K, value: EmployeeInput[K]) => void; errors: Record<string, string>;
  salaryChanged: boolean; salaryFrom: string; onSalaryFromChange: (value: string) => void; payNote?: string;
}) {
  const daily = d.payBasis === 'daily';
  return (
    <>
      <Section title="Pay" note={payNote}>
        <label className="sm:col-span-2 flex items-center gap-2.5 min-h-10 cursor-pointer">
          <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={daily} onChange={e => set('payBasis', e.target.checked ? 'daily' : 'monthly')} />
          <span className="text-copy">Paid per day instead of a monthly salary</span>
        </label>
        {daily
          ? <MoneyInput label="Rate per day (RM)" valueSen={d.dailyRateSen || null} onChangeSen={v => set('dailyRateSen', v ?? 0)} error={errors.dailyRateSen} />
          : <MoneyInput label="Basic salary (RM)" valueSen={d.basicSalarySen || null} onChangeSen={v => set('basicSalarySen', v ?? 0)} error={errors.basicSalarySen} />}
        <NumberInput label="Days / month" value={d.workingDaysPerMonth} onChange={v => set('workingDaysPerMonth', v ?? 26)} min={1} max={31} help="The divisor for the day rate." error={errors.workingDaysPerMonth} />
        {salaryChanged && (
          <DateField label="New salary takes effect from" value={salaryFrom} onChange={v => v && onSalaryFromChange(v)} required
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
    </>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
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
