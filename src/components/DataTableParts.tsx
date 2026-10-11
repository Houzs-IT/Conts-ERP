import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { StatusBadge } from './StatusBadge';
import ChannelMark from './ChannelMark';
import { CHANNEL_META, cx } from '../lib/design-tokens';
import type { BookingChannel } from '../lib/types';
import type { AnyTone } from '../lib/status';

/**
 * Pieces of the shared table (DataTable.tsx): a floating panel that is not clipped by the table's scroll box,
 * the default cell faces, and the status adapter.
 */

/** A panel under its trigger, drawn on top of the page so a scrolling table cannot clip it. Closes on an outside
 *  click or Escape. */
export function Floating({ anchor, open, onClose, width = 260, align = 'left', children, label }: {
  anchor: RefObject<HTMLElement>; open: boolean; onClose: () => void; width?: number; align?: 'left' | 'right';
  children: ReactNode; label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; w: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 16);
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 12;
      // Opens upwards only when there is clearly more room above (a trigger near the bottom of a phone screen).
      if (below < 220 && r.top > below + 80) setPos({ top: Math.max(8, r.top - 4 - Math.min(r.top - 12, 480)), left, w, maxH: Math.min(r.top - 12, 480) });
      else setPos({ top: r.bottom + 4, left, w, maxH: Math.max(160, below) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, width, align]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, anchor]);
  if (!open || !pos) return null;
  // Phones: a bottom sheet within thumb reach, over a scrim, instead of a panel hanging off a small button.
  if (window.matchMedia('(max-width: 767.98px)').matches) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]"
        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-label={label}
          className="w-full max-h-[85dvh] flex flex-col bg-card rounded-t-[16px] shadow-[var(--shadow-overlay)] text-ink font-sans [animation:rise_var(--motion-slow)_var(--ease-out)_both]">
          <div className="flex-none flex items-center justify-between gap-2 pl-4 pr-2 pt-2 pb-1 [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="text-copy font-semibold">{label}</span>
            <button type="button" onClick={onClose} aria-label="Close"
              className="w-10 h-10 grid place-items-center rounded-full border-none bg-transparent text-muted-ink cursor-pointer"><Icon name="X" size="sm" /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div ref={panel} role="dialog" aria-label={label}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.w, maxHeight: pos.maxH, zIndex: 70 }}
      className="overflow-auto bg-card border border-solid border-line rounded-card shadow-[var(--shadow-overlay)] text-ink font-sans">
      {children}
    </div>,
    document.body,
  );
}

/** Toolbar button: icon plus label on a wide screen, icon only on a phone. */
export function ToolButton({ icon, label, onClick, active, btnRef, count, hideLabelOnPhone = true, title }: {
  icon: string; label: string; onClick: () => void; active?: boolean; btnRef?: RefObject<HTMLButtonElement>; count?: number;
  hideLabelOnPhone?: boolean; title?: string;
}) {
  return (
    <button ref={btnRef} type="button" onClick={onClick} aria-label={label} title={title ?? label} aria-expanded={active}
      className={cx('h-9 inline-flex items-center gap-[6px] px-[11px] max-md:px-[9px] rounded-control border border-solid bg-card cursor-pointer font-sans text-copy whitespace-nowrap shrink-0',
        active ? 'border-ink text-ink' : 'border-line text-ink hover:bg-muted')}>
      <Icon name={icon} size="sm" />
      <span className={cx(hideLabelOnPhone && 'max-md:hidden')}>{label}</span>
      {count ? <span className="text-caption font-semibold min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-black text-white tabular-nums">{count}</span> : null}
    </button>
  );
}

/** One row inside a floating panel. */
export function PanelItem({ icon, label, hint, onClick, danger, disabledReason, right, checked }: {
  icon?: string; label: ReactNode; hint?: ReactNode; onClick?: () => void; danger?: boolean; disabledReason?: string; right?: ReactNode; checked?: boolean;
}) {
  const off = !!disabledReason;
  return (
    <button type="button" onClick={off ? undefined : onClick} aria-disabled={off} title={disabledReason}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked}
      className={cx('w-full flex items-start gap-2.5 px-3 py-2 bg-transparent border-none text-left font-sans rounded-[8px]',
        off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted')}>
      {icon && <span className={cx('mt-px', off ? 'text-faint' : danger ? 'text-danger' : 'text-ink-2')}><Icon name={icon} size="sm" /></span>}
      <span className="flex flex-col gap-px min-w-0 flex-1">
        <span className={cx('text-copy font-medium', off ? 'text-faint' : danger ? 'text-danger' : 'text-ink')}>{label}</span>
        {(disabledReason || hint) && <span className="text-meta text-muted-ink">{disabledReason ?? hint}</span>}
      </span>
      {right}
    </button>
  );
}

export const PanelHeading = ({ children }: { children: ReactNode }) => (
  <div className="px-3 pt-2.5 pb-1 text-caption font-semibold uppercase tracking-[0.04em] text-muted-ink">{children}</div>
);

/**
 * Status in a table cell. Stream 1 is building a shared StatusBadge; until it lands every table reads status
 * through this one adapter, so switching over is a change here only.
 */
export function StatusCell({ label, tone, outline }: { label: string; tone: AnyTone; outline?: boolean }) {
  return <StatusBadge label={label} tone={tone} outline={outline} size="sm" dot />;
}

export function ChannelCell({ channel }: { channel: string }) {
  const meta = CHANNEL_META[channel as BookingChannel];
  if (!meta) return <span className="text-copy">{channel || '—'}</span>;
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <ChannelMark ch={channel as BookingChannel} size={18} />
      <span className="text-copy whitespace-nowrap overflow-hidden text-ellipsis">{meta.label}</span>
    </span>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export function PersonCell({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-muted-ink">—</span>;
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span aria-hidden className="w-6 h-6 rounded-full grid place-items-center shrink-0 bg-muted text-muted-ink text-[10px] font-semibold">{initials(name)}</span>
      <span className="text-copy whitespace-nowrap overflow-hidden text-ellipsis" title={name}>{name}</span>
    </span>
  );
}

export const channelLabel = (c: string) => CHANNEL_META[c as BookingChannel]?.label ?? c;
