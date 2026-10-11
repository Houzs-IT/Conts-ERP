import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { MoneyInput, PercentInput, PhoneInput, DateField, phoneProblem } from '../../components/inputs';
import { useApi } from '../../lib/useApi';
import type { RosterUnit } from '../../lib/useUnitRoster';
import { rm, monthLabel, titleCase } from '../../lib/format';
import { MoneyText } from '../../components/MoneyText';
import { DataTable, type Column } from '../../components/DataTable';
import { Select, SearchSelect } from '../../components/Select';
import { cx } from '../../lib/design-tokens';
import type { StatementState } from '../../lib/types';
import type { RevenueModel } from '../../lib/revenueModel';
import { TERMS } from '../../lib/statementTerms';

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
}
export interface Owner {
  id: string; displayName: string; email: string; phone: string | null; ic: string | null;
  legalName?: string | null; address?: string | null; notes?: string | null;
  bankName: string | null; bankAccount: string | null; accountHolder: string | null;
  /** The API sends only the last four characters; the full number needs an audited reveal. */
  icLast4?: string | null; bankAccountLast4?: string | null;
  portalInvited: boolean;
  /** Owner-level default management fee, applied to units with no per-unit override. Null = none set. */
  defaultManagementFeePct: number | null;
  contract: { feePct: number; startedOn: string; renewsOn: string | null; endsOn?: string | null } | null;
  /** The owner's statement for the month asked for, if generated. */
  statement?: { id: string; state: StatementState } | null;
  units: UnitLine[];
}
export interface Payload { data: Owner[]; generatedAt: string; month?: string }

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

export function Roll({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className={cx('font-semibold tabular-nums', strong ? 'text-title' : 'text-heading')}>{value}</span>
      <span className="text-caption text-muted-ink">{label}</span>
    </div>
  );
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-meta font-semibold text-muted-ink">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatementHistory({ o }: { o: Owner }) {
  // Combined statement history across the owner's units. Hydrates from the live
  // endpoint when present; the computed fallback keeps the section rendering in dev.
  const { data, loading, error, reload } = useApi<StatementsPayload>(`/owners/${o.id}/statements`, statementsFallback(o));
  const navigate = useNavigate();
  const columns = useMemo<Column<OwnerStatement>[]>(() => [
    { key: 'period', label: 'Month', value: s => s.period, render: s => <span className="text-copy font-medium whitespace-nowrap">{periodLabel(s.period)}</span>,
      exportValue: s => periodLabel(s.period), hideable: false, width: 110, filter: false },
    { key: 'gross', label: TERMS.grossIncome, type: 'money', value: s => s.grossBookingValue, width: 120,
      render: s => <MoneyText sen={s.grossBookingValue} mode="exact" tone="muted" className="text-meta" /> },
    { key: 'net', label: TERMS.netPayout, type: 'money', value: s => s.netPayout, width: 120,
      render: s => <MoneyText sen={s.netPayout} mode="exact" strong className="text-copy" /> },
    { key: 'state', label: 'Status', type: 'status', value: s => s.state, width: 110, entity: 'statement' },
  ], []);
  return (
    <Section title="Statement history">
      <div className="border border-solid border-line rounded-card overflow-hidden">
        <DataTable<OwnerStatement> id="owner.statements" urlPrefix="stmt." bare noViews pageSize={0} maxHeight="420px"
          columns={columns} rows={data ? data.data : null} rowKey={s => s.id} loading={loading} error={error} onRetry={reload}
          onRowClick={s => navigate(`/finance/statements/${encodeURIComponent(s.id)}`)}
          noun={['statement', 'statements']} exportName={`${o.displayName} statements`}
          empty={{ title: 'No statements yet.', body: 'History appears here once a period is generated for this owner.', icon: 'FileText' }} />
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
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[480px] max-h-[88vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
          <div className="pt-[22px] px-[22px] pb-1 flex flex-col gap-[5px]">
            <h2 className="m-0 text-title font-semibold">{title}</h2>
            {sub && <p className="m-0 text-copy text-muted-ink">{sub}</p>}
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

export function AddOwnerModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (o: Omit<Owner, 'id' | 'units' | 'portalInvited' | 'contract' | 'defaultManagementFeePct'>) => void }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', ic: '', bankName: '', bankAccount: '', accountHolder: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  // Email is optional: an owner is often added before their email is known. If given, it must look like one.
  const canSubmit = f.displayName.trim() !== '' && (f.email.trim() === '' || /.+@.+\..+/.test(f.email)) && !phoneProblem(f.phone);
  return (
    <Modal title="Add owner" sub="Create the owner, then link units and preset the fee or GRR." onClose={onClose} submitLabel="Add owner" canSubmit={canSubmit}
      onSubmit={() => onSubmit({ displayName: f.displayName.trim(), email: f.email.trim(), phone: f.phone.trim() || null, ic: f.ic.trim() || null, bankName: f.bankName.trim() || null, bankAccount: f.bankAccount.trim() || null, accountHolder: f.accountHolder.trim() || f.displayName.trim() })}>
      <Field label="Owner name" placeholder="e.g. Lim Chee Keong" value={f.displayName} onChange={set('displayName')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" type="email" placeholder="owner@email.com" value={f.email} onChange={set('email')}
          error={f.email.trim() && !/.+@.+\..+/.test(f.email) ? 'Enter an email like name@example.com, or leave it empty.' : undefined} />
        <PhoneInput label="Phone" value={f.phone} onChange={v => setF(s => ({ ...s, phone: v }))} />
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
  const [feePct, setFeePct] = useState<number | null>(25);
  const [grrSen, setGrrSen] = useState<number | null>(null);
  const canSubmit = unitId !== '' && (model === 'management' ? feePct != null : grrSen != null);
  return (
    <Modal title="Link a unit" sub={`Assign a unit to ${titleCase(owner)} and preset how the owner is paid. Share + minimum, master lease and long-term let are set on the unit's Contract tab after linking.`} onClose={onClose} submitLabel="Link unit" canSubmit={canSubmit}
      onSubmit={() => onSubmit(line(unitId, unitLabel, model, model === 'management' ? feePct ?? undefined : undefined, model === 'grr' ? grrSen ?? undefined : undefined, 0, 0, 0, 0))}>
      <SearchSelect showLabel label="Unit" allLabel="Choose a unit" placeholder="Search unit or building" value={unitId} onChange={v => setUnitId(v)}
        options={choices.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName, hint: u.ownerName ? `now ${titleCase(u.ownerName)}` : undefined }))} />
      <Select showLabel size="md" label="Payout model" value={model} onChange={v => setModel(v as FeeModel)}
        options={[{ value: 'management', label: 'Management fee (% of revenue)' }, { value: 'grr', label: 'GRR — guaranteed monthly rent' }]} />
      {model === 'management'
        ? <PercentInput label="Management fee %" value={feePct} onChange={setFeePct} help="Overrides the owner default for this unit. The Conts keeps this share; the owner receives the rest." />
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
      <PercentInput label="Management fee %" value={feePct} onChange={setFeePct} help="Set 0 for a GRR-only arrangement." />
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Start date" value={startedOn} onChange={setStartedOn} />
        <DateField label="Renews on" value={renewsOn} onChange={setRenewsOn} min={startedOn || undefined} />
      </div>
    </Modal>
  );
}
