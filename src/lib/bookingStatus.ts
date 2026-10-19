import type { ReservationState, Tone } from './types';
import { statusOptions } from './status';
import { CHANNEL } from './vocabulary';

/** One label and one look per booking status, from src/lib/status.ts (shared by Bookings, the drawer and Calendar). */
export const STATUS = Object.fromEntries(statusOptions('booking').map(o => [o.value, { label: o.label, tone: (o.tone === 'danger' ? 'critical' : o.tone === 'accent' ? 'neutral' : o.tone) as Tone, outline: o.outline }])) as Record<ReservationState, { label: string; tone: Tone; outline?: boolean }>;

export { stayPhase, STAY_LABEL, type StayPhase } from './stayPhase';

/**
 * Who a row is for, never a bare dash: an owner stay or a block says so ("Owner stay", "Blocked: repair"), a guest
 * reservation without a name reads like the calendar bar ("Airbnb guest") with `missing` set so the row can add
 * "No guest name".
 */
export function stayWho(r: { channel: string; guestName?: string | null; blockReason?: string | null }): { name: string; missing: boolean; hold: boolean } {
  if (r.channel === 'owner_stay') return { name: r.guestName ? `Owner stay: ${r.guestName}` : 'Owner stay', missing: false, hold: true };
  if (r.channel === 'maintenance_block') return { name: !r.blockReason || r.blockReason === 'maintenance' ? 'Blocked: repair' : 'Blocked', missing: false, hold: true };
  if (r.guestName) return { name: r.guestName, missing: false, hold: false };
  const label = CHANNEL[r.channel as keyof typeof CHANNEL]?.label ?? 'Channel';
  return { name: `${label} guest`, missing: true, hold: false };
}

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
