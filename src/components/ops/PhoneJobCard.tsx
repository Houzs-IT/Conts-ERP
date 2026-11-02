import type { ReactNode } from 'react';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';

/* The phone list of cleaning jobs, shared by the Cleaning page on a phone and the cleaner's portal so both read the same
   (owner, 2 Nov 2026). Words come from the caller: the Cleaning page is English, the portal is in the cleaner's language. */

/** The list's frame: one card, a hairline between jobs. */
export function PhoneJobList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return <div role="list" aria-label={label} className={cx('bg-card rounded-card border border-solid border-line overflow-hidden flex-none flex flex-col [&>*+*]:[border-top:1px_solid_var(--color-line-soft)]', className)}>{children}</div>;
}

/** Row colour: red when the checkout time passed and nobody ticked the guest out, yellow while the clean is under way. */
export type PhoneJobTone = 'overdue' | 'out' | null;
const TONE_BG: Record<NonNullable<PhoneJobTone> | 'none', string> = { overdue: 'bg-danger-bg', out: 'bg-warning-bg', none: 'active:bg-page' };

/**
 * One job, three short lines: unit and status; who has it (and the building, when the card is not under its building's
 * header, or an external job's client); the guest leaving and the
 * guest arriving as times only. No guest names and no unit size: those are on the job sheet (owner, 2 Nov 2026).
 * The whole row opens the job sheet; controls inside it stop their own clicks.
 */
export function PhoneJobCard({ title, building, lead, badges, status, right, out, arrive, note, tone, active, onSelect, label }: {
  title: string; building?: string; lead?: ReactNode; badges?: ReactNode; status: ReactNode; right?: ReactNode;
  out?: ReactNode; arrive?: ReactNode; note?: ReactNode; tone?: PhoneJobTone; active?: boolean; onSelect?: () => void; label?: string;
}) {
  return (
    <div role="listitem">
      <div role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? active : undefined} aria-label={label} onClick={onSelect}
        onKeyDown={onSelect && (e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } })}
        className={cx('px-3 py-2.5 text-copy flex flex-col gap-1 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-gold)]', onSelect && 'cursor-pointer',
          active ? 'bg-gold-tint [box-shadow:inset_3px_0_0_var(--color-gold)]' : TONE_BG[tone ?? 'none'])}>
        {/* Wraps rather than cutting the unit code short (it read "C." on a phone). */}
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
          {lead}
          <b className="min-w-0 text-ink text-[16px] leading-tight [overflow-wrap:anywhere]">{title}</b>
          {badges}
          <span className="ml-auto min-w-0 flex items-center justify-end gap-1.5">{status}</span>
        </div>
        {(building || right) && (
          <div className="flex items-center gap-2 min-w-0 text-meta text-muted-ink">
            {building && <span className="min-w-0 truncate">{building}</span>}
            {right && <span className="flex-none ml-auto flex items-center">{right}</span>}
          </div>
        )}
        {/* Two fixed columns, so every card's "In" starts at the same place down the list. */}
        {(out || arrive) && <div className="grid grid-cols-[minmax(0,6.75rem)_minmax(0,1fr)] items-center gap-x-3 min-w-0">{out ?? <span />}{arrive}</div>}
        {note}
      </div>
    </div>
  );
}

/**
 * "Out 11:48" or "In 15:00 · 2h left". `actual` marks a time that really happened (the guest left at 11:48) rather
 * than the planned checkout, with a tick after it.
 */
export function PhoneStayTime({ label, time, actual, actualLabel, aside }: { label: string; time?: string; actual?: boolean; actualLabel?: string; aside?: ReactNode }) {
  return (
    <span className="inline-flex items-center flex-wrap gap-x-1.5 min-h-6 min-w-0">
      <span className="text-muted-ink">{label}</span>
      {time && <b className="tabular-nums text-ink">{time}</b>}
      {actual && <span className="flex-none text-gold-ink inline-flex" title={actualLabel}><Icon name="Check" size="sm" /><span className="sr-only">{actualLabel}</span></span>}
      {aside}
    </span>
  );
}
