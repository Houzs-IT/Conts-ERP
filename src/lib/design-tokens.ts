/**
 * Central design tokens as Tailwind class strings — the single source for
 * semantic colour, mirroring the ERPs' `src/lib/design-tokens.ts` convention
 * (Hookka / Houzs). Values match `tokens.css` / `theme.ts`, so pages converted
 * to Tailwind stay 1:1 with the design. Never hard-code status shades in a page;
 * route them through here.
 */
import type { Tone, BookingChannel } from './types';

export interface SemanticStyle { text: string; bg: string; border: string; dot: string; hex: string }

export const TONE: Record<Tone, SemanticStyle> = {
  success:  { text: 'text-success',    bg: 'bg-success-bg',  border: 'border-success',  dot: 'bg-success',  hex: '#11694A' },
  warning:  { text: 'text-warning',    bg: 'bg-warning-bg',  border: 'border-warning',  dot: 'bg-warning',  hex: '#8A5A12' },
  critical: { text: 'text-critical',   bg: 'bg-critical-bg', border: 'border-critical', dot: 'bg-critical', hex: '#A8352F' },
  info:     { text: 'text-info',       bg: 'bg-info-bg',     border: 'border-info',     dot: 'bg-info',     hex: '#2E6DA4' },
  neutral:  { text: 'text-muted-ink',  bg: 'bg-muted',       border: 'border-line',     dot: 'bg-line-strong', hex: '#706D67' },
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
