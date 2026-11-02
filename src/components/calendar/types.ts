import type { BookingChannel, ReservationState } from '../../lib/types';

export interface CalendarUnit { id: string; unitNumber: string; propertyId?: string; propertyName: string; channels?: BookingChannel[];
  /** Booking sites the unit is connected to through Channex; only these get a price sent. */
  linked?: BookingChannel[];
  /** Channex: a live channel, set up but no channel left, still on HostPlatform (bookings come in, prices are not sent), or none. */
  channex?: 'connected' | 'disconnected' | 'hostplatform' | 'none' }

export interface CalendarBlock {
  id: string; unitId: string; channel: BookingChannel; state: ReservationState;
  guestName: string; checkIn: string; checkOut: string; grossBookingValue: number;
  /** The booking site's fee, sen; the bar shows the host payout, gross less this. */
  channelFee?: number; ref: string | null; reason: string | null;
  /** Why dates are held: maintenance, owner_stay or other (blocks made from the calendar since migration 0092). */
  blockReason?: string | null;
  /** Demo mode: a sample reservation, or a real one changed in Demo mode. */
  sample?: 'demo' | 'shadow';
}

/** Shared select styling for the calendar's filter row and modals. */
export const selectCls = 'px-2.5 py-0 font-sans text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer';
