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
export function Floating({ anchor, fallback, open, onClose, width = 260, maxHeight, align = 'left', children, label }: {
  anchor: RefObject<HTMLElement>; open: boolean; onClose: () => void; width?: number; maxHeight?: number; align?: 'left' | 'right';
  /** Where to open when the anchor is hidden (the toolbar folded it into "More table tools"). */
  fallback?: RefObject<HTMLElement>;
  children: ReactNode; label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; w: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current?.offsetParent ? anchor.current : fallback?.current ?? anchor.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 16);
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 12;
      // Opens upwards only when there is clearly more room above (a trigger near the bottom of a phone screen).
      // Pinned by its bottom edge so a short list still sits right above the trigger.
      if (below < 220 && r.top > below + 80) setPos({ bottom: window.innerHeight - r.top + 4, left, w, maxH: Math.min(r.top - 12, maxHeight ?? 480) });
      else setPos({ top: r.bottom + 4, left, w, maxH: Math.min(maxHeight ?? Infinity, Math.max(160, below)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, fallback, width, maxHeight, align]);
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
  return createPortal(
    <div ref={panel} role="dialog" aria-label={label}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.w, maxHeight: pos.maxH, zIndex: 70 }}
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
  // The cell is a flex column that stretches its children; w-fit keeps the pill the width of its words.
  return <StatusBadge label={label} tone={tone} outline={outline} size="sm" dot className="w-fit" />;
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
      <span aria-hidden className="w-6 h-6 rounded-full grid place-items-center shrink-0 bg-muted text-muted-ink text-[11px] leading-none font-semibold">{initials(name)}</span>
      <span className="text-copy whitespace-nowrap overflow-hidden text-ellipsis" title={name}>{name}</span>
    </span>
  );
}

export const channelLabel = (c: string) => CHANNEL_META[c as BookingChannel]?.label ?? c;
