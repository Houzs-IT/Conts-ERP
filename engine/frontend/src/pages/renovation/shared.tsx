/* Small building blocks shared by the renovation pages. */

import { useState, type ReactNode } from 'react';
import { formatRm } from '../../vendor/shared/renovation-money';
import { STATUS_LABEL } from '../../lib/renovation/api';
import { cn } from '../../lib/utils';

export const rm = (sen: number | null | undefined): string => (sen === null || sen === undefined ? '—' : `RM ${formatRm(sen)}`);

export const pctLabel = (bp: number): string => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

const TONE: Record<string, string> = {
  DRAFT: 'bg-surface-2 text-ink-secondary border-border',
  SENT: 'bg-warning-bg text-warning-text border-warning-text/20',
  ACCEPTED: 'bg-synced-bg text-synced border-synced/20',
  APPROVED: 'bg-synced-bg text-synced border-synced/20',
  REJECTED: 'bg-err-bg text-err border-err/20',
  EXPIRED: 'bg-expired-bg text-expired-text border-expired-text/20',
  CANCELLED: 'bg-err-bg text-err border-err/20',
  RENO_CONFIRMED: 'bg-primary-soft text-primary-ink border-primary/20',
  RENO_IN_PROGRESS: 'bg-warning-bg text-warning-text border-warning-text/20',
  RENO_COMPLETED: 'bg-synced-bg text-synced border-synced/20',
  CLOSED: 'bg-surface-2 text-ink-secondary border-border',
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold', TONE[status] ?? TONE.DRAFT, className)}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Card({ title, actions, children, className, dense }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={dense ? 'p-0' : 'p-4'}>{children}</div>
    </section>
  );
}

export function ErrorBanner({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 whitespace-pre-line rounded-lg border border-err/30 bg-err-bg px-3 py-2 text-[12.5px] text-err">
      <span>{error}</span>
      {onClose && <button type="button" onClick={onClose} className="shrink-0 font-semibold">Dismiss</button>}
    </div>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-9 min-w-0 rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary disabled:bg-surface-2 disabled:text-ink-muted';
export const cellBaseCls = 'h-8 min-w-0 rounded border border-transparent bg-transparent px-1.5 text-[12.5px] text-ink outline-none hover:border-border focus:border-primary focus:bg-surface disabled:hover:border-transparent';
export const cellInputCls = `${cellBaseCls} w-full`;

/** Money typed in ringgit, held in sen. Blank -> null when `nullable`. */
export function MoneyInput({ value, onChange, disabled, nullable, className, placeholder, ariaLabel }: {
  value: number | null; onChange: (sen: number | null) => void; disabled?: boolean; nullable?: boolean; className?: string; placeholder?: string; ariaLabel?: string;
}) {
  const shown = value === null ? '' : (value / 100).toFixed(2).replace(/\.00$/, '');
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      className={cn(className ?? `${inputCls} w-full`, 'text-right tabular-nums')}
      disabled={disabled}
      placeholder={placeholder}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const t = draft.replace(/,/g, '').trim();
        setDraft(null);
        if (t === '') { onChange(nullable ? null : 0); return; }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(Math.round(n * 100));
      }}
    />
  );
}

/** Percent typed as 40 or 12.5, held in basis points. */
export function PercentInput({ value, onChange, disabled, className, ariaLabel }: { value: number; onChange: (bp: number) => void; disabled?: boolean; className?: string; ariaLabel?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value ? String(value / 100) : '';
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      className={cn(className ?? `${inputCls} w-full`, 'text-right tabular-nums')}
      disabled={disabled}
      value={draft ?? shown}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const n = Number(draft.trim() || '0');
        setDraft(null);
        if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(Math.round(n * 100));
      }}
    />
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={cn('truncate text-[15px] font-semibold tabular-nums', tone === 'ok' ? 'text-synced' : tone === 'warn' ? 'text-warning-text' : 'text-ink')}>{value}</div>
    </div>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export const todayIso = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
