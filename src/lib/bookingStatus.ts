import type { ReservationState, Tone } from './types';

/** One label and one look per booking status, shared by the Bookings list, the booking drawer and the Calendar. */
export const STATUS: Record<ReservationState, { label: string; tone: Tone; outline?: boolean }> = {
  inquiry: { label: 'Inquiry', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  checked_in: { label: 'Checked in', tone: 'success' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'critical', outline: true },
  no_show: { label: 'No show', tone: 'warning', outline: true },
};

/** What the server did on the booking sites, as returned in `effects.channel`. */
export type ChannelSync = 'queued' | 'not_linked' | 'failed' | null | undefined;

/** One honest sentence about the booking sites after a change. Never claims an update that was not queued. */
export function channelNote(c: ChannelSync, what: 'released' | 'held' | 'moved'): string {
  if (c === 'queued') return what === 'released' ? 'The dates were queued to reopen on the booking sites.' : what === 'held' ? 'The dates were queued to close on the booking sites.' : 'The new dates were queued for the booking sites.';
  if (c === 'not_linked') return 'This unit is not linked to Channex, so no booking site was updated.';
  if (c === 'failed') return 'The booking sites could not be updated. See System health.';
  return '';
}

/** What a message send really did (POST /messages answers sent / queued / failed / not_linked). */
export function deliveryToast(delivery: string | undefined, name: string, reason?: string): { tone: Tone; title: string; body?: string } {
  if (delivery === 'sent') return { tone: 'success', title: `Message sent to ${name}.` };
  if (delivery === 'failed') return { tone: 'critical', title: 'Message saved, but it was not delivered.', body: reason ?? 'The channel refused it. Try again from the Inbox.' };
  return { tone: 'warning', title: 'Message saved, not delivered yet.', body: reason ?? 'The channel for this guest is not connected, so it waits in the Inbox.' };
}
