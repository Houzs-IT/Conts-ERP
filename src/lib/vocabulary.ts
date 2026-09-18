import type {
  ReservationState, UnitReadiness, TaskState, BookingChannel,
  StatementState, PayoutState, IntegrationState, SyncState, Tone,
} from './types';

/**
 * The closed status vocabulary from copy.md section 1. One label per state,
 * one tone per state. Never introduce a synonym.
 */

type Entry<T extends string> = Record<T, { label: string; tone: Tone }>;

export const RESERVATION: Entry<ReservationState> = {
  inquiry:     { label: 'Inquiry',     tone: 'neutral' },
  pending:     { label: 'Pending',     tone: 'warning' },
  confirmed:   { label: 'Confirmed',   tone: 'info' },
  checked_in:  { label: 'Checked in',  tone: 'success' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  cancelled:   { label: 'Cancelled',   tone: 'neutral' },
  no_show:     { label: 'No show',     tone: 'critical' },
};

export const READINESS: Entry<UnitReadiness> = {
  occupied:    { label: 'Occupied',    tone: 'info' },
  dirty:       { label: 'Dirty',       tone: 'warning' },
  cleaning:    { label: 'Cleaning',    tone: 'info' },
  inspection:  { label: 'Inspection',  tone: 'warning' },
  ready:       { label: 'Ready',       tone: 'success' },
  maintenance: { label: 'Maintenance', tone: 'critical' },
  blocked:     { label: 'Blocked',     tone: 'neutral' },
};

export const TASK: Entry<TaskState> = {
  open:        { label: 'Open',        tone: 'neutral' },
  assigned:    { label: 'Assigned',    tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  waiting:     { label: 'Waiting',     tone: 'warning' },
  resolved:    { label: 'Resolved',    tone: 'success' },
  overdue:     { label: 'Overdue',     tone: 'critical' },
  reopened:    { label: 'Reopened',    tone: 'critical' },
};

export const STATEMENT: Entry<StatementState> = {
  provisional: { label: 'Provisional', tone: 'neutral' },
  finalised:   { label: 'Finalised',   tone: 'info' },
  sent:        { label: 'Not sent',    tone: 'warning' },
  paid:        { label: 'Paid',        tone: 'success' },
};

export const PAYOUT: Entry<PayoutState> = {
  pending:    { label: 'Pending',    tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  paid:       { label: 'Paid',       tone: 'success' },
  failed:     { label: 'Failed',     tone: 'critical' },
};

export const INTEGRATION: Entry<IntegrationState> = {
  connected: { label: 'Connected', tone: 'success' },
  expired:   { label: 'Expired',   tone: 'critical' },
  degraded:  { label: 'Degraded',  tone: 'warning' },
  failed:    { label: 'Failed',    tone: 'critical' },
};

export const SYNC: Entry<SyncState> = {
  queued: { label: 'Queued',         tone: 'warning' },
  synced: { label: 'Synced',         tone: 'success' },
  failed: { label: 'Failed to sync', tone: 'critical' },
};

/**
 * Channel identity. `border` keeps non-revenue holds readable without colour —
 * brand guide 14.4. Every calendar block also prints its label.
 */
export const CHANNEL: Record<BookingChannel, { label: string; color: string; border: 'solid' | 'dashed' | 'dotted'; tint: string; ink: string }> = {
  airbnb:            { label: 'Airbnb',       color: '#242424', border: 'solid',  tint: '#F1F0ED', ink: '#252525' },
  booking_com:       { label: 'Booking.com',  color: '#2E6DA4', border: 'solid',  tint: '#EAF2FA', ink: '#255C8A' },
  agoda:             { label: 'Agoda',        color: '#6B4E9E', border: 'solid',  tint: '#F1ECF8', ink: '#54397F' },
  direct:            { label: 'Direct',       color: '#16845B', border: 'solid',  tint: '#E9F5EF', ink: '#11694A' },
  maintenance_block: { label: 'Block',        color: '#C2413B', border: 'dashed', tint: '#FCECEB', ink: '#A8352F' },
  owner_stay:        { label: 'Owner stay',   color: '#706D67', border: 'dotted', tint: '#FAF9F6', ink: '#706D67' },
};

/** Tone → the three token roles. -fg is the only one legal for text. */
export const TONE: Record<Tone, { bg: string; fg: string; line: string }> = {
  success:  { bg: 'var(--color-success)',  fg: 'var(--color-success-fg)',  line: 'var(--color-success-line)' },
  warning:  { bg: 'var(--color-warning)',  fg: 'var(--color-warning-fg)',  line: 'var(--color-warning-line)' },
  critical: { bg: 'var(--color-critical)', fg: 'var(--color-critical-fg)', line: 'var(--color-critical-line)' },
  info:     { bg: 'var(--color-info)',     fg: 'var(--color-info-fg)',     line: 'var(--color-info-line)' },
  neutral:  { bg: 'var(--color-neutral)',  fg: 'var(--color-neutral-fg)',  line: 'var(--color-neutral-line)' },
};
