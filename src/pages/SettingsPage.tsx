import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { MoneyInput, NumberInput, PercentInput, PhoneInput, TimeField } from '../components/inputs';
import { Select } from '../components/Select';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { useDevice } from '../lib/deviceClass';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from '../lib/navigation';
import { ServicePrices } from './ServicePrices';
import { useSession } from '../lib/session';
import { useDepartments } from '../components/permissions/shared';
import { refreshNavCounts } from '../lib/navBadges';
import AgreementTemplateSettings from './settings/AgreementTemplate';

/* ------------------------------------------------------------------ *
 * Settings — organisation-wide defaults (routes.json → SYSTEM →
 * SettingsPage): Company, Management fee, Operations defaults, Owner
 * report, Approvals, Security. Only settings something in the system
 * reads are shown (owner, 11 Oct 2026); BUTTONS.md §14: every field
 * saves through PUT /api/settings and every write is audited.
 *
 * One category at a time (owner, 16 Oct 2026), at /system/settings/<key>:
 * the desktop menu nests the categories under Settings and the phone
 * Settings tab lists them (SETTINGS_SECTIONS); each shows as label | control
 * rows no wider than max-w-4xl.
 *
 * Each section owns its own Save button and dirty state so one edit
 * never commits another section's half-finished change. Drafts live in
 * this page, so moving between categories keeps an unsaved edit. There is no
 * backend in dev, so a save is applied to a local overlay first and the
 * real PUT is attempted in a swallowed try/catch — the interaction is
 * always visible whether or not the endpoint answers.
 * ------------------------------------------------------------------ */

// The agreement template has its own versioned store and screen (settings/AgreementTemplate.tsx), not these rows.
type SectionKey = Exclude<SettingsSectionKey, 'agreement' | 'services'>;

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
    /** Comma-separated roles that must use two-step sign-in. Read only: it applies until the departments below are saved. */
    require2faRoles: string;
    /** Comma-separated department ids that must use two-step sign-in (the setting saved by department). */
    require2faDepartments?: string;
    /** Owner logins have no department, so they are ticked on their own. */
    require2faOwners?: boolean;
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

/** Accessible switch. On-state is neutral ink, never a status tone. */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
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
  );
}

/** One setting: what it is and what it affects on the left third, its control on the right two thirds.
 *  Stacks when the panel is narrow (container query on the Card below). */
function Row({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-2.5 px-5 py-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [border-top:1px_solid_var(--color-line-soft)] first:[border-top:none]">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-copy font-medium">{label}</span>
        {description && <span className="text-meta text-muted-ink leading-[1.45]">{description}</span>}
      </div>
      <div className="min-w-0 flex flex-col justify-center">{children}</div>
    </div>
  );
}

/** The chosen category's rows and its own Save / Discard. */
function Panel({ dirty, busy, onSave, onDiscard, saveLabel, children, readOnly }: {
  dirty: boolean; busy: boolean; readOnly?: boolean;
  onSave: () => void; onDiscard: () => void; saveLabel: string; children: ReactNode;
}) {
  return (
    <Card className="@container">
      <fieldset disabled={readOnly} className="m-0 p-0 border-0 min-w-0">
        {children}
      </fieldset>
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 flex-wrap px-5 py-3 bg-muted [border-top:1px_solid_var(--color-line-soft)]">
          {dirty && <StatusBadge tone="warning" label="Unsaved changes" size="sm" />}
          {dirty && <Button variant="tertiary" size="sm" onClick={onDiscard} disabled={busy}>Discard</Button>}
          <Button variant="primary" size="sm" onClick={onSave} loading={busy} disabled={!dirty} disabledReason="No changes to save.">
            {saveLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A multi-line field; its label is the row's. */
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <textarea aria-label={label} value={value} rows={5} maxLength={4000} onChange={e => onChange(e.target.value)}
      className="field-input h-auto! py-2.5 leading-[1.5] resize-y min-h-[110px]" />
  );
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Number fields hold null while emptied for retyping; saving is refused until they are back in range.
const inRange = (v: number | null, lo: number, hi: number) => v != null && Number.isInteger(v) && v >= lo && v <= hi;
const held = (v: number | null) => v as number;

export default function SettingsPage() {
  const { data, loading, error, reload } = useApi<Settings>('/settings', FALLBACK);
  const toast = useToast();
  // Two-step sign-in is required by department (the managed list under Users and roles > Permissions).
  const { data: deptData } = useDepartments();
  const departments = deptData?.departments ?? [];
  // PUT /api/settings accepts management only; everyone else reads.
  const readOnly = useSession().user?.role !== 'management';
  const navigate = useNavigate();
  const { section } = useParams();
  const phone = useDevice().cls === 'phone';
  // With no category named, a phone goes back to the list on its Settings tab and a desk opens the first one.
  const current = SETTINGS_SECTIONS.find(s => s.key === section);

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

  const roleBoxes = (
    <div className="grid gap-x-5 gap-y-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {departments.map(d => {
        const ids = (draft.security.require2faDepartments ?? '').split(',').filter(Boolean);
        const on = ids.includes(d.id);
        return (
          <label key={d.id} className={cx('flex items-center gap-2 min-h-8 text-copy', readOnly ? 'cursor-default text-muted-ink' : 'cursor-pointer')}>
            <input type="checkbox" className="w-4 h-4" checked={on} disabled={readOnly}
              onChange={() => {
                const set = new Set(ids);
                if (on) set.delete(d.id); else set.add(d.id);
                patch('security', { require2faDepartments: departments.filter(x => set.has(x.id)).map(x => x.id).join(',') });
              }} />
            {d.name}
          </label>
        );
      })}
      <label className={cx('flex items-center gap-2 min-h-8 text-copy', readOnly ? 'cursor-default text-muted-ink' : 'cursor-pointer')}>
        <input type="checkbox" className="w-4 h-4" checked={draft.security.require2faOwners ?? false} disabled={readOnly}
          onChange={e => patch('security', { require2faOwners: e.target.checked })} />
        Owners (owner portal)
      </label>
    </div>
  );

  const ROWS: Record<SectionKey, { saveLabel: string; rows: ReactNode }> = {
    company: { saveLabel: 'Save company', rows: <>
      <Row label="Legal name">
        <Field aria-label="Legal name" value={draft.company.legalName} error={errors['company.legalName']}
          onChange={e => patch('company', { legalName: e.target.value }, 'company.legalName')} />
      </Row>
      <Row label="Company registration number" description="The SSM number, printed under the company name.">
        <Field aria-label="Company registration number" value={draft.company.companyNumber} error={errors['company.companyNumber']}
          onChange={e => patch('company', { companyNumber: e.target.value }, 'company.companyNumber')} />
      </Row>
      <Row label="Registered address" description="Printed on every letterhead line by line, as typed here.">
        <TextArea label="Registered address" value={draft.company.address} onChange={v => patch('company', { address: v })} />
      </Row>
      <Row label="Support phone">
        <PhoneInput aria-label="Support phone" value={draft.company.supportPhone} error={errors['company.supportPhone']}
          onChange={v => patch('company', { supportPhone: v }, 'company.supportPhone')} />
      </Row>
      <Row label="Support email">
        <Field aria-label="Support email" type="email" value={draft.company.supportEmail} error={errors['company.supportEmail']}
          onChange={e => patch('company', { supportEmail: e.target.value }, 'company.supportEmail')} />
      </Row>
    </> },

    operations: { saveLabel: 'Save times', rows: <>
      <Row label="Standard check-in" description="Used for a reservation with no time of its own, and to flag early check-ins.">
        <div className="max-w-[240px]">
          <TimeField aria-label="Standard check-in" required value={draft.operations.checkIn} error={errors['operations.checkIn']}
            onChange={v => patch('operations', { checkIn: v }, 'operations.checkIn')} />
        </div>
      </Row>
      <Row label="Standard checkout" description="Used for a reservation with no time of its own, and to flag late checkouts.">
        <div className="max-w-[240px]">
          <TimeField aria-label="Standard checkout" required value={draft.operations.checkOut} error={errors['operations.checkOut']}
            onChange={v => patch('operations', { checkOut: v }, 'operations.checkOut')} />
        </div>
      </Row>
    </> },

    locale: { saveLabel: 'Save share', rows: <>
      <Row label="Default operator share" description="Used when a statement is generated for a unit with no share on its contract.">
        <div className="max-w-[240px]">
          <PercentInput aria-label="Default operator share" value={draft.locale.managementFeePct} error={errors['locale.managementFeePct']}
            onChange={v => patch('locale', { managementFeePct: held(v) }, 'locale.managementFeePct')} />
        </div>
      </Row>
    </> },

    report: { saveLabel: 'Save wording', rows: <>
      <Row label="Payment terms" description="Printed as TERMS on the monthly page.">
        <Field aria-label="Payment terms" value={draft.report.paymentTerms} error={errors['report.paymentTerms']}
          onChange={e => patch('report', { paymentTerms: e.target.value }, 'report.paymentTerms')} />
      </Row>
      <Row label="Miscellaneous charge a month (RM)" description="Deducted each month from units whose contract has miscellaneous charges.">
        <div className="max-w-[240px]">
          <MoneyInput aria-label="Miscellaneous charge a month (RM)" valueSen={draft.report.miscChargeMonthly} error={errors['report.miscChargeMonthly']}
            onChangeSen={v => patch('report', { miscChargeMonthly: held(v) }, 'report.miscChargeMonthly')} />
        </div>
      </Row>
      <Row label="Monthly statement terms" description="One term per line. Printed, numbered, under the monthly page.">
        <TextArea label="Monthly statement terms" value={draft.report.monthlyTerms} onChange={v => patch('report', { monthlyTerms: v })} />
      </Row>
      <Row label="Year-to-date terms" description="One term per line. Printed under the year-to-date page.">
        <TextArea label="Year-to-date terms" value={draft.report.yearTerms} onChange={v => patch('report', { yearTerms: v })} />
      </Row>
    </> },

    approvals: { saveLabel: 'Save approvals', rows: <>
      <Row label="Require a second person to approve money going out"
        description={draft.approvals.enabled
          ? 'Guest refunds, owner payouts, owner adjustments, debt write-offs and expenses above the amount below wait on the Approvals page. Nobody approves their own request, except the only management user, with a written reason.'
          : 'Off. Refunds, owner payouts, owner adjustments, write-offs and expenses happen as soon as they are entered, recorded under the name of the person who did it.'}>
        <Switch label="Require a second person to approve money going out" checked={draft.approvals.enabled}
          onChange={v => patch('approvals', { enabled: v })} />
      </Row>
      {draft.approvals.enabled && <>
        <Row label="Expenses need approval above (RM)" description="An expense of this amount or less is recorded at once.">
          <div className="max-w-[240px]">
            <MoneyInput aria-label="Expenses need approval above (RM)" valueSen={draft.approvals.expenseThreshold} error={errors['approvals.expenseThreshold']}
              onChangeSen={v => patch('approvals', { expenseThreshold: held(v) }, 'approvals.expenseThreshold')} />
          </div>
        </Row>
        <Row label="Finance admins approve below (RM)" description="From this amount up, only management can approve. Management approves any amount.">
          <div className="max-w-[240px]">
            <MoneyInput aria-label="Finance admins approve below (RM)" valueSen={draft.approvals.financeAdminLimit} error={errors['approvals.financeAdminLimit']}
              onChangeSen={v => patch('approvals', { financeAdminLimit: held(v) }, 'approvals.financeAdminLimit')} />
          </div>
        </Row>
      </>}
    </> },

    security: { saveLabel: 'Save security', rows: <>
      <Row label="Staff inactivity timeout" description="A staff account is signed out after this long with no activity.">
        <div className="max-w-[240px]">
          <Select label="Staff inactivity timeout" size="md" value={String(draft.security.staffInactivityTimeoutMins)}
            onChange={v => patch('security', { staffInactivityTimeoutMins: Number(v) })} options={INACTIVITY_OPTIONS} />
        </div>
      </Row>
      <Row label="Owner inactivity timeout" description="An owner-portal account is signed out after this long with no activity. Owners only check in briefly, so it is usually shorter.">
        <div className="max-w-[240px]">
          <Select label="Owner inactivity timeout" size="md" value={String(draft.security.ownerInactivityTimeoutMins)}
            onChange={v => patch('security', { ownerInactivityTimeoutMins: Number(v) })} options={INACTIVITY_OPTIONS} />
        </div>
      </Row>
      <Row label="Absolute session timeout" description="Maximum session length before a fresh sign-in is required, however active.">
        <div className="max-w-[240px]">
          <Select label="Absolute session timeout" size="md" value={String(draft.security.absoluteTimeoutHours)}
            onChange={v => patch('security', { absoluteTimeoutHours: Number(v) })} options={ABSOLUTE.map(o => ({ value: String(o.value), label: o.label }))} />
        </div>
      </Row>
      <Row label="Lock account after failed attempts" description={`The account locks for ${draft.security.lockoutMinutes ?? '-'} minutes after this many failed sign-ins.`}>
        <div className="max-w-[240px]">
          <NumberInput aria-label="Lock account after failed attempts" min={3} max={10} value={draft.security.lockoutAttempts} error={errors['security.lockoutAttempts']}
            onChange={v => patch('security', { lockoutAttempts: held(v) }, 'security.lockoutAttempts')} />
        </div>
      </Row>
      <Row label="Lockout length (minutes)" description="How long a locked account stays locked before it can try again.">
        <div className="max-w-[240px]">
          <NumberInput aria-label="Lockout length (minutes)" min={1} max={120} value={draft.security.lockoutMinutes} error={errors['security.lockoutMinutes']}
            onChange={v => patch('security', { lockoutMinutes: held(v) }, 'security.lockoutMinutes')} />
        </div>
      </Row>
      <Row label="Require two-step sign-in for"
        description="People in a ticked department, or owners if that box is ticked, who have not set it up are asked to at their next click, and can do nothing else until they have. Each person sets it up on My account; management can reset it for a lost phone from Users and roles.">
        {roleBoxes}
      </Row>
    </> },
  };

  if (!current) return <Navigate to={phone ? '/settings' : `/system/settings/${SETTINGS_SECTIONS[0].key}`} replace />;
  const loadingNow = (loading || !data) && !(import.meta.env.DEV && data);
  if (current.key === 'agreement') {
    return (
      <>
        <PageHeader title={current.label} sub={current.description}
          back={phone ? { label: 'Settings', onClick: () => navigate('/settings') } : undefined}
          badge={readOnly ? <StatusBadge tone="neutral" label="Management changes these" size="sm" /> : undefined} />
        <div className="max-w-6xl"><AgreementTemplateSettings readOnly={readOnly} /></div>
      </>
    );
  }
  if (current.key === 'services') {
    return (
      <>
        <PageHeader title={current.label} sub={current.description}
          back={phone ? { label: 'Settings', onClick: () => navigate('/settings') } : undefined} />
        <ServicePrices />
      </>
    );
  }
  const key: SectionKey = current.key;

  return (
    <>
      <PageHeader title={current.label} sub={current.description}
        back={phone ? { label: 'Settings', onClick: () => navigate('/settings') } : undefined}
        badge={readOnly ? <StatusBadge tone="neutral" label="Management changes these" size="sm" /> : undefined} />

      {error && <StaleBanner message={`Showing the last settings we have. ${error}`} onRetry={reload} />}

      <div className="max-w-4xl">
        {loadingNow ? (
          <Card><TableSkeleton rows={5} cols={2} /></Card>
        ) : (
          <Panel
            readOnly={readOnly} dirty={dirty(key)} busy={busy === key} saveLabel={ROWS[key].saveLabel}
            onSave={() => save(key)} onDiscard={() => discard(key)}
          >
            {ROWS[key].rows}
          </Panel>
        )}
      </div>
    </>
  );
}
