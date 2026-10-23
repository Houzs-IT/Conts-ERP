import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { MoneyInput, PercentInput, PhoneInput, DateField, phoneProblem } from '../../components/inputs';
import { useApi } from '../../lib/useApi';
import type { RosterUnit } from '../../lib/useUnitRoster';
import { rm, monthLabel, titleCase } from '../../lib/format';
import { MoneyText } from '../../components/MoneyText';
import { StatusBadge } from '../../components/StatusBadge';
import Icon from '../../components/Icon';
import { Select, SearchSelect } from '../../components/Select';
import { cx } from '../../lib/design-tokens';
import { bankName } from '../../lib/vocabulary';
import { BANKS } from '../units/shared';
import { Eyebrow, Figure } from '../../components/Metric';
import type { StatementState } from '../../lib/types';
import type { RevenueModel, ContractCode } from '../../lib/revenueModel';
import { Link } from 'react-router-dom';

/**
 * Shared owner-side building blocks. Extracted verbatim from OwnersPage so the
 * slim list, the right-hand drawer and the full owner profile all render the
 * same rows and drive the exact same create/link/contract flows — no forked
 * copies of the statement math or the fee model.
 */

export type FeeModel = 'management' | 'grr';
/** Where a unit's management fee is set: on the unit's own contract, on the
 *  owner as a default, or the system fallback (25%). */
export type FeeSource = 'unit' | 'owner-default' | 'fallback';

export interface UnitFigures {
  income: number; costs: number; operatorShare: number; guarantee: number; topUp: number; fixedRent: number;
  payoutBeforeAdjustments: number; adjustments: number; netPayout: number; nights: number; costLines: { label: string; amount: number }[];
}
export interface UnitLine {
  unitId: string; unitLabel: string; model: FeeModel; feePct?: number; grrAmount?: number;
  feeSource?: FeeSource; buildingId?: string;
  occupancy: number; adr: number; gross: number; net: number;
  /** The five revenue models (0093) and short terms; figures are the statement engine's for the month (money roles). */
  revenueModel?: RevenueModel; termsLabel?: string; figures?: UnitFigures;
  /** The staff's contract code (PS, PS GRR, WH, ...), null with no contract record (0125). */
  contractCode?: ContractCode | null;
}
export interface Owner {
  id: string; displayName: string; email: string; phone: string | null; ic: string | null;
  bankName: string | null; bankAccount: string | null; accountHolder: string | null;
  /** The API sends only the last four characters; the full number needs an audited reveal. */
  icLast4?: string | null; bankAccountLast4?: string | null;
  portalInvited: boolean;
  /** Whether a bank and account number are on file (for the list's filter). */
  hasBankDetails?: boolean;
  /** The portal login's state and when the newest invitation went out (owners GET, portalStates). */
  portal?: PortalLogin;
  /** Owner-level default management fee, applied to units with no per-unit override. Null = none set. */
  defaultManagementFeePct: number | null;
  contract: { feePct: number; startedOn: string; renewsOn: string | null; endsOn?: string | null } | null;
  /** Owner details card. Address and alternate contact need migration 0110 (Payload.detailsReady). */
  legalName?: string | null; notes?: string | null;
  address?: OwnerAddress | null; altContact?: { name: string | null; phone: string | null; relation: string | null } | null;
  /** The owner's statement for the month asked for, if generated. */
  statement?: { id: string; state: StatementState; hasUnits?: boolean } | null;
  units: UnitLine[];
}
export interface PortalLogin { state: 'none' | 'invited' | 'active' | 'off'; invitedAt: string | null; lastLoginAt: string | null }
export interface OwnerAddress { lines: string | null; postcode: string | null; city: string | null; state: string | null; country: string | null }
/** False until migration 0110 is applied on this database: the address and alternate contact are then hidden. */
export interface Payload { data: Owner[]; generatedAt: string; month?: string; detailsReady?: boolean }

/** An address as it is written on an envelope: the street lines, then "postcode city", then "state, country". */
export function addressLines(a: OwnerAddress | null | undefined): string[] {
  if (!a) return [];
  return [
    ...(a.lines ?? '').split('\n'),
    [a.postcode, a.city].filter(Boolean).join(' '),
    [a.state, a.country].filter(Boolean).join(', '),
  ].map(l => l.trim()).filter(Boolean);
}

export const line = (unitId: string, unitLabel: string, model: FeeModel, feePct: number | undefined, grrAmount: number | undefined, occupancy: number, adr: number, gross: number, net: number): UnitLine =>
  ({ unitId, unitLabel, model, feePct, grrAmount, occupancy, adr, gross, net });

export const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'o1', displayName: 'Lim Chee Keong', email: 'limck@example.com', phone: '+60 12-333 0001', ic: '900101-14-0017', bankName: 'PBBB', bankAccount: '0000000021', accountHolder: 'LIANG WOOI KEE', portalInvited: true, defaultManagementFeePct: 25, contract: { feePct: 25, startedOn: '2025-03-01', renewsOn: '2027-03-01' }, units: [line('u1', 'Vista Jaya One #A-12-03', 'management', 25, undefined, 86, 28400, 812000, 609000)] },
    { id: 'o2', displayName: 'Wong Mei Ling', email: 'wongml@example.com', phone: '+60 12-333 0002', ic: '900101-14-0018', bankName: 'MBBE', bankAccount: '0000000022', accountHolder: 'Wong Mei Ling', portalInvited: true, defaultManagementFeePct: 25, contract: { feePct: 25, startedOn: '2025-06-01', renewsOn: '2027-06-01' }, units: [line('u2', 'Arcoris #B-08-11', 'management', 25, undefined, 79, 23100, 634000, 475500)] },
    { id: 'o3', displayName: 'Rajesh Kumar', email: 'rajesh@example.com', phone: '+60 12-333 0003', ic: '900101-14-0019', bankName: 'CIBB', bankAccount: '0000000023', accountHolder: 'Rajesh A/L Kumar', portalInvited: false, defaultManagementFeePct: null, contract: { feePct: 0, startedOn: '2025-11-01', renewsOn: '2026-11-01' }, units: [line('u3', 'Tribeca #2207', 'grr', undefined, 350000, 88, 31800, 901000, 350000)] },
    { id: 'o4', displayName: 'Chong Wei Han', email: 'chongwh@example.com', phone: '+60 12-333 0004', ic: '900101-14-0020', bankName: 'PBBB', bankAccount: '0000000024', accountHolder: 'Chong Wei Han', portalInvited: false, defaultManagementFeePct: 20, contract: { feePct: 25, startedOn: '2025-08-01', renewsOn: '2027-08-01' }, units: [line('u4', 'Scarletz #15-06', 'management', 25, undefined, 74, 26500, 588000, 441000)] },
    // A multi-unit owner: the record rolls all three units into one combined net payout and one combined statement history.
    { id: 'o5', displayName: 'Goh Family Trust', email: 'gohtrust@example.com', phone: '+60 12-333 0005', ic: null, bankName: 'HLBB', bankAccount: '0000000025', accountHolder: 'Goh Family Trust', portalInvited: true, defaultManagementFeePct: 22, contract: { feePct: 25, startedOn: '2025-02-01', renewsOn: '2027-02-01' }, units: [
      line('u5', 'Sunway Velocity #V-18-07', 'management', 25, undefined, 91, 30200, 742000, 556500),
      line('u6', 'Sunway Velocity #V-22-03', 'management', 25, undefined, 84, 27800, 681000, 510750),
      line('u7', 'Sunway Velocity #V-09-11', 'management', 25, undefined, 88, 26100, 711000, 533250),
    ] },
  ],
};

export const netOf = (o: Owner) => o.units.reduce((s, u) => s + u.net, 0);
export const grossOf = (o: Owner) => o.units.reduce((s, u) => s + u.gross, 0);
/** Guaranteed rent (GRR) units pay the owner a fixed amount whatever the bookings brought in, so their "net"
 *  is the guarantee, not a share of gross. Shown separately so net is never read as a cut of gross. */
export const guaranteedOf = (o: Owner) => o.units.reduce((s, u) => s + (u.model === 'grr' ? u.net : 0), 0);
export const managedGrossOf = (o: Owner) => o.units.reduce((s, u) => s + (u.model === 'grr' ? 0 : u.gross), 0);
export const managedNetOf = (o: Owner) => o.units.reduce((s, u) => s + (u.model === 'grr' ? 0 : u.net), 0);
// Exact, because terms sit beside owner money (net payout, P&L) that is shown with sen.
export const terms = (u: UnitLine) => u.termsLabel ?? (u.model === 'grr' ? `GRR ${rm(u.grrAmount ?? 0)}/mo` : `${u.feePct ?? 0}% fee`);

// One statement per past period, combined across all of an owner's units.
export interface OwnerStatement { id: string; period: string; grossBookingValue: number; netPayout: number; state: StatementState; hasUnits?: boolean }
export interface StatementsPayload { data: OwnerStatement[]; generatedAt: string }

export const periodLabel = (p: string) => monthLabel(p);

// Dev fallback until GET /api/owners/:id/statements is live: synthesise the last
// few settled months from the owner's current combined gross/net. A brand-new
// owner with no units has no history yet.
export function statementsFallback(o: Owner): StatementsPayload {
  if (o.units.length === 0) return { generatedAt: '', data: [] };
  const gross = grossOf(o), net = netOf(o);
  const periods = ['2026-08', '2026-07', '2026-06', '2026-05'];
  return {
    generatedAt: '',
    data: periods.map((period, i) => {
      const factor = 1 - i * 0.05;
      return { id: `${o.id}-${period}`, period, grossBookingValue: Math.round(gross * factor), netPayout: Math.round(net * factor), state: 'paid' as StatementState };
    }),
  };
}

/** `value` undefined while the figures load: a block the figure's own height stands in for it. */
export function Roll({ label, value, strong }: { label: string; value: string | undefined; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <Eyebrow>{label}</Eyebrow>
      {value === undefined
        ? <div className={cx('skeleton w-[min(120px,70%)]', strong ? 'h-[24px] sm:h-[28px]' : 'h-[18px] sm:h-[20px]')} />
        : <Figure value={value} className={cx('leading-none font-medium text-ink', strong ? 'text-[24px] sm:text-[28px] tracking-[-0.025em]' : 'text-[18px] sm:text-[20px] tracking-[-0.015em]')} />}
    </div>
  );
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Deduction lines of a statement, in the order the report prints them, in the owner's words. */
const DEDUCTION_LABEL: Record<string, string> = {
  cleaning_basic: 'Cleaning fees', cleaning_deep: 'Cleaning fees (deep clean)', electricity: 'Utilities: electricity', water: 'Utilities: water',
  internet: 'Utilities: Wi-Fi', sewerage: 'Utilities: IndahWater', additional: 'Maintenance repair and other fees', misc: 'Other fees',
};
interface StatementDetail {
  id: string; period: string; state: StatementState; source: string;
  totals: { grossIncome: number; operatorShare: number; deductions: number; adjustments: number; netPayout: number };
  units: { unitId: string; label: string; ownerPct: number | null; basis: string; fixedRent: number; topUp: number; nights: number }[];
  lines: { id: string; unitId: string | null; type: string; category: string | null; description: string; amount: number }[];
}

/** One statement's make-up, opened in place: income, each deduction, To Operator, what comes off after the split, and
 *  the Net Payout to Owner, with links to the full statement and the Owner Income Report. */
function StatementMakeUp({ s }: { s: OwnerStatement }) {
  const { data, loading, error } = useApi<{ data: StatementDetail }>(`/statements/${encodeURIComponent(s.id)}`);
  const d = data?.data;
  if (!d) return <div className="px-4 pb-4 text-meta text-muted-ink">{loading ? 'Loading the make-up...' : error ?? 'Could not open this statement.'}</div>;
  const ded = new Map<string, number>();
  for (const l of d.lines) if (l.type === 'expense') ded.set(l.category ?? 'additional', (ded.get(l.category ?? 'additional') ?? 0) - l.amount);
  const order = Object.keys(DEDUCTION_LABEL);
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const deductions = [...ded.entries()].sort(([a], [b]) => rank(a) - rank(b));
  const pcts = [...new Set(d.units.filter(u => u.basis === 'share').map(u => 100 - (u.ownerPct ?? 0)))];
  const toOperator = pcts.length === 1 ? `${Number(pcts[0].toFixed(2))}% To Operator` : 'To Operator';
  const fixed = d.units.filter(u => u.basis !== 'share').reduce((n, u) => n + u.fixedRent, 0);
  const after = d.lines.filter(l => l.type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category ?? ''));
  const topUp = d.units.reduce((n, u) => n + u.topUp, 0);
  const Row = ({ label, sen, strong, muted }: { label: string; sen: number; strong?: boolean; muted?: boolean }) => (
    <div className={cx('flex items-baseline justify-between gap-3 py-[5px]', strong && 'pt-2 mt-1 [border-top:1px_solid_var(--color-line-soft)]')}>
      <span className={cx('text-meta min-w-0', strong ? 'font-semibold text-ink' : muted ? 'text-muted-ink' : 'text-ink')}>{label}</span>
      <MoneyText sen={sen} mode="exact" strong={strong} className="text-meta text-right whitespace-nowrap" />
    </div>
  );
  const hasUnits = d.units.length > 0;
  return (
    <div className="px-4 pb-4 flex flex-col">
      {!hasUnits ? (
        <span className="text-meta text-muted-ink pb-1">{d.source === 'owner_workbook' ? 'Paid from the owner workbook before Property OS: the payout only, not the lines behind it.' : 'No unit figures on this statement.'}</span>
      ) : <>
        <Row label="Gross Income (reservations)" sen={d.totals.grossIncome} />
        {deductions.map(([k, v]) => <Row key={k} label={DEDUCTION_LABEL[k] ?? k} sen={-v} muted />)}
        {d.totals.operatorShare !== 0 && <Row label={toOperator} sen={-d.totals.operatorShare} muted />}
        {fixed > 0 && <Row label="Fixed monthly rent" sen={fixed} />}
        {topUp > 0 && <Row label="Minimum guarantee top-up" sen={topUp} muted />}
        {after.map(l => <Row key={l.id} label={`${l.description} (after the split)`} sen={l.amount} muted />)}
      </>}
      <Row label="Net Payout to Owner" sen={d.totals.netPayout} strong />
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-meta">
        <Link to={`/owners/statements/${encodeURIComponent(s.id)}`} className="text-gold-ink no-underline font-medium">Open the full owner statement</Link>
        {hasUnits
          ? <Link to={`/finance/statements/${encodeURIComponent(s.id)}/report?view=owner`} className="text-gold-ink no-underline font-medium">Owner Income Report</Link>
          : <a href={`/api/statements/${encodeURIComponent(s.id)}/pdf?format=legacy`} target="_blank" rel="noreferrer" className="text-gold-ink no-underline font-medium">Owner statement as paid</a>}
      </div>
    </div>
  );
}

export function StatementHistory({ o }: { o: Owner }) {
  // Combined statement history across the owner's units. Hydrates from the live
  // endpoint when present; the computed fallback keeps the section rendering in dev.
  const { data, loading, error, reload } = useApi<StatementsPayload>(`/owners/${o.id}/statements`, statementsFallback(o));
  const [open, setOpen] = useState<string | null>(null);
  const rows = data?.data ?? [];
  return (
    <Section title="Statement history">
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {error && !data ? (
          <div className="p-4 text-copy text-critical flex items-center gap-3">{error}<button type="button" onClick={reload} className="bg-transparent border-none p-0 text-gold-ink cursor-pointer [font-family:inherit] text-copy">Retry</button></div>
        ) : loading && !data ? <div className="p-4"><div className="skeleton h-16" /></div>
        : rows.length === 0 ? <div className="p-4 text-copy text-muted-ink">No owner statements yet. History appears here once a month is generated for this owner.</div>
        : rows.map(s => {
          const on = open === s.id;
          return (
            <div key={s.id} className="[border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
              <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : s.id)}
                className={cx('w-full grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[110px_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 bg-transparent border-none cursor-pointer text-left [font-family:inherit]', on ? 'bg-page' : 'hover:bg-page')}>
                <span className="text-copy font-medium whitespace-nowrap">{periodLabel(s.period)}</span>
                <span className="hidden sm:block text-meta text-muted-ink truncate">Gross Income <MoneyText sen={s.grossBookingValue} mode="exact" className="text-meta" /></span>
                <MoneyText sen={s.netPayout} mode="exact" strong className="text-copy text-right" />
                <span className="flex items-center gap-2">
                  <StatusBadge entity="statement" value={s.state} size="sm" />
                  <Icon name={on ? 'ChevronUp' : 'ChevronDown'} size="sm" />
                </span>
              </button>
              {on && <div className="bg-page"><StatementMakeUp s={s} /></div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------- form modals ---------- */
export function Modal({ title, sub, onClose, onSubmit, submitLabel, canSubmit, children }: {
  title: string; sub?: string; onClose: () => void; onSubmit: () => void; submitLabel: string; canSubmit: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[480px] max-h-[88vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-title font-semibold">{title}</h2>
            {sub && <p className="m-0 text-copy text-muted-ink">{sub}</p>}
          </div>
          <div className="py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
          {/* Pinned to the bottom so Cancel and the action stay in view when the form is taller than a phone screen. */}
          <div className="sticky bottom-0 py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Fill the required fields first">{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddOwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract' | 'defaultManagementFeePct'>) => void }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', ic: '', bankName: '', bankAccount: '', accountHolder: '' });
  const [holderIsOwner, setHolderIsOwner] = useState(true);
  // A field's error shows once it has been typed in and left, never because the cursor merely passed through it.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<Record<string, boolean>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF(s => ({ ...s, [k]: e.target.value })); setTyped(t => ({ ...t, [k]: true })); };
  const blur = (k: string) => () => setTouched(t => ({ ...t, [k]: !!typed[k] }));
  // Email is optional: an owner is often added before their email is known. If given, it must look like one.
  const emailBad = f.email.trim() !== '' && !/.+@.+\..+/.test(f.email);
  const accountBad = f.bankAccount.trim() !== '' && !/^\d{6,20}$/.test(f.bankAccount.replace(/[\s-]/g, ''));
  const holder = holderIsOwner ? f.displayName.trim() : f.accountHolder.trim();
  const canSubmit = f.displayName.trim() !== '' && !emailBad && !phoneProblem(f.phone) && !accountBad && (holderIsOwner || holder !== '');
  return (
    <Modal title="Add owner" sub="Create the owner, then link units and preset the fee or GRR." onClose={onClose} submitLabel="Add owner" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ displayName: f.displayName.trim(), email: f.email.trim(), phone: f.phone.trim() || null, ic: f.ic.trim() || null, bankName: f.bankName || null, bankAccount: f.bankAccount.replace(/[\s-]/g, '') || null, accountHolder: holder || f.displayName.trim() })}>
      <p className="m-0 -mt-2 text-meta text-muted-ink"><span aria-hidden className="text-danger">*</span> Required. Everything else can be added later.</p>
      <Field label={<>Owner name <span aria-hidden className="text-danger">*</span></>} required autoComplete="off" placeholder="e.g. Lim Chee Keong"
        value={f.displayName} onChange={set('displayName')} onBlur={blur('displayName')}
        error={touched.displayName && !f.displayName.trim() ? 'Enter the owner\'s name as on their IC or passport.' : undefined} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Email" type="email" autoComplete="off" placeholder="e.g. chee.keong@gmail.com" value={f.email} onChange={set('email')} onBlur={blur('email')}
          error={touched.email && emailBad ? 'That does not look like an email address, e.g. name@gmail.com.' : undefined} />
        <PhoneInput label="Phone" value={f.phone} onChange={v => setF(s => ({ ...s, phone: v }))} />
      </div>
      <Field label="IC / passport number" autoComplete="off" placeholder="e.g. 900101-14-1234" help="Malaysian IC or a passport number." value={f.ic} onChange={set('ic')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select showLabel size="md" label="Bank" value={f.bankName} onChange={v => setF(s => ({ ...s, bankName: v }))} placeholder="Choose the bank"
          options={BANKS.map(c => ({ value: c, label: bankName(c) ?? c }))} />
        <Field label="Account number" inputMode="numeric" autoComplete="off" maxLength={30} placeholder="e.g. 5140 1234 5678" value={f.bankAccount}
          onChange={set('bankAccount')} onBlur={blur('bankAccount')}
          error={touched.bankAccount && accountBad ? 'Digits only, 6 to 20 of them. Spaces and dashes are fine.' : undefined} />
      </div>
      <label className="flex items-center gap-2 text-copy text-ink cursor-pointer">
        <input type="checkbox" checked={holderIsOwner} onChange={e => setHolderIsOwner(e.target.checked)} />
        The account is in the owner's name
      </label>
      {!holderIsOwner && (
        <Field label={<>Account holder <span aria-hidden className="text-danger">*</span></>} required autoComplete="off" maxLength={120} placeholder="e.g. Lim Holdings Sdn Bhd"
          help="The name printed on the bank account." value={f.accountHolder} onChange={set('accountHolder')} onBlur={blur('accountHolder')}
          error={touched.accountHolder && !f.accountHolder.trim() ? 'Enter the name on the account, or tick the box above.' : undefined} />
      )}
    </Modal>
  );
}

export function LinkUnitModal({ owner, units, onClose, onSubmit }: { owner: string; units: RosterUnit[]; onClose: () => void; onSubmit: (u: UnitLine) => void }) {
  const choices = units.filter(u => u.ownerName !== owner);
  const [unitId, setUnitId] = useState('');
  const chosen = choices.find(u => u.id === unitId);
  const unitLabel = chosen ? `${chosen.propertyName} ${chosen.unitNumber}` : '';
  const [model, setModel] = useState<FeeModel>('management');
  const [feePct, setFeePct] = useState<number | null>(25);
  const [grrSen, setGrrSen] = useState<number | null>(null);
  const canSubmit = unitId !== '' && (model === 'management' ? feePct != null : grrSen != null);
  return (
    <Modal title="Link a unit" sub={`Assign a unit to ${titleCase(owner)} and preset how the owner is paid.`} onClose={onClose} submitLabel="Link unit" canSubmit={canSubmit}
      onSubmit={() => onSubmit(line(unitId, unitLabel, model, model === 'management' ? feePct ?? undefined : undefined, model === 'grr' ? grrSen ?? undefined : undefined, 0, 0, 0, 0))}>
      <SearchSelect showLabel label="Unit" allLabel="Choose a unit" placeholder="Search unit or building" value={unitId} onChange={v => setUnitId(v)}
        options={choices.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName, hint: u.ownerName ? `now ${titleCase(u.ownerName)}` : undefined }))} />
      <Select showLabel size="md" label="Payout model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Operator share (% of income)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <PercentInput label="Operator share %" value={feePct} onChange={setFeePct} help="Overrides the owner default for this unit. The Conts keeps this share; the owner receives the rest." />
        : <MoneyInput label="Guaranteed rent (RM / month)" placeholder="e.g. 3,500.00" valueSen={grrSen} onChangeSen={setGrrSen} help="The owner is paid this fixed amount regardless of occupancy." />}
    </Modal>
  );
}

export function ContractModal({ owner, onClose, onSubmit }: { owner: string; onClose: () => void; onSubmit: (c: { feePct: number; startedOn: string; renewsOn: string | null }) => void }) {
  const [feePct, setFeePct] = useState<number | null>(25);
  const [startedOn, setStartedOn] = useState('');
  const [renewsOn, setRenewsOn] = useState('');
  const canSubmit = startedOn !== '';
  return (
    <Modal title="Management agreement" sub={`Record the contract terms for ${titleCase(owner)}.`} onClose={onClose} submitLabel="Save contract" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ feePct: feePct ?? 0, startedOn, renewsOn: renewsOn || null })}>
      <PercentInput label="Operator share %" value={feePct} onChange={setFeePct} help="Set 0 for a GRR-only arrangement." />
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Start date" value={startedOn} onChange={setStartedOn} />
        <DateField label="Renews on" value={renewsOn} onChange={setRenewsOn} min={startedOn || undefined} />
      </div>
    </Modal>
  );
}
