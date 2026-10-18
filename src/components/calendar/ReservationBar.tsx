import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import ChannelMark from '../ChannelMark';
import { CHANNEL } from '../../lib/vocabulary';
import { dateRange, nights as nightsLabel, rm } from '../../lib/format';
import type { CalendarBlock as Block } from './types';
import { stayPhase } from '../../lib/bookingStatus';

/*
 * What a reservation bar on the Calendar says, by how much room it has. Borrowed from Airbnb's multi-calendar
 * (status shading: who is in now reads darker than who is coming, past stays fade), Hostaway (a thin channel colour
 * on the bar's edge rather than a full channel fill) and Guesty (the name never cut mid-word; the full detail lives
 * in a hover card). Rules, by nights visible in the window:
 *   1 night   channel mark over the first name, or initials when the first name does not fit
 *   2 nights  first name, and "2 nights" under it
 *   3-5       the full name (whole words that fit), price under it
 *   6+        the full name, price and nights under it
 * Blocked nights and owner stays are hatched so they never read as a guest.
 */

export type StayPhase = 'upcoming' | 'arriving' | 'hosting' | 'checking_out' | 'past' | 'inquiry' | 'hold';

/** Airbnb's status words (docs/VOCABULARY.md): stored state plus the date-based Arriving soon / Checking out. */
export const PHASE_LABEL: Record<StayPhase, string> = {
  upcoming: 'Upcoming', arriving: 'Arriving soon', hosting: 'Currently hosting', checking_out: 'Checking out', past: 'Past',
  inquiry: 'Inquiry, not holding the nights', hold: 'Blocked',
};

export function phaseOf(b: Block, today: string): StayPhase {
  if (b.channel === 'maintenance_block' || b.channel === 'owner_stay') return 'hold';
  if (b.state === 'inquiry') return 'inquiry';
  // The same rule as the lists and the reservation drawer (lib/bookingStatus stayPhase).
  const p = stayPhase(b.state === 'pending' ? { ...b, state: 'confirmed' } : b, today);
  return p === 'upcoming' || p === 'arriving' || p === 'hosting' || p === 'checking_out' || p === 'past' ? p : 'upcoming';
}

/** What a hold is called on the board: Owner stay, Repair or Blocked (vocabulary: the reason sits next to "Blocked"). */
export function holdName(b: Block) {
  if (b.channel === 'owner_stay') return 'Owner stay';
  if (b.blockReason === 'maintenance' || (!b.blockReason && b.channel === 'maintenance_block')) return 'Repair';
  return 'Blocked';
}

/** Rough width of a string in px at the bar's 12px type: CJK and other wide scripts take about twice a Latin letter. */
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 12.5 : /[A-Z]/.test(c) ? 8 : 6.6), 0);

/** Whole words of the name that fit in `px`; null if not even the first word fits. */
export function fitWords(name: string, px: number): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (textWidth(next) > px) break;
    out = next;
  }
  return out || null;
}
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  // A CJK name reads by its first character; Latin names by first and last initials.
  if (/[\u2E80-\uA4CF\uAC00-\uD7A3]/.test(words[0][0])) return words[0][0];
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
};

export function displayName(b: Block) {
  if (b.channel === 'owner_stay' || b.channel === 'maintenance_block') return b.guestName && b.channel === 'owner_stay' ? b.guestName : holdName(b);
  return b.guestName || `${CHANNEL[b.channel].label} guest`;
}

/** The inside of a bar: what to say for this width. `visible` is the nights in the window, `width` the bar in px. */
export function BarContent({ b, visible, width, nights }: { b: Block; visible: number; width: number; nights: number }) {
  const hold = b.channel === 'owner_stay' || b.channel === 'maintenance_block';
  const name = displayName(b);
  const price = !hold && b.grossBookingValue > 0 ? rm(b.grossBookingValue, { cents: false }) : '';
  const markW = width >= 30 ? 20 : 0;
  const room = width - 12 - markW;
  if (visible <= 1 || width < 70) {
    const first = hold ? (b.channel === 'owner_stay' ? 'Owner' : holdName(b)) : (fitWords(name.split(/\s+/)[0] ?? '', width - 10) ?? initials(name));
    return (
      <span className="min-w-0 flex flex-col items-start justify-center gap-[3px]">
        {width >= 30 && <ChannelMark ch={b.channel} size={14} />}
        <span className="text-caption leading-[13px] font-semibold whitespace-nowrap overflow-hidden max-w-full">{first}</span>
      </span>
    );
  }
  const line1 = visible <= 2 && !hold ? (fitWords(name.split(/\s+/)[0] ?? '', room) ?? initials(name)) : (fitWords(name, room) ?? initials(name));
  const parts = hold
    ? [visible >= 3 && b.reason ? b.reason : '', visible >= 3 ? nightsLabel(nights) : ''].filter(Boolean)
    : visible <= 2 ? [nightsLabel(nights)] : visible <= 5 ? [price || nightsLabel(nights)] : [price, nightsLabel(nights)].filter(Boolean);
  const line2 = fitWords(parts.join(' · '), room) ?? (parts[0] && textWidth(parts[0]) <= room ? parts[0] : '');
  return (
    <>
      <ChannelMark ch={b.channel} size={16} />
      <span className="min-w-0 flex flex-col">
        <span className="text-meta leading-[15px] font-semibold whitespace-nowrap overflow-hidden">{line1}</span>
        {line2 && <span className="text-caption leading-[14px] whitespace-nowrap overflow-hidden opacity-80 [font-variant-numeric:tabular-nums]">{line2}</span>}
      </span>
    </>
  );
}

/** The bar's look: a quiet card with the channel colour as a 3px left edge; status sets the shade. */
export function barStyle(b: Block, phase: StayPhase, clipL: boolean, clipR: boolean): CSSProperties {
  const ch = CHANNEL[b.channel];
  const r = (on: boolean) => (on ? 0 : 6);
  const radius = `${r(clipL)}px ${r(clipR)}px ${r(clipR)}px ${r(clipL)}px`;
  if (phase === 'inquiry') return { color: 'var(--color-text-muted)', background: 'transparent', border: '1px dashed var(--color-line-strong)', borderRadius: radius };
  if (phase === 'hold') {
    const stripe = b.channel === 'owner_stay' ? 'var(--color-line)' : `color-mix(in srgb, ${ch.color} 22%, var(--color-surface-card))`;
    return {
      color: ch.ink, borderRadius: radius,
      background: `repeating-linear-gradient(135deg, ${stripe} 0 2px, var(--color-surface-card) 2px 8px)`,
      border: `1px ${ch.border} color-mix(in srgb, ${ch.color} 45%, transparent)`,
    };
  }
  const edge = clipL ? undefined : `3px solid ${ch.color}`;
  if (phase === 'hosting' || phase === 'checking_out') {
    return { color: 'var(--color-text-primary)', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-line-strong)', borderLeft: edge, borderRadius: radius };
  }
  if (phase === 'past') {
    return { color: 'var(--color-text-muted)', background: 'var(--color-surface-page)', border: '1px solid var(--color-line)', borderLeft: clipL ? undefined : `3px solid color-mix(in srgb, ${ch.color} 45%, transparent)`, borderRadius: radius };
  }
  return { color: 'var(--color-text-primary)', background: 'var(--color-surface-card)', border: '1px solid var(--color-line-strong)', borderLeft: edge, borderRadius: radius };
}

/** The full detail of a bar, shown by the pointer on hover (desktop). */
export function BarHoverCard({ b, phase, unit, x, y }: { b: Block; phase: StayPhase; unit: string; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 16 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(x + 12, window.innerWidth - r.width - 12);
    const top = y + 16 + r.height > window.innerHeight - 12 ? y - r.height - 12 : y + 16;
    setPos({ left: Math.max(12, left), top: Math.max(12, top) });
  }, [x, y]);
  const ch = CHANNEL[b.channel];
  const n = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 864e5);
  const hold = phase === 'hold';
  return (
    <div ref={ref} role="tooltip" className="fixed z-[70] w-[260px] bg-card rounded-card border border-solid border-line shadow-[var(--shadow-overlay)] p-3 pointer-events-none flex flex-col gap-1.5 text-copy" style={pos}>
      <div className="flex items-center gap-2 min-w-0">
        <ChannelMark ch={b.channel} size={18} />
        <b className="min-w-0 [overflow-wrap:anywhere]">{displayName(b)}</b>
      </div>
      <div className="text-meta text-muted-ink">{hold ? holdName(b) : ch.label} · {PHASE_LABEL[phase]}</div>
      <div className="[font-variant-numeric:tabular-nums]">{dateRange(b.checkIn, b.checkOut)} · {nightsLabel(n)}</div>
      {!hold && b.grossBookingValue > 0 && <div className="[font-variant-numeric:tabular-nums]">{rm(b.grossBookingValue, { cents: false })}</div>}
      {b.reason && <div className="text-meta text-muted-ink">{b.reason}</div>}
      <div className="text-meta text-muted-ink">{unit}{b.ref ? ` · ${b.ref}` : ''}</div>
    </div>
  );
}
