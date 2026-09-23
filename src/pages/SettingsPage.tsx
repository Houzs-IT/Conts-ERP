import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { cx, TONE } from '../lib/design-tokens';

/* ------------------------------------------------------------------ *
 * Settings — organisation-wide defaults (routes.json → SYSTEM →
 * SettingsPage): Company, Locale and money, Operations defaults,
 * Statements and payouts, Security. BUTTONS.md §14: every field saves
 * through PUT /api/settings and every write is audited.
 *
 * Each section owns its own Save button and dirty state so one edit
 * never commits another section's half-finished change. There is no
 * backend in dev, so a save is applied to a local overlay first and the
 * real PUT is attempted in a swallowed try/catch — the interaction is
 * always visible whether or not the endpoint answers.
 * ------------------------------------------------------------------ */

type SectionKey = 'company' | 'locale' | 'operations' | 'statements' | 'security';

interface Settings {
  company: { legalName: string; companyNumber: string; address: string; supportPhone: string; supportEmail: string };
  locale: { default: string; timezone: string; currency: string; dateFormat: string; managementFeePct: number };
  operations: { checkIn: string; checkOut: string; cleaningWindowHours: number; linenSets: number; photoRequiredToMarkReady: boolean };
  statements: { cycleDay: number; autoGenerate: boolean; payoutMethod: string };
  security: {
    staffInactivityTimeoutMins: number; ownerInactivityTimeoutMins: number;
    absoluteTimeoutHours: number; lockoutAttempts: number; lockoutMinutes: number;
  };
  generatedAt: string;
}

const FALLBACK: Settings = {
  generatedAt: '',
  company: {
    legalName: 'The Conts Sdn Bhd',
    companyNumber: '202301027399 (1521322-V)',
    address: 'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya',
    supportPhone: '+60 17-465 8868',
    supportEmail: 'support@theconts.com',
  },
  locale: { default: 'en-MY', timezone: 'Asia/Kuala_Lumpur', currency: 'MYR', dateFormat: 'D MMM YYYY', managementFeePct: 25 },
  operations: { checkIn: '15:00', checkOut: '11:00', cleaningWindowHours: 4, linenSets: 2, photoRequiredToMarkReady: true },
  statements: { cycleDay: 1, autoGenerate: true, payoutMethod: 'bank_transfer' },
  security: { staffInactivityTimeoutMins: 10080, ownerInactivityTimeoutMins: 480, absoluteTimeoutHours: 720, lockoutAttempts: 5, lockoutMinutes: 15 },
};

/* -------------------------------- options -------------------------------- */
const LOCALES = [
  { value: 'en-MY', label: 'English (Malaysia)' },
  { value: 'ms-MY', label: 'Bahasa Melayu' },
  { value: 'zh-Hans', label: '简体中文' },
];
const TIMEZONES = ['Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Jakarta'];
const CURRENCIES = [
  { value: 'MYR', label: 'MYR — Malaysian ringgit, shown as RM' },
  { value: 'SGD', label: 'SGD — Singapore dollar' },
  { value: 'THB', label: 'THB — Thai baht' },
  { value: 'IDR', label: 'IDR — Indonesian rupiah' },
];
const DATE_FORMATS = [
  { value: 'D MMM YYYY', label: 'D MMM YYYY — 16 Sep 2026' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 16/09/2026' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-09-16' },
];
const PAYOUT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'manual', label: 'Manual, recorded elsewhere' },
];
const INACTIVITY = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
  { value: 10080, label: '7 days' },
];
const ABSOLUTE = [
  { value: 8, label: '8 hours' },
  { value: 24, label: '24 hours' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

/* -------------------------------- styles -------------------------------- */
const labelCls = 'text-[12px] font-medium text-muted-ink';
// height 40, full-width, border-box, 0/12 padding, 1px line border, 8px radius.
// `font:inherit` in the source resets size/weight/family -> renders at the
// inherited 16 / 400 / IBM Plex Sans, so no text-size/weight class is added.
const controlCls = 'h-10 w-full box-border px-3 py-0 text-ink bg-card border border-solid border-line rounded-control outline-none [font:inherit]';
const helpCls = 'text-[12px] text-muted-ink';

/** Native select styled to match the Field input. */
function SelectField({ label, value, onChange, help, children }: {
  label: string; value: string | number; onChange: (v: string) => void; help?: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={controlCls}>
        {children}
      </select>
      {help && <span className={helpCls}>{help}</span>}
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
        <span className="text-[13.5px] font-medium">{label}</span>
        {description && <span className="text-[12px] text-muted-ink leading-[1.45]">{description}</span>}
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
function SectionCard({ title, description, dirty, busy, onSave, onDiscard, saveLabel, children }: {
  title: string; description: string; dirty: boolean; busy: boolean;
  onSave: () => void; onDiscard: () => void; saveLabel: string; children: ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 py-4 [border-bottom:1px_solid_var(--color-line,#DEDAD3)] flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-[3px] min-w-0">
          <span className="text-[16px] font-semibold">{title}</span>
          <span className="text-[12px] text-muted-ink leading-[1.45]">{description}</span>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {dirty && (
            <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-medium px-[9px] py-[3px] rounded-full', TONE.warning.text, TONE.warning.bg)}>
              <span className={cx('w-1.5 h-1.5 rounded-full', TONE.warning.dot)} />
              Unsaved changes
            </span>
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
            {busy ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>
      <div className="px-5 py-[18px] flex flex-col gap-4">
        {children}
      </div>
    </Card>
  );
}

/** Two-up responsive grid for the fields inside a section. */
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">{children}</div>;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clampInt = (v: string, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

export default function SettingsPage() {
  const { data, loading, error, reload } = useApi<Settings>('/settings', FALLBACK);
  const toast = useToast();

  const base = data ?? FALLBACK;
  // Committed local state: the last-saved values overlaid on what the API returned.
  const [saved, setSaved] = useState<Partial<Settings>>({});
  const committed: Settings = useMemo(() => ({
    ...base,
    ...saved,
    company: { ...base.company, ...saved.company },
    locale: { ...base.locale, ...saved.locale },
    operations: { ...base.operations, ...saved.operations },
    statements: { ...base.statements, ...saved.statements },
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
    if (k === 'locale') {
      if (draft.locale.managementFeePct < 0 || draft.locale.managementFeePct > 100)
        e['locale.managementFeePct'] = 'Fee must be between 0 and 100.';
    }
    return e;
  }

  const MESSAGES: Record<SectionKey, { title: string; body?: string }> = {
    company: { title: 'Company details saved.', body: 'They appear on statements, invoices and guest messages.' },
    locale: { title: 'Locale and money settings saved.', body: 'New documents use the updated timezone, currency and date format.' },
    operations: { title: 'Operations defaults saved.', body: 'New reservations and cleaning tasks use these times.' },
    statements: {
      title: 'Statements and payouts saved.',
      body: draft.statements.autoGenerate
        ? `Statements generate automatically on day ${draft.statements.cycleDay} of each month.`
        : 'Automatic generation is off. Generate statements manually each period.',
    },
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
    } catch (e) {
      toast({ tone: 'critical', title: 'Settings were not saved.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
    setBusy(null);
  }

  return (
    <>
      <PageHeader title="Settings" sub="Organisation-wide defaults. Every change is audited." />

      {error && <StaleBanner message={`Showing the last settings we have. ${error}`} onRetry={reload} />}

      {(loading || !data) && !(import.meta.env.DEV && data) ? (
        <Card><TableSkeleton rows={5} cols={2} /></Card>
      ) : (
        <div className="flex flex-col gap-[18px]">

          {/* --------------------------- Company --------------------------- */}
          <SectionCard
            title="Company"
            description="Legal identity and support contacts used across documents and guest messages."
            dirty={dirty('company')} busy={busy === 'company'} saveLabel="Save company"
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
            <Field
              label="Registered address"
              value={draft.company.address}
              onChange={e => patch('company', { address: e.target.value })}
            />
            <Grid>
              <Field
                label="Support phone"
                value={draft.company.supportPhone}
                onChange={e => patch('company', { supportPhone: e.target.value })}
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

          {/* ----------------------- Locale and money ----------------------- */}
          <SectionCard
            title="Locale and money"
            description="How dates, times and money are read across the product. English is the default; other locales are planned."
            dirty={dirty('locale')} busy={busy === 'locale'} saveLabel="Save locale"
            onSave={() => save('locale')} onDiscard={() => discard('locale')}
          >
            <Grid>
              <SelectField label="Default locale" value={draft.locale.default} onChange={v => patch('locale', { default: v })}>
                {LOCALES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <SelectField label="Timezone" value={draft.locale.timezone} onChange={v => patch('locale', { timezone: v })}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
              </SelectField>
              <SelectField label="Currency" value={draft.locale.currency} onChange={v => patch('locale', { currency: v })}>
                {CURRENCIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <SelectField label="Date format" value={draft.locale.dateFormat} onChange={v => patch('locale', { dateFormat: v })}>
                {DATE_FORMATS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <Field
                label="Default management fee"
                type="number"
                numeric
                min={0}
                max={100}
                step={0.5}
                trailing={<span className="text-[12px] text-muted-ink">%</span>}
                value={draft.locale.managementFeePct}
                error={errors['locale.managementFeePct']}
                help="Applied to new management agreements unless the owner's contract overrides it."
                onChange={e => patch('locale', { managementFeePct: e.target.value === '' ? 0 : Number(e.target.value) }, 'locale.managementFeePct')}
              />
            </Grid>
          </SectionCard>

          {/* --------------------- Operations defaults --------------------- */}
          <SectionCard
            title="Operations defaults"
            description="Standard turnover timings. New reservations inherit these unless a unit sets its own."
            dirty={dirty('operations')} busy={busy === 'operations'} saveLabel="Save operations"
            onSave={() => save('operations')} onDiscard={() => discard('operations')}
          >
            <Grid>
              <Field
                label="Standard check-in"
                type="time"
                value={draft.operations.checkIn}
                onChange={e => patch('operations', { checkIn: e.target.value })}
              />
              <Field
                label="Standard check-out"
                type="time"
                value={draft.operations.checkOut}
                onChange={e => patch('operations', { checkOut: e.target.value })}
              />
              <Field
                label="Cleaning window"
                type="number"
                numeric
                min={1}
                max={24}
                trailing={<span className="text-[12px] text-muted-ink">h</span>}
                value={draft.operations.cleaningWindowHours}
                help="Hours a turnover needs before the next check-in. The SLA counts down to it."
                onChange={e => patch('operations', { cleaningWindowHours: clampInt(e.target.value, 1, 24, draft.operations.cleaningWindowHours) })}
              />
              <Field
                label="Linen sets per unit"
                type="number"
                numeric
                min={1}
                max={10}
                value={draft.operations.linenSets}
                help="Sets held per unit so a turnover always has fresh linen ready."
                onChange={e => patch('operations', { linenSets: clampInt(e.target.value, 1, 10, draft.operations.linenSets) })}
              />
            </Grid>
            <div className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)] pt-4">
              <ToggleField
                label="Require a photo to mark a unit ready"
                description="A cleaning task cannot be completed without at least one photo. Enforced in the field app."
                checked={draft.operations.photoRequiredToMarkReady}
                onChange={v => patch('operations', { photoRequiredToMarkReady: v })}
              />
            </div>
          </SectionCard>

          {/* -------------------- Statements and payouts -------------------- */}
          <SectionCard
            title="Statements and payouts"
            description="When owner statements are cut and how owners are paid."
            dirty={dirty('statements')} busy={busy === 'statements'} saveLabel="Save statements"
            onSave={() => save('statements')} onDiscard={() => discard('statements')}
          >
            <Grid>
              <SelectField
                label="Statement cycle day"
                value={draft.statements.cycleDay}
                help="Day of the month the previous period is closed and statements are cut."
                onChange={v => patch('statements', { cycleDay: Number(v) })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day}>{`Day ${day}`}</option>
                ))}
              </SelectField>
              <SelectField label="Payout method" value={draft.statements.payoutMethod} onChange={v => patch('statements', { payoutMethod: v })}>
                {PAYOUT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
            </Grid>
            <div className="[border-top:1px_solid_var(--color-line-soft,#EDEAE4)] pt-4">
              <ToggleField
                label="Generate statements automatically"
                description="On the cycle day, statements are generated as provisional for review. Turn off to generate them by hand each period."
                checked={draft.statements.autoGenerate}
                onChange={v => patch('statements', { autoGenerate: v })}
              />
            </div>
          </SectionCard>

          {/* --------------------------- Security --------------------------- */}
          <SectionCard
            title="Security"
            description="Session lifetimes and the account lockout threshold. Staff and owners are timed out separately — the owner portal is a brief, occasional check-in, so it defaults much shorter."
            dirty={dirty('security')} busy={busy === 'security'} saveLabel="Save security"
            onSave={() => save('security')} onDiscard={() => discard('security')}
          >
            <Grid>
              <SelectField
                label="Staff inactivity timeout"
                value={draft.security.staffInactivityTimeoutMins}
                help="A staff account is signed out after this long with no activity."
                onChange={v => patch('security', { staffInactivityTimeoutMins: Number(v) })}
              >
                {INACTIVITY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <SelectField
                label="Owner inactivity timeout"
                value={draft.security.ownerInactivityTimeoutMins}
                help="An owner-portal account is signed out after this long with no activity."
                onChange={v => patch('security', { ownerInactivityTimeoutMins: Number(v) })}
              >
                {INACTIVITY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <SelectField
                label="Absolute session timeout"
                value={draft.security.absoluteTimeoutHours}
                help="Maximum session length before a fresh sign-in is required, however active."
                onChange={v => patch('security', { absoluteTimeoutHours: Number(v) })}
              >
                {ABSOLUTE.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>
              <Field
                label="Lock account after failed attempts"
                type="number"
                numeric
                min={3}
                max={10}
                value={draft.security.lockoutAttempts}
                help={`The account locks for ${draft.security.lockoutMinutes} minutes after this many failed sign-ins.`}
                onChange={e => patch('security', { lockoutAttempts: clampInt(e.target.value, 3, 10, draft.security.lockoutAttempts) })}
              />
              <Field
                label="Lockout length (minutes)"
                type="number"
                numeric
                min={1}
                max={120}
                value={draft.security.lockoutMinutes}
                help="How long a locked account stays locked before it can try again."
                onChange={e => patch('security', { lockoutMinutes: clampInt(e.target.value, 1, 120, draft.security.lockoutMinutes) })}
              />
            </Grid>
          </SectionCard>

        </div>
      )}
    </>
  );
}
