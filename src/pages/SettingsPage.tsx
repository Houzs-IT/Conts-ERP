import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { SystemStats } from '../components/SystemStats';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, PercentInput, PhoneInput, TimeField } from '../components/inputs';
import { Select, type SelectOption } from '../components/Select';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { useSession } from '../lib/session';
import { ROLE_LABEL } from '../lib/vocabulary';
import { refreshNavCounts } from '../lib/navBadges';

/* ------------------------------------------------------------------ *
 * Settings — organisation-wide defaults (routes.json → SYSTEM →
 * SettingsPage): Company, Management fee, Operations defaults, Owner
 * report, Approvals, Security. Only settings something in the system
 * reads are shown (owner, 11 Oct 2026); BUTTONS.md §14: every field
 * saves through PUT /api/settings and every write is audited.
 *
 * Each section owns its own Save button and dirty state so one edit
 * never commits another section's half-finished change. There is no
 * backend in dev, so a save is applied to a local overlay first and the
 * real PUT is attempted in a swallowed try/catch — the interaction is
 * always visible whether or not the endpoint answers.
 * ------------------------------------------------------------------ */

type SectionKey = 'company' | 'locale' | 'operations' | 'report' | 'approvals' | 'security';

interface Settings {
  company: { legalName: string; companyNumber: string; address: string; supportPhone: string; supportEmail: string };
  /** Statements use the fee for a unit whose contract has none (functions/_lib/ownerStatement.ts). */
  locale: { managementFeePct: number };
  /** The housekeeping board's standard times (functions/api/housekeeping/board.ts). */
  operations: { checkIn: string; checkOut: string };
  /** The Owner Income Report's wording; miscChargeMonthly is sen. Terms are one per line. */
  report: { paymentTerms: string; monthlyTerms: string; yearTerms: string; miscChargeMonthly: number };
  /** Maker-checker, off by default (owner, 11 Oct 2026); limits in sen (functions/_lib/approvals.ts). */
  approvals: { enabled: boolean; expenseThreshold: number; financeAdminLimit: number };
  security: {
    staffInactivityTimeoutMins: number; ownerInactivityTimeoutMins: number;
    absoluteTimeoutHours: number; lockoutAttempts: number; lockoutMinutes: number;
    /** Comma-separated roles that must use two-step sign-in. */
    require2faRoles: string;
  };
  generatedAt: string;
}

const FALLBACK: Settings = {
  generatedAt: '',
  company: {
    legalName: 'The Conts Sdn. Bhd.',
    companyNumber: '202301027399 (1521322-V)',
    address: 'E-28-02 & E-28-03, Menara Suezcap 2, KL Gateway,\nNo. 2, Jalan Kerinchi, Gerbang Kerinchi Lestari,\n59200 Kuala Lumpur, W.P. Kuala Lumpur.',
    supportPhone: '+60 11-6133 3289',
    supportEmail: 't.conts725@gmail.com',
  },
  locale: { managementFeePct: 25 },
  operations: { checkIn: '15:00', checkOut: '11:00' },
  report: { paymentTerms: '7th every month', monthlyTerms: '', yearTerms: '', miscChargeMonthly: 10000 },
  approvals: { enabled: false, expenseThreshold: 50000, financeAdminLimit: 200000 },
  security: { staffInactivityTimeoutMins: 10080, ownerInactivityTimeoutMins: 480, absoluteTimeoutHours: 720, lockoutAttempts: 5, lockoutMinutes: 15, require2faRoles: '' },
};

/* -------------------------------- options -------------------------------- */
const TWO_STEP_ROLES = ['management', 'finance_admin', 'operations_manager', 'operations_staff', 'housekeeper', 'technician', 'owner'];
const INACTIVITY = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
  { value: 10080, label: '7 days' },
];
const INACTIVITY_OPTIONS = INACTIVITY.map(o => ({ value: String(o.value), label: o.label }));
const ABSOLUTE = [
  { value: 8, label: '8 hours' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

/** The shared Select, with its label above and an optional help line, to sit beside Field inputs. */
function SelectField({ label, value, onChange, help, options }: {
  label: string; value: string | number; onChange: (v: string) => void; help?: string; options: SelectOption[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Select label={label} showLabel size="md" value={String(value)} onChange={onChange} options={options} />
      {help && <span className="text-meta text-muted-ink">{help}</span>}
    </div>
  );
}

/** Accessible switch. On-state is neutral ink, never a status tone. */
function ToggleField({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-5 cursor-pointer">
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-copy font-medium">{label}</span>
        {description && <span className="text-meta text-muted-ink leading-[1.45]">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'flex-none w-[42px] h-6 rounded-full border-none p-0.5 cursor-pointer flex items-center',
          '[transition:background_var(--motion-fast)_var(--ease-out)]',
          checked ? 'bg-ink justify-end' : 'bg-line-strong justify-start',
        )}
      >
        <span className="w-5 h-5 rounded-full bg-white [box-shadow:0_1px_2px_rgba(21,21,21,0.25)]" />
      </button>
    </label>
  );
}

/** One saveable section. Owns its Save / Discard controls and dirty pill. */
function SectionCard({ title, description, dirty, busy, onSave, onDiscard, saveLabel, children, readOnly }: {
  title: string; description: string; dirty: boolean; busy: boolean; readOnly?: boolean;
  onSave: () => void; onDiscard: () => void; saveLabel: string; children: ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 pt-5 pb-4 [border-bottom:1px_solid_var(--color-line-soft)] flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
          <span className="text-meta text-muted-ink leading-[1.45]">{description}</span>
        </div>
        {readOnly ? <StatusBadge tone="neutral" label="Management changes these" size="sm" /> : <div className="flex items-center gap-2 flex-wrap">
          {dirty && (
            <StatusBadge tone="warning" label="Unsaved changes" size="sm" />
          )}
          {dirty && <Button variant="tertiary" size="sm" onClick={onDiscard} disabled={busy}>Discard</Button>}
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            loading={busy}
            disabled={!dirty}
            disabledReason="No changes to save."
          >
            {saveLabel}
          </Button>
        </div>}
      </div>
      <fieldset disabled={readOnly} className="p-5 m-0 border-0 min-w-0 flex flex-col gap-4">
        {children}
      </fieldset>
    </Card>
  );
}

/** Two-up responsive grid for the fields inside a section. */
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">{children}</div>;
}

/** A multi-line field, labelled like Field. */
function TextArea({ label, value, help, onChange }: { label: string; value: string; help?: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[length:var(--text-small)] font-medium text-muted-ink">{label}</label>
      <textarea id={id} value={value} rows={5} maxLength={4000} aria-describedby={help ? `${id}-help` : undefined} onChange={e => onChange(e.target.value)}
        className="field-input h-auto! py-2.5 leading-[1.5] resize-y min-h-[110px]" />
      {help && <span id={`${id}-help`} className="text-[length:var(--text-small)] text-muted-ink">{help}</span>}
    </div>
  );
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Number fields hold null while emptied for retyping; saving is refused until they are back in range.
const inRange = (v: number | null, lo: number, hi: number) => v != null && Number.isInteger(v) && v >= lo && v <= hi;
const held = (v: number | null) => v as number;

export default function SettingsPage() {
  const { data, loading, error, reload } = useApi<Settings>('/settings', FALLBACK);
  const toast = useToast();
  // PUT /api/settings accepts management only; everyone else reads.
  const readOnly = useSession().user?.role !== 'management';

  const base = data ?? FALLBACK;
  // Committed local state: the last-saved values overlaid on what the API returned.
  const [saved, setSaved] = useState<Partial<Settings>>({});
  const committed: Settings = useMemo(() => ({
    ...base,
    ...saved,
    company: { ...base.company, ...saved.company },
    locale: { ...base.locale, ...saved.locale },
    operations: { ...base.operations, ...saved.operations },
    report: { ...base.report, ...saved.report },
    approvals: { ...FALLBACK.approvals, ...base.approvals, ...saved.approvals },
    security: { ...base.security, ...saved.security },
  }), [base, saved]);

  // Working draft the fields edit against.
  const [draft, setDraft] = useState<Settings>(committed);
  // The form starts from the loaded values, not the built-in defaults, so nothing invented can be saved over the real settings.
  useEffect(() => { if (data) setDraft(committed); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<SectionKey | null>(null);

  function patch<K extends SectionKey>(section: K, part: Partial<Settings[K]>, clearError?: string) {
    setDraft(d => ({ ...d, [section]: { ...d[section], ...part } } as Settings));
    if (clearError) setErrors(e => (e[clearError] ? { ...e, [clearError]: '' } : e));
  }
  const dirty = (k: SectionKey) => !eq(draft[k], committed[k]);
  const discard = (k: SectionKey) => {
    setDraft(d => ({ ...d, [k]: committed[k] } as Settings));
    setErrors(e => Object.fromEntries(Object.entries(e).filter(([key]) => !key.startsWith(`${k}.`))));
  };

  function validate(k: SectionKey): Record<string, string> {
    const e: Record<string, string> = {};
    if (k === 'company') {
      if (!draft.company.legalName.trim()) e['company.legalName'] = 'Enter the registered legal name.';
      if (!draft.company.companyNumber.trim()) e['company.companyNumber'] = 'Enter the company registration number.';
      if (draft.company.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.company.supportEmail))
        e['company.supportEmail'] = 'Enter a valid email or leave it blank.';
    }
    if (k === 'report') {
      if (!draft.report.paymentTerms.trim()) e['report.paymentTerms'] = 'Enter when owners are paid, e.g. 7th every month.';
      if (!inRange(draft.report.miscChargeMonthly, 0, 10_000_000)) e['report.miscChargeMonthly'] = 'Enter RM 0.00 or more.';
    }
    if (k === 'locale') {
      const fee = draft.locale.managementFeePct as number | null;
      if (fee == null || fee < 0 || fee > 100) e['locale.managementFeePct'] = 'Enter a share from 0 to 100%.';
    }
    if (k === 'operations') {
      if (!draft.operations.checkIn) e['operations.checkIn'] = 'Enter the standard check-in time.';
      if (!draft.operations.checkOut) e['operations.checkOut'] = 'Enter the standard checkout time.';
    }
    if (k === 'approvals' && draft.approvals.enabled) {
      if (!inRange(draft.approvals.expenseThreshold, 0, 1e12)) e['approvals.expenseThreshold'] = 'Enter RM 0.00 or more.';
      if (!inRange(draft.approvals.financeAdminLimit, 0, 1e12)) e['approvals.financeAdminLimit'] = 'Enter RM 0.00 or more.';
    }
    if (k === 'security') {
      if (!inRange(draft.security.lockoutAttempts, 3, 10)) e['security.lockoutAttempts'] = 'Enter a whole number from 3 to 10.';
      if (!inRange(draft.security.lockoutMinutes, 1, 120)) e['security.lockoutMinutes'] = 'Enter whole minutes from 1 to 120.';
    }
    return e;
  }

  const MESSAGES: Record<SectionKey, { title: string; body?: string }> = {
    company: { title: 'Company details saved.', body: 'They appear on the letterhead of statements, invoices and receipts.' },
    locale: { title: 'Operator share saved.', body: 'Statements generated from now on use it for units with no share on their contract.' },
    operations: { title: 'Operations defaults saved.', body: 'The cleaning board uses these times from now on.' },
    report: { title: 'Owner statement wording saved.', body: 'Reports opened from now on use it. The miscellaneous charge applies to statements generated from now on.' },
    approvals: draft.approvals.enabled
      ? { title: 'Approvals switched on.', body: 'Refunds, owner payouts, owner adjustments, write-offs and large expenses now wait for a second person.' }
      : { title: 'Approvals switched off.', body: 'Money actions happen at once, without a second person.' },
    security: { title: 'Security settings saved.', body: 'Takes effect immediately, including for anyone already signed in.' },
  };

  async function save(k: SectionKey) {
    if (busy) return;
    const errs = validate(k);
    if (Object.keys(errs).length) { setErrors(e => ({ ...e, ...errs })); return; }

    setBusy(k);
    const value = draft[k];
    try {
      await api.put('/settings', { [k]: value }); // audited server-side; see BUTTONS §14
      setSaved(s => ({ ...s, [k]: value }) as Partial<Settings>);
      toast({ tone: 'success', ...MESSAGES[k] });
      if (k === 'approvals') void refreshNavCounts();
    } catch (e) {
      toast({ tone: 'critical', title: 'Settings were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    }
    setBusy(null);
  }

  return (
    <>
      <PageHeader title="Settings" sub="Organisation-wide defaults. Every change is audited." />

      <SystemStats loading={loading && !data} stats={[
        { label: 'Operator share', value: data ? `${data.locale.managementFeePct}%` : undefined, hint: 'Default when a contract has none' },
        { label: 'Check-in · out', value: data ? `${data.operations.checkIn} · ${data.operations.checkOut}` : undefined, hint: 'Cleaning board times' },
        { label: 'Sign-in lockout', value: data ? `${data.security.lockoutAttempts} tries` : undefined, hint: data ? `Locked for ${data.security.lockoutMinutes} min` : undefined },
        { label: 'Approvals', value: data ? (data.approvals.enabled ? 'On' : 'Off') : undefined, hint: 'Maker-checker on expenses' },
      ]} />

      {error && <StaleBanner message={`Showing the last settings we have. ${error}`} onRetry={reload} />}

      {(loading || !data) && !(import.meta.env.DEV && data) ? (
        <Card><TableSkeleton rows={5} cols={2} /></Card>
      ) : (
        <div className="flex flex-col gap-5">

          {/* --------------------------- Company --------------------------- */}
          <SectionCard
            title="Company"
            description="Legal identity and support contacts, printed on the letterhead of every owner statement, guest invoice and official receipt."
            readOnly={readOnly} dirty={dirty('company')} busy={busy === 'company'} saveLabel="Save company"
            onSave={() => save('company')} onDiscard={() => discard('company')}
          >
            <Grid>
              <Field
                label="Legal name"
                value={draft.company.legalName}
                error={errors['company.legalName']}
                onChange={e => patch('company', { legalName: e.target.value }, 'company.legalName')}
              />
              <Field
                label="Company registration number"
                value={draft.company.companyNumber}
                error={errors['company.companyNumber']}
                onChange={e => patch('company', { companyNumber: e.target.value }, 'company.companyNumber')}
              />
            </Grid>
            <TextArea
              label="Registered address"
              value={draft.company.address}
              help="Printed on every letterhead line by line, as typed here."
              onChange={v => patch('company', { address: v })}
            />
            <Grid>
              <PhoneInput
                label="Support phone"
                value={draft.company.supportPhone}
                error={errors['company.supportPhone']}
                onChange={v => patch('company', { supportPhone: v }, 'company.supportPhone')}
              />
              <Field
                label="Support email"
                type="email"
                value={draft.company.supportEmail}
                error={errors['company.supportEmail']}
                onChange={e => patch('company', { supportEmail: e.target.value }, 'company.supportEmail')}
              />
            </Grid>
          </SectionCard>

          {/* ------------------------ Operator share ------------------------ */}
          <SectionCard
            title="Operator share"
            description="The share owner statements take for a unit whose contract does not set its own."
            readOnly={readOnly} dirty={dirty('locale')} busy={busy === 'locale'} saveLabel="Save share"
            onSave={() => save('locale')} onDiscard={() => discard('locale')}
          >
            <div className="max-w-[340px]">
              <PercentInput
                label="Default operator share"
                value={draft.locale.managementFeePct}
                error={errors['locale.managementFeePct']}
                help="Used when a statement is generated for a unit with no share on its contract."
                onChange={v => patch('locale', { managementFeePct: held(v) }, 'locale.managementFeePct')}
              />
            </div>
          </SectionCard>

          {/* --------------------- Operations defaults --------------------- */}
          <SectionCard
            title="Operations defaults"
            description="Standard check-in and checkout times. The cleaning board uses them for a reservation with no time of its own, and to flag early check-ins and late checkouts."
            readOnly={readOnly} dirty={dirty('operations')} busy={busy === 'operations'} saveLabel="Save operations"
            onSave={() => save('operations')} onDiscard={() => discard('operations')}
          >
            <Grid>
              <TimeField
                label="Standard check-in"
                required
                value={draft.operations.checkIn}
                error={errors['operations.checkIn']}
                onChange={v => patch('operations', { checkIn: v }, 'operations.checkIn')}
              />
              <TimeField
                label="Standard checkout"
                required
                value={draft.operations.checkOut}
                error={errors['operations.checkOut']}
                onChange={v => patch('operations', { checkOut: v }, 'operations.checkOut')}
              />
            </Grid>
          </SectionCard>

          {/* ------------------------- Owner report ------------------------- */}
          <SectionCard
            title="Owner statement wording"
            description="Wording on the Owner Income Report, and the monthly miscellaneous charge for contracts that carry it."
            readOnly={readOnly} dirty={dirty('report')} busy={busy === 'report'} saveLabel="Save wording"
            onSave={() => save('report')} onDiscard={() => discard('report')}
          >
            <Grid>
              <Field
                label="Payment terms"
                value={draft.report.paymentTerms}
                error={errors['report.paymentTerms']}
                help="Printed as TERMS on the monthly page."
                onChange={e => patch('report', { paymentTerms: e.target.value }, 'report.paymentTerms')}
              />
              <MoneyInput
                label="Miscellaneous charge a month (RM)"
                valueSen={draft.report.miscChargeMonthly}
                error={errors['report.miscChargeMonthly']}
                help="Deducted each month from units whose contract has miscellaneous charges."
                onChangeSen={v => patch('report', { miscChargeMonthly: held(v) }, 'report.miscChargeMonthly')}
              />
            </Grid>
            <TextArea
              label="Monthly statement terms"
              value={draft.report.monthlyTerms}
              help="One term per line. Printed, numbered, under the monthly page."
              onChange={v => patch('report', { monthlyTerms: v })}
            />
            <TextArea
              label="Year-to-date terms"
              value={draft.report.yearTerms}
              help="One term per line. Printed under the year-to-date page."
              onChange={v => patch('report', { yearTerms: v })}
            />
          </SectionCard>

          {/* --------------------------- Approvals -------------------------- */}
          <SectionCard
            title="Approvals"
            description="Whether money going out waits for someone else to approve it. Off: refunds, owner payouts, owner adjustments, write-offs and expenses happen as soon as they are entered."
            readOnly={readOnly} dirty={dirty('approvals')} busy={busy === 'approvals'} saveLabel="Save approvals"
            onSave={() => save('approvals')} onDiscard={() => discard('approvals')}
          >
            <ToggleField
              label="Require a second person to approve money going out"
              description={draft.approvals.enabled
                ? 'Guest refunds, owner payouts, owner adjustments, debt write-offs and expenses above the amount below wait on the Approvals page. Nobody approves their own request, except the only management user, with a written reason.'
                : 'Off. Each action is recorded at once under the name of the person who did it.'}
              checked={draft.approvals.enabled}
              onChange={v => patch('approvals', { enabled: v })}
            />
            {draft.approvals.enabled && <div className="[border-top:1px_solid_var(--color-line-soft)] pt-4"><Grid>
              <MoneyInput
                label="Expenses need approval above (RM)"
                valueSen={draft.approvals.expenseThreshold}
                error={errors['approvals.expenseThreshold']}
                help="An expense of this amount or less is recorded at once."
                onChangeSen={v => patch('approvals', { expenseThreshold: held(v) }, 'approvals.expenseThreshold')}
              />
              <MoneyInput
                label="Finance admins approve below (RM)"
                valueSen={draft.approvals.financeAdminLimit}
                error={errors['approvals.financeAdminLimit']}
                help="From this amount up, only management can approve. Management approves any amount."
                onChangeSen={v => patch('approvals', { financeAdminLimit: held(v) }, 'approvals.financeAdminLimit')}
              />
            </Grid></div>}
          </SectionCard>

          {/* --------------------------- Security --------------------------- */}
          <SectionCard
            title="Security"
            description="Session lifetimes, the account lockout threshold and who must use two-step sign-in. Staff and owners are timed out separately — the owner portal is a brief, occasional check-in, so it defaults much shorter."
            readOnly={readOnly} dirty={dirty('security')} busy={busy === 'security'} saveLabel="Save security"
            onSave={() => save('security')} onDiscard={() => discard('security')}
          >
            <Grid>
              <SelectField
                label="Staff inactivity timeout"
                value={draft.security.staffInactivityTimeoutMins}
                help="A staff account is signed out after this long with no activity."
                onChange={v => patch('security', { staffInactivityTimeoutMins: Number(v) })}
                options={INACTIVITY_OPTIONS}
              />
              <SelectField
                label="Owner inactivity timeout"
                value={draft.security.ownerInactivityTimeoutMins}
                help="An owner-portal account is signed out after this long with no activity."
                onChange={v => patch('security', { ownerInactivityTimeoutMins: Number(v) })}
                options={INACTIVITY_OPTIONS}
              />
              <SelectField
                label="Absolute session timeout"
                value={draft.security.absoluteTimeoutHours}
                help="Maximum session length before a fresh sign-in is required, however active."
                onChange={v => patch('security', { absoluteTimeoutHours: Number(v) })}
                options={ABSOLUTE.map(o => ({ value: String(o.value), label: o.label }))}
              />
              <NumberInput
                label="Lock account after failed attempts"
                min={3}
                max={10}
                value={draft.security.lockoutAttempts}
                error={errors['security.lockoutAttempts']}
                help={`The account locks for ${draft.security.lockoutMinutes ?? '-'} minutes after this many failed sign-ins.`}
                onChange={v => patch('security', { lockoutAttempts: held(v) }, 'security.lockoutAttempts')}
              />
              <NumberInput
                label="Lockout length (minutes)"
                min={1}
                max={120}
                value={draft.security.lockoutMinutes}
                error={errors['security.lockoutMinutes']}
                help="How long a locked account stays locked before it can try again."
                onChange={v => patch('security', { lockoutMinutes: held(v) }, 'security.lockoutMinutes')}
              />
            </Grid>
            <fieldset className="m-0 mt-5 p-0 border-none flex flex-col gap-2.5">
              <legend className="p-0 mb-2.5 text-meta font-medium text-muted-ink">Require two-step sign-in for</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {TWO_STEP_ROLES.map(r => {
                  const on = draft.security.require2faRoles.split(',').includes(r);
                  return (
                    <label key={r} className={cx('flex items-center gap-2 min-h-8 text-copy', readOnly ? 'cursor-default text-muted-ink' : 'cursor-pointer')}>
                      <input type="checkbox" className="w-4 h-4" checked={on} disabled={readOnly}
                        onChange={() => {
                          const set = new Set(draft.security.require2faRoles.split(',').filter(Boolean));
                          if (on) set.delete(r); else set.add(r);
                          patch('security', { require2faRoles: TWO_STEP_ROLES.filter(x => set.has(x)).join(',') });
                        }} />
                      {ROLE_LABEL[r] ?? r}
                    </label>
                  );
                })}
              </div>
              <span className="text-meta text-muted-ink leading-[1.5]">
                People in a ticked role who have not set it up are asked to at their next click, and can do nothing else until they have. Each person sets it up on My account; management can reset it for a lost phone from Users and roles.
              </span>
            </fieldset>
          </SectionCard>

        </div>
      )}
    </>
  );
}
