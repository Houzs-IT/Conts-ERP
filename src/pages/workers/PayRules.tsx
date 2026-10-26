import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { MoneyInput, NumberInput, TimeField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { rm } from '../../lib/format';
import type { PayRules } from '../../../functions/_lib/payrollCalc';

/* ------------------------------------------------------------------ *
 * HR > Employees > Payroll > Pay Rules: Hookka's "Pay Rules (Maintenance)"
 * panel. Every rule payroll uses, as a setting the office changes, since
 * The Conts' own rules are not decided yet (owner, 26 Oct 2026). Shift
 * rules start off. Draft payslips pick changes up on the next refresh;
 * approved ones keep the rules they were made with.
 * ------------------------------------------------------------------ */

const DAY_DIVISOR: Record<PayRules['dayRateDivisorMode'], string> = {
  fixed26: 'Working days a month on the employee record (26)',
  calendarDays: 'The month\'s calendar days',
  workingDays: 'The month\'s working days (Mon to Sat, less holidays)',
};
const HOUR_DIVISOR: Record<PayRules['hourRateDivisorMode'], string> = {
  hoursPlusLunch: 'Daily hours plus lunch',
  hoursOnly: 'Daily hours only',
  fixed: 'A fixed number of hours',
};
const isDayMode = (v: string): v is PayRules['dayRateDivisorMode'] => v in DAY_DIVISOR;
const isHourMode = (v: string): v is PayRules['hourRateDivisorMode'] => v in HOUR_DIVISOR;
const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minutes = (v: string): number | null => (/^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);

export function PayRulesPanel({ rules, full, onSaved }: { rules: PayRules; full: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const box = (title: string, lines: ReactNode[]) => (
    <div className="rounded-control border border-solid border-line px-4 py-3 flex flex-col gap-1">
      <span className="text-meta font-semibold">{title}</span>
      {lines.map((l, i) => <span key={i} className="text-meta text-muted-ink">{l}</span>)}
    </div>
  );
  return (
    <section className="bg-card rounded-card border border-solid border-line">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full pt-5 pb-4 px-5 flex items-center justify-between gap-3 bg-transparent border-0 cursor-pointer text-left [font-family:inherit]">
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Pay Rules (Maintenance)</span>
          <span className="text-meta text-muted-ink">How days, hours, lateness, overtime and statutory are worked out. Shift rules are {rules.useShiftRules ? 'on' : 'off'}.</span>
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size="sm" />
      </button>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {box('Daily & hourly rate', [`Day rate: basic / ${DAY_DIVISOR[rules.dayRateDivisorMode].toLowerCase()}`, `Hour rate: day rate / ${rules.hourRateDivisorMode === 'fixed' ? `${rules.rateHoursPerDay} h` : HOUR_DIVISOR[rules.hourRateDivisorMode].toLowerCase()}`])}
            {box('Shift & working hours', rules.useShiftRules
              ? [`Shift ${hhmm(rules.shiftStartMin)} to ${hhmm(rules.shiftEndMin)}`, `Lunch ${hhmm(rules.lunchStartMin)}, ${rules.lunchMin} min`]
              : ['Shift rules off: hours are clock-out minus clock-in', 'Nothing docked for coming late or leaving early'])}
            {box('Lateness', rules.useShiftRules
              ? [`Forgiven up to ${rules.lateGraceMin} min`, `Charged in blocks of ${rules.lateBlockMin} min, short hours docked at the hour rate`]
              : ['Off with the shift rules'])}
            {box('Overtime', [`Counted in blocks of ${rules.otBlockMin} min`, `Weekday at the person's OT rate · Sunday ${rules.sundayMultiplier}x · Public holiday ${rules.holidayMultiplier}x`])}
            {box('Absence & leave', [`While a month runs, the last ${rules.absenceGraceWorkingDays} working days with nothing logged are pending`, `Emergency leave ${rules.emergencyLeavePaid ? 'paid' : 'unpaid'} · Broken punch ${rules.brokenPunchCreditsFullDay ? 'counts as a full day' : 'is not worked'}`])}
            {box('Statutory', [`EPF ${rules.epfEmployeePct}% / ${rules.epfEmployerPct}% of the ${rules.epfOn === 'basic' ? 'full basic' : 'basic earned'}`, `SOCSO ${rm(rules.socsoEmployeeSen)} / ${rm(rules.socsoEmployerSen)} · EIS ${rm(rules.eisEmployeeSen)} / ${rm(rules.eisEmployerSen)}`])}
          </div>
          <p className="m-0 text-meta text-muted-ink">Started from Hookka's rules. SOCSO and EIS are one amount for everyone, not the contribution tables: check them before the first filing.</p>
          {full && <span><Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Change rules</Button></span>}
        </div>
      )}
      {editing && <RulesForm rules={rules} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onSaved(); }} />}
    </section>
  );
}

function RulesForm({ rules, onClose, onDone }: { rules: PayRules; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<PayRules>(rules);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PayRules>(k: K, v: PayRules[K]) => setR(p => ({ ...p, [k]: v }));
  const time = (k: 'shiftStartMin' | 'shiftEndMin' | 'lunchStartMin', label: string) => (
    <TimeField label={label} value={hhmm(r[k])} onChange={v => { const m = minutes(v); if (m !== null) set(k, m); }} error={errors[k]} disabled={!r.useShiftRules} />
  );
  const check = (k: 'useShiftRules' | 'brokenPunchCreditsFullDay' | 'emergencyLeavePaid', label: string) => (
    <label className="flex items-center gap-2.5 min-h-10 cursor-pointer">
      <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={r[k]} onChange={e => set(k, e.target.checked)} />
      <span className="text-copy">{label}</span>
    </label>
  );
  const section = (title: string, children: ReactNode) => (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-copy font-semibold [border-bottom:1px_solid_var(--color-line-soft)] pb-2">{title}</h3>
      <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">{children}</div>
    </section>
  );

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.put('/payroll/rules', r);
      toast({ tone: 'success', title: 'Pay rules saved.', body: 'Draft payslips use them when you refresh. Approved ones keep the rules they were made with.' });
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Change pay rules" sub="They apply to draft payslips from the next refresh." onClose={onClose} width={640}
      footer={<><Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</Button></>}>
      <div className="flex flex-col gap-6">
        {section('Daily & hourly rate', <>
          <Select label="Day rate is basic divided by" showLabel size="md" value={r.dayRateDivisorMode} onChange={v => isDayMode(v) && set('dayRateDivisorMode', v)}
            options={Object.entries(DAY_DIVISOR).map(([value, label]) => ({ value, label }))} />
          <Select label="Hour rate is day rate divided by" showLabel size="md" value={r.hourRateDivisorMode} onChange={v => isHourMode(v) && set('hourRateDivisorMode', v)}
            options={Object.entries(HOUR_DIVISOR).map(([value, label]) => ({ value, label }))} />
          {r.hourRateDivisorMode === 'fixed' && <NumberInput label="Hours in the fixed divisor" value={r.rateHoursPerDay} decimals={2} min={1} max={24} onChange={v => set('rateHoursPerDay', v ?? 10)} />}
        </>)}
        {section('Shift & working hours', <>
          <div className="sm:col-span-2">{check('useShiftRules', 'Use shift rules (lateness, lunch, overtime after the shift end, short hours docked)')}</div>
          {time('shiftStartMin', 'Shift starts')}
          {time('shiftEndMin', 'Shift ends')}
          {time('lunchStartMin', 'Lunch starts')}
          <NumberInput label="Lunch (minutes, unpaid)" value={r.lunchMin} min={0} max={180} onChange={v => set('lunchMin', v ?? 0)} disabled={!r.useShiftRules} />
        </>)}
        {section('Lateness', <>
          <NumberInput label="Late forgiven up to (minutes)" value={r.lateGraceMin} min={0} max={120} onChange={v => set('lateGraceMin', v ?? 0)} disabled={!r.useShiftRules} />
          <NumberInput label="Lateness charged in blocks of (minutes)" value={r.lateBlockMin} min={1} max={60} onChange={v => set('lateBlockMin', v ?? 1)} disabled={!r.useShiftRules} />
        </>)}
        {section('Overtime', <>
          <NumberInput label="Overtime counted in blocks of (minutes)" value={r.otBlockMin} min={1} max={60} onChange={v => set('otBlockMin', v ?? 15)} />
          <NumberInput label="Sunday hours paid at (x)" value={r.sundayMultiplier} decimals={2} min={1} max={5} onChange={v => set('sundayMultiplier', v ?? 2)} />
          <NumberInput label="Public holiday hours paid at (x)" value={r.holidayMultiplier} decimals={2} min={1} max={5} onChange={v => set('holidayMultiplier', v ?? 3)} />
        </>)}
        {section('Absence & leave', <>
          <NumberInput label="Working days pending before they count as absent" value={r.absenceGraceWorkingDays} min={0} max={10} onChange={v => set('absenceGraceWorkingDays', v ?? 0)} />
          <div className="flex flex-col">
            {check('emergencyLeavePaid', 'Emergency leave is paid')}
            {check('brokenPunchCreditsFullDay', 'A punch with no time in it counts as a full day')}
          </div>
        </>)}
        {section('Statutory', <>
          <Select label="EPF is taken on" showLabel size="md" value={r.epfOn} onChange={v => set('epfOn', v === 'earned' ? 'earned' : 'basic')}
            options={[{ value: 'basic', label: 'The full basic salary (Hookka)' }, { value: 'earned', label: 'The basic earned after absences' }]} />
          <span />
          <NumberInput label="EPF employee %" value={r.epfEmployeePct} decimals={2} min={0} max={30} onChange={v => set('epfEmployeePct', v ?? 0)} />
          <NumberInput label="EPF employer %" value={r.epfEmployerPct} decimals={2} min={0} max={30} onChange={v => set('epfEmployerPct', v ?? 0)} />
          <MoneyInput label="SOCSO employee (RM)" valueSen={r.socsoEmployeeSen} onChangeSen={v => set('socsoEmployeeSen', v ?? 0)} />
          <MoneyInput label="SOCSO employer (RM)" valueSen={r.socsoEmployerSen} onChangeSen={v => set('socsoEmployerSen', v ?? 0)} />
          <MoneyInput label="EIS employee (RM)" valueSen={r.eisEmployeeSen} onChangeSen={v => set('eisEmployeeSen', v ?? 0)} />
          <MoneyInput label="EIS employer (RM)" valueSen={r.eisEmployerSen} onChangeSen={v => set('eisEmployerSen', v ?? 0)} />
        </>)}
        {errors.form && <p className="m-0 text-meta text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
