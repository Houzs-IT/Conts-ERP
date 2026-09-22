import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { useApi } from '../../lib/useApi';
import type { RosterUnit } from '../../lib/useUnitRoster';
import { rm, monthLabel } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { STATEMENT } from '../../lib/vocabulary';
import type { StatementState } from '../../lib/types';

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

export interface UnitLine {
  unitId: string; unitLabel: string; model: FeeModel; feePct?: number; grrAmount?: number;
  feeSource?: FeeSource;
  occupancy: number; adr: number; gross: number; net: number;
}
export interface Owner {
  id: string; displayName: string; email: string; phone: string | null; ic: string | null;
  bankName: string | null; bankAccount: string | null; accountHolder: string | null;
  portalInvited: boolean;
  /** Owner-level default management fee, applied to units with no per-unit override. Null = none set. */
  defaultManagementFeePct: number | null;
  contract: { feePct: number; startedOn: string; renewsOn: string | null } | null;
  units: UnitLine[];
}
export interface Payload { data: Owner[]; generatedAt: string }

export const line = (unitId: string, unitLabel: string, model: FeeModel, feePct: number | undefined, grrAmount: number | undefined, occupancy: number, adr: number, gross: number, net: number): UnitLine =>
  ({ unitId, unitLabel, model, feePct, grrAmount, occupancy, adr, gross, net });

export const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'o1', displayName: 'Lim Chee Keong', email: 'limck@example.com', phone: '+60 12-333 0001', ic: '680606-08-5101', bankName: 'PBBB', bankAccount: '4605371109', accountHolder: 'LIANG WOOI KEE', portalInvited: true, defaultManagementFeePct: 25, contract: { feePct: 25, startedOn: '2025-03-01', renewsOn: '2027-03-01' }, units: [line('u1', 'Vista Jaya One #A-12-03', 'management', 25, undefined, 86, 28400, 812000, 609000)] },
    { id: 'o2', displayName: 'Wong Mei Ling', email: 'wongml@example.com', phone: '+60 12-333 0002', ic: '710214-14-5220', bankName: 'MBBE', bankAccount: '1512988771', accountHolder: 'Wong Mei Ling', portalInvited: true, defaultManagementFeePct: 25, contract: { feePct: 25, startedOn: '2025-06-01', renewsOn: '2027-06-01' }, units: [line('u2', 'Arcoris #B-08-11', 'management', 25, undefined, 79, 23100, 634000, 475500)] },
    { id: 'o3', displayName: 'Rajesh Kumar', email: 'rajesh@example.com', phone: '+60 12-333 0003', ic: '650930-10-5333', bankName: 'CIBB', bankAccount: '7024551200', accountHolder: 'Rajesh A/L Kumar', portalInvited: false, defaultManagementFeePct: null, contract: { feePct: 0, startedOn: '2025-11-01', renewsOn: '2026-11-01' }, units: [line('u3', 'Tribeca #2207', 'grr', undefined, 350000, 88, 31800, 901000, 350000)] },
    { id: 'o4', displayName: 'Chong Wei Han', email: 'chongwh@example.com', phone: '+60 12-333 0004', ic: '730118-08-5019', bankName: 'PBBB', bankAccount: '3388120945', accountHolder: 'Chong Wei Han', portalInvited: false, defaultManagementFeePct: 20, contract: { feePct: 25, startedOn: '2025-08-01', renewsOn: '2027-08-01' }, units: [line('u4', 'Scarletz #15-06', 'management', 25, undefined, 74, 26500, 588000, 441000)] },
    // A multi-unit owner: the record rolls all three units into one combined net payout and one combined statement history.
    { id: 'o5', displayName: 'Goh Family Trust', email: 'gohtrust@example.com', phone: '+60 12-333 0005', ic: null, bankName: 'HLBB', bankAccount: '2299013848', accountHolder: 'Goh Family Trust', portalInvited: true, defaultManagementFeePct: 22, contract: { feePct: 25, startedOn: '2025-02-01', renewsOn: '2027-02-01' }, units: [
      line('u5', 'Sunway Velocity #V-18-07', 'management', 25, undefined, 91, 30200, 742000, 556500),
      line('u6', 'Sunway Velocity #V-22-03', 'management', 25, undefined, 84, 27800, 681000, 510750),
      line('u7', 'Sunway Velocity #V-09-11', 'management', 25, undefined, 88, 26100, 711000, 533250),
    ] },
  ],
};

export const netOf = (o: Owner) => o.units.reduce((s, u) => s + u.net, 0);
export const grossOf = (o: Owner) => o.units.reduce((s, u) => s + u.gross, 0);
export const terms = (u: UnitLine) => u.model === 'grr' ? `GRR ${rm(u.grrAmount ?? 0, { cents: false })}/mo` : `${u.feePct ?? 0}% fee`;

// One statement per past period, combined across all of an owner's units.
export interface OwnerStatement { id: string; period: string; grossBookingValue: number; netPayout: number; state: StatementState }
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

export const linkBtn = 'inline-flex items-center gap-[5px] bg-transparent [border:none] cursor-pointer font-sans text-[12.5px] font-medium text-gold-ink';

export function Roll({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className={cx('font-semibold tabular-nums', strong ? 'text-[19px]' : 'text-[15px]')}>{value}</span>
      <span className="text-[11px] text-muted-ink">{label}</span>
    </div>
  );
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-ink">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatementHistory({ o }: { o: Owner }) {
  // Combined statement history across the owner's units. Hydrates from the live
  // endpoint when present; the computed fallback keeps the section rendering in dev.
  const { data } = useApi<StatementsPayload>(`/owners/${o.id}/statements`, statementsFallback(o));
  const history = data?.data ?? [];
  return (
    <Section title="Statement history">
      {history.length === 0 ? (
        <div className="text-[12.5px] text-muted-ink">No statements yet. History appears here once a period is generated for this owner.</div>
      ) : (
        <div className="border border-solid border-line rounded-card overflow-hidden">
          {history.map(s => (
            <a key={s.id} href={`#/finance/statements/${encodeURIComponent(s.id)}`}
              className="grid grid-cols-[1fr_0.9fr_0.9fr_auto] gap-2.5 items-center py-[11px] px-[13px] [border-bottom:1px_solid_var(--color-line-soft)] no-underline text-inherit!">
              <div className="text-[12.5px] font-medium">{periodLabel(s.period)}</div>
              <span className="text-[12px] text-right text-muted-ink tabular-nums">{rm(s.grossBookingValue, { cents: false })}</span>
              <span className="text-[12.5px] text-right font-semibold tabular-nums">{rm(s.netPayout, { cents: false })}</span>
              <span className="flex justify-end"><Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} size="sm" /></span>
            </a>
          ))}
        </div>
      )}
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
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[480px] max-h-[88vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-[18px] font-semibold">{title}</h2>
            {sub && <p className="m-0 text-[13px] text-muted-ink">{sub}</p>}
          </div>
          <div className="py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSubmit} disabledReason="Fill the required fields first">{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
const selectStyle = 'h-[var(--control-height)] w-full box-border py-0 px-3 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none';
export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label className="text-[12px] font-medium text-muted-ink">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={selectStyle}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}

export function AddOwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract' | 'defaultManagementFeePct'>) => void }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', ic: '', bankName: '', bankAccount: '', accountHolder: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const canSubmit = f.displayName.trim() !== '' && /.+@.+\..+/.test(f.email);
  return (
    <Modal title="Add owner" sub="Create the owner, then link units and preset the fee or GRR." onClose={onClose} submitLabel="Add owner" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ displayName: f.displayName.trim(), email: f.email.trim(), phone: f.phone.trim() || null, ic: f.ic.trim() || null, bankName: f.bankName.trim() || null, bankAccount: f.bankAccount.trim() || null, accountHolder: f.accountHolder.trim() || f.displayName.trim() })}>
      <Field label="Owner name" placeholder="e.g. Lim Chee Keong" value={f.displayName} onChange={set('displayName')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" type="email" placeholder="owner@email.com" value={f.email} onChange={set('email')} />
        <Field label="Phone" placeholder="+60 12-345 6789" value={f.phone} onChange={set('phone')} />
      </div>
      <Field label="IC / passport" placeholder="Accepts both formats" value={f.ic} onChange={set('ic')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank" placeholder="e.g. PBBB" value={f.bankName} onChange={set('bankName')} />
        <Field label="Bank account" placeholder="Account number" value={f.bankAccount} onChange={set('bankAccount')} />
      </div>
      <Field label="Account holder" placeholder="If different from owner name" value={f.accountHolder} onChange={set('accountHolder')} />
    </Modal>
  );
}

export function LinkUnitModal({ owner, units, onClose, onSubmit }: { owner: string; units: RosterUnit[]; onClose: () => void; onSubmit: (u: UnitLine) => void }) {
  const choices = units.filter(u => u.ownerName !== owner);
  const [unitId, setUnitId] = useState('');
  const chosen = choices.find(u => u.id === unitId);
  const unitLabel = chosen ? `${chosen.propertyName} ${chosen.unitNumber}` : '';
  const [model, setModel] = useState<FeeModel>('management');
  const [feePct, setFeePct] = useState('25');
  const [grr, setGrr] = useState('');
  const canSubmit = unitId !== '' && (model === 'management' ? feePct !== '' : grr !== '');
  return (
    <Modal title="Link a unit" sub={`Assign a unit to ${owner} and preset how the owner is paid.`} onClose={onClose} submitLabel="Link unit" canSubmit={canSubmit}
      onSubmit={() => onSubmit(line(unitId, unitLabel, model, model === 'management' ? Number(feePct) : undefined, model === 'grr' ? Math.round(Number(grr) * 100) : undefined, 0, 0, 0, 0))}>
      <SelectField label="Unit" value={unitId} onChange={v => setUnitId(v)}
        options={[{ value: '', label: 'Choose a unit' }, ...choices.map(u => ({ value: u.id, label: `${u.propertyName} ${u.unitNumber}${u.ownerName ? ` (now ${u.ownerName})` : ''}` }))]} />
      <SelectField label="Payout model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Management fee (% of revenue)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="Overrides the owner default for this unit. The Conts keeps this share; the owner receives the rest." />
        : <Field label="Guaranteed rent (RM / month)" type="number" min={0} numeric placeholder="e.g. 3500" value={grr} onChange={e => setGrr(e.target.value)} help="The owner is paid this fixed amount regardless of occupancy." />}
    </Modal>
  );
}

export function ContractModal({ owner, onClose, onSubmit }: { owner: string; onClose: () => void; onSubmit: (c: { feePct: number; startedOn: string; renewsOn: string | null }) => void }) {
  const [feePct, setFeePct] = useState('25');
  const [startedOn, setStartedOn] = useState('');
  const [renewsOn, setRenewsOn] = useState('');
  const canSubmit = startedOn !== '';
  return (
    <Modal title="Management agreement" sub={`Record the contract terms for ${owner}.`} onClose={onClose} submitLabel="Save contract" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ feePct: Number(feePct) || 0, startedOn, renewsOn: renewsOn || null })}>
      <Field label="Management fee %" type="number" min={0} max={100} numeric value={feePct} onChange={e => setFeePct(e.target.value)} help="Set 0 for a GRR-only arrangement." />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date" type="date" value={startedOn} onChange={e => setStartedOn(e.target.value)} />
        <Field label="Renews on" type="date" value={renewsOn} onChange={e => setRenewsOn(e.target.value)} />
      </div>
    </Modal>
  );
}
