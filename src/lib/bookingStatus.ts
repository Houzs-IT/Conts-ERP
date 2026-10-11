import type { ReservationState, Tone } from './types';
import { statusOptions } from './status';

/** One label and one look per booking status, from src/lib/status.ts (shared by Bookings, the drawer and Calendar). */
export const STATUS = Object.fromEntries(statusOptions('booking').map(o => [o.value, { label: o.label, tone: (o.tone === 'danger' ? 'critical' : o.tone === 'accent' ? 'neutral' : o.tone) as Tone, outline: o.outline }])) as Record<ReservationState, { label: string; tone: Tone; outline?: boolean }>;

/** What the server did on the booking sites, as returned in `effects.channel`. */
export type ChannelSync = 'queued' | 'not_linked' | 'failed' | null | undefined;

/** One honest sentence about the booking sites after a change. Never claims an update that was not queued. */
export function channelNote(c: ChannelSync, what: 'released' | 'held' | 'moved'): string {
  if (c === 'queued') return what === 'released' ? 'The dates are waiting to send: they reopen on the channels shortly.' : what === 'held' ? 'The dates are waiting to send: they close on the channels shortly.' : 'The new dates are waiting to send to the channels.';
  if (c === 'not_linked') return 'This unit is not linked to any channel, so no channel was updated.';
  if (c === 'failed') return 'The channels were not updated. See System health.';
  return '';
}

/** What a message send really did (POST /messages answers sent / queued / failed / not_linked). */
export function deliveryToast(delivery: string | undefined, name: string, reason?: string): { tone: Tone; title: string; body?: string } {
  if (delivery === 'sent') return { tone: 'success', title: `Message sent to ${name}.` };
  if (delivery === 'failed') return { tone: 'critical', title: 'Message saved, but it was not delivered.', body: reason ?? 'The channel refused it. Try again from Messages.' };
  return { tone: 'warning', title: 'Message saved, not delivered yet.', body: reason ?? 'The channel for this guest is not connected, so it waits in Messages.' };
}
