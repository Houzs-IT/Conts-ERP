/* Small pieces shared by the Packages module screens (owner, 20 Nov 2026). */

import type { ReactElement } from 'react';
import { cn } from '../../lib/utils';
import { KIND_LABEL, STATUS_LABEL, type PackageKind, type PackageStatus } from '../../lib/renovation/renovationPackagesApi';

const pill = 'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';

export function KindPill({ kind, className }: { kind: PackageKind; className?: string }): ReactElement {
  return <span className={cn(pill, kind === 'KIT' ? 'border-primary/20 bg-primary-soft text-primary-ink' : 'border-[#e7b7d3] bg-[#fbe7f2] text-[#9b2c6b]', className)}>{KIND_LABEL[kind]}</span>;
}

export function PackageStatusPill({ status, className }: { status: PackageStatus; className?: string }): ReactElement {
  const tone = status === 'ACTIVE' ? 'border-synced/20 bg-synced-bg text-synced' : status === 'DRAFT' ? 'border-warning-text/20 bg-warning-bg text-warning-text' : 'border-border bg-surface-2 text-ink-secondary';
  return <span className={cn(pill, tone, className)}>{STATUS_LABEL[status]}</span>;
}

export function SlaPill({ set }: { set: boolean }): ReactElement {
  return <span className={cn(pill, set ? 'border-synced/20 bg-synced-bg text-synced' : 'border-border bg-surface-2 text-ink-secondary')}>{set ? 'Set' : 'Not set'}</span>;
}

/** The small mark on a sales order / VO line that came from a package. Screen only. */
export function PkgMark({ code }: { code: string | null }): ReactElement {
  return <span title={code ? `Came from package ${code}` : 'Came from a package'} className={cn(pill, 'border-[#e7b7d3] bg-[#fbe7f2] px-1.5 py-0 text-[10px] text-[#9b2c6b]')}>PKG</span>;
}

/** A whole-number day count typed in a cell: blank is none, else 0..3650. */
export function slaDaysOf(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(3650, Math.max(0, n)) : null;
}

export const dayCell = 'h-8 w-[72px] rounded border border-border bg-surface px-1.5 text-right text-[12.5px] tabular-nums outline-none focus:border-primary disabled:bg-surface-2';


/** A day count cell with its unit beside it, so "7" reads as 7 days. Blank shows "-" and means no automatic date. */
export function DaysInput({ value, onChange, label, disabled, placeholder = '-' }: {
  value: number | null | undefined; onChange: (v: number | null) => void; label: string; disabled?: boolean; placeholder?: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      <input aria-label={label} type="number" min={0} inputMode="numeric" placeholder={placeholder} disabled={disabled} className={cn(dayCell, 'w-[56px]')}
        value={value ?? ''} onChange={(e) => onChange(slaDaysOf(e.target.value))} />
      <span className="text-[11.5px] text-ink-muted">days</span>
    </span>
  );
}
