import type { BookingChannel, ReservationState } from '../../lib/types';

export interface CalendarUnit { id: string; unitNumber: string; propertyId?: string; propertyName: string; channels?: BookingChannel[];
  /** Booking sites the unit is connected to through Channex; only these get a price sent. */
  linked?: BookingChannel[] }

export interface CalendarBlock {
  id: string; unitId: string; channel: BookingChannel; state: ReservationState;
  guestName: string; checkIn: string; checkOut: string; grossBookingValue: number; ref: string | null; reason: string | null;
}

/** Shared select styling for the calendar's filter row and modals. */
export const selectCls = 'px-2.5 py-0 font-sans text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer';
