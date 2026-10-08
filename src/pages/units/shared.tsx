import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../../lib/design-tokens';
import type { Tone, UnitReadiness, TaskState, BookingChannel, ReservationState } from '../../lib/types';

export const BANKS = ['MBBE', 'PBBB', 'CIBB', 'RHBB', 'HLBB', 'AMBB', 'BIMB', 'UOVB', 'OCBC'];
export const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Melaka', 'Perak', 'Negeri Sembilan'];
export const PACKAGES = ['Package A', 'Package B', 'Package C'];
export const TERMS = ['Long term', 'Short term'];
export const SPLITS = ['Not set', 'Profit share', 'GRR — guaranteed rent'];

/** Roles that may edit unit master data: MASTER_ROLES in functions/_lib/properties.ts. */
export const MASTER_ROLES = ['management', 'operations_manager', 'finance_admin'];

export const READY_TONE: Record<UnitReadiness, Tone> = {
  occupied: 'info', dirty: 'warning', cleaning: 'info', inspection: 'warning',
  ready: 'success', maintenance: 'critical', blocked: 'neutral',
};
export const TASK_TONE: Record<TaskState, Tone> = {
  open: 'neutral', assigned: 'info', in_progress: 'info', waiting: 'warning',
  resolved: 'success', overdue: 'critical', reopened: 'critical',
};
export const RES_TONE: Record<ReservationState, Tone> = {
  inquiry: 'neutral', pending: 'warning', confirmed: 'info', checked_in: 'success',
  checked_out: 'neutral', cancelled: 'neutral', no_show: 'critical',
};
export const COND_TONE: Record<string, Tone> = {
  good: 'success', fair: 'neutral', replace_soon: 'warning', damaged: 'critical',
};
export const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/* ---- GET /api/properties: the tree and the editable unit master data ---- */
export interface Expense { id: string; category: string; amount: number; note: string }
export type GuaranteePeriod = 'month' | 'year';
export interface Unit {
  id: string; buildingId: string; parentUnitId: string | null;
  listingName: string; unitCode: string; state: string; address: string;
  ownerName: string; ic: string; bankName: string; bankAccount: string; accountHolder: string;
  pkg: string; term: string; split: string; splitValue: number | null; guaranteePeriod: GuaranteePeriod;
  bedrooms?: number;
  /** Sen. Present only for roles that see money; saved through PUT /api/rates, not the unit PATCH. */
  baseRate?: number;
  expenses: Expense[];
  contract: { feePct: number; startedOn: string; renewsOn: string; documents: { id: string; name: string }[] };
}
export interface Building { id: string; name: string; city: string; state: string }
export interface PropertiesPayload { buildings: Building[]; units: Unit[]; generatedAt: string }

/* ---- GET /api/units/detail: the record for one unit ---- */
export interface UnitDetail {
  unit: {
    id: string; unitNumber: string; channexLinked?: boolean; propertyName: string; addressLine: string;
    city: string; state: string; postcode: string | null;
    readiness: UnitReadiness; bedrooms: number; bathrooms: number; maxGuests: number;
    sizeSqft: number | null; isListed: boolean; fittedOutAt: string | null;
    channels: BookingChannel[];
    owner: { id: string; name: string; email: string | null };
    contract: { managementFeePct: number; startsOn: string; renewsOn: string | null } | null;
    baseRate?: number;
  };
  performance: {
    period: string; occupancy: number; occupiedNights: number; adr: number;
    revpar: number; rating: number | null; reviewCount: number;
    revenue?: number; gross?: number;
  };
  pnl?: { label: string; amount: number; type: string }[];
  stays: { id: string; guestName: string | null; channel: BookingChannel; state: ReservationState; checkIn: string; checkOut: string; guestsCount: number; externalRef: string | null; grossBookingValue?: number }[];
  tasks: { id: string; title: string; kind: string; state: TaskState; dueAt: string | null; completedAt: string | null; assigneeName: string | null }[];
  maintenance: { id: string; title: string; detail: string | null; state: TaskState; vendorName: string | null; ownerApprovalRequired: boolean; blocksUnit: boolean; chargeTo: string; reportedAt: string; resolvedAt: string | null; quotedAmount?: number | null; finalAmount?: number | null }[];
  inventory: { id: string; name: string; quantity: string; condition: string; suppliedInHouse: boolean; installedOn: string | null; lastChecked: string | null; purchaseCost?: number | null }[];
  documents: { id: string; name: string; kind: string; sizeLabel: string; updatedAt: string }[];
  activity: { actorLabel: string; action: string; source: string; occurredAt: string }[];
  generatedAt: string;
}

/** GET /api/units — only the readiness is used here, to colour the tree. */
export interface RosterRow { id: string; readiness: UnitReadiness }

/* ---- small building blocks ---- */
export function SectionHead({ children, noMargin }: { children: ReactNode; noMargin?: boolean }) {
  return <div className={cx('text-[11px] font-bold tracking-[0.08em] text-muted-ink', noMargin ? 'm-0' : 'mt-1 mb-[14px]')}>{String(children).toUpperCase()}</div>;
}
export function Grid3({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 mb-[22px]">{children}</div>;
}
export function Labeled({ label, hint, help, span2, children }: { label: string; hint: string; help?: string; span2?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1.5 min-w-0', span2 && 'sm:[grid-column:span_2]')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-ink">{label}</span>
        <span className="text-[9px] font-bold tracking-[0.08em] text-faint">{hint}</span>
      </div>
      {children}
      {help && <span className="text-[11px] text-muted-ink">{help}</span>}
    </div>
  );
}
export function Select({ value, onChange, options, disabled, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean; label?: string }) {
  return (
    <select value={value} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.value)}
      className="h-[var(--control-height)] w-full min-w-0 box-border px-3 py-0 font-sans text-[14px] text-ink bg-card border border-solid border-line rounded-control outline-none disabled:bg-muted disabled:text-muted-ink">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
/** A value shown in the place of a field, for data that is set somewhere else. */
export function ReadOnly({ children }: { children: ReactNode }) {
  return <div className="h-[var(--control-height)] flex items-center px-3 text-[14px] text-muted-ink bg-muted border border-solid border-line rounded-control overflow-hidden whitespace-nowrap text-ellipsis">{children}</div>;
}

export function CentreModal({ title, sub, onClose, footer, children }: { title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input,select,textarea')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[460px] max-h-[calc(100vh-32px)] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="pt-[22px] px-[22px] pb-1"><h2 className="m-0 text-[18px] font-semibold">{title}</h2>{sub && <p className="mt-[5px] mb-0 text-[13px] text-muted-ink">{sub}</p>}</div>
        <div className="py-4 px-[22px] flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end flex-wrap gap-[9px]">{footer}</div>
      </div>
    </div>
  );
}
