/**
 * Central design tokens as Tailwind class strings — the single source for
 * semantic colour, mirroring the ERPs' `src/lib/design-tokens.ts` convention
 * (Hookka / Houzs). Values match `tokens.css` / `theme.ts`, so pages converted
 * to Tailwind stay 1:1 with the design. Never hard-code status shades in a page;
 * route them through here.
 */
import type { Tone, BookingChannel } from './types';

export interface SemanticStyle { text: string; bg: string; border: string; dot: string; hex: string }

/** These reference the root tokens.css vars directly (var(--color-*-fg/-line/base)).
 *  The base names (--color-critical etc. = the tint) are defined UNLAYERED in the
 *  imported tokens.css and win over Tailwind's @theme layer, so plain `text-critical`
 *  utilities resolve to the tint, not the foreground — hence the explicit -fg refs.
 *  bg = base tint, text = -fg (AA on the tint), border/dot = -line. */
export const TONE: Record<Tone, SemanticStyle> = {
  success:  { text: 'text-[var(--color-success-fg)]',  bg: 'bg-[var(--color-success)]',  border: 'border-[var(--color-success-line)]',  dot: 'bg-[var(--color-success-line)]',  hex: '#11694A' },
  warning:  { text: 'text-[var(--color-warning-fg)]',  bg: 'bg-[var(--color-warning)]',  border: 'border-[var(--color-warning-line)]',  dot: 'bg-[var(--color-warning-line)]',  hex: '#8A5A12' },
  critical: { text: 'text-[var(--color-critical-fg)]', bg: 'bg-[var(--color-critical)]', border: 'border-[var(--color-critical-line)]', dot: 'bg-[var(--color-critical-line)]', hex: '#A8352F' },
  info:     { text: 'text-[var(--color-info-fg)]',     bg: 'bg-[var(--color-info)]',     border: 'border-[var(--color-info-line)]',     dot: 'bg-[var(--color-info-line)]',     hex: '#2E6DA4' },
  neutral:  { text: 'text-[var(--color-neutral-fg)]',  bg: 'bg-[var(--color-neutral)]',  border: 'border-[var(--color-neutral-line)]',  dot: 'bg-[var(--color-neutral-line)]',  hex: '#706D67' },
};

export const CHANNEL_META: Record<BookingChannel, { label: string; hex: string; tint: string; ink: string }> = {
  airbnb:            { label: 'Airbnb',      hex: '#FF5A5F', tint: '#FFF0F0', ink: '#B3383C' },
  booking_com:       { label: 'Booking.com', hex: '#003B95', tint: '#EAF0FA', ink: '#003B95' },
  agoda:             { label: 'Agoda',       hex: '#5C2D91', tint: '#F2ECF9', ink: '#4A2475' },
  direct:            { label: 'Direct',      hex: '#C8A46A', tint: '#FBF7F0', ink: '#8A6A2F' },
  maintenance_block: { label: 'Block',       hex: '#C2413B', tint: '#FCECEB', ink: '#A8352F' },
  owner_stay:        { label: 'Owner stay',  hex: '#706D67', tint: '#FAF9F6', ink: '#5C5952' },
};

/** clsx-lite: join truthy class parts. */
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');
