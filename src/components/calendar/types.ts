import type { BookingChannel, ReservationState } from '../../lib/types';

export interface CalendarUnit { id: string; unitNumber: string; propertyName: string; channels?: BookingChannel[] }

export interface CalendarBlock {
  id: string; unitId: string; channel: BookingChannel; state: ReservationState;
  guestName: string; checkIn: string; checkOut: string; grossBookingValue: number; ref: string | null; reason: string | null;
}

/** Shared select styling for the calendar's filter row, drawer and modals. */
export const selectCls = 'px-2.5 py-0 font-sans text-ink bg-card border border-solid border-line rounded-control outline-none cursor-pointer';
