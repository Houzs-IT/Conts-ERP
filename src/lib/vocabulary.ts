import type {
  ReservationState, UnitReadiness, TaskState, BookingChannel,
  StatementState, PayoutState, IntegrationState, SyncState, Tone,
} from './types';
import { statusOptions, statusLabel, type StatusEntity } from './status';

/**
 * Status words and colours come from src/lib/status.ts (the one vocabulary); these older names read from it so
 * every screen agrees. New code uses <StatusBadge entity value /> or statusLabel() directly.
 */
type Entry<T extends string> = Record<T, { label: string; tone: Tone }>;
const legacy = <T extends string>(entity: StatusEntity) => Object.fromEntries(statusOptions(entity)
  .map(o => [o.value, { label: o.label, tone: o.tone === 'danger' ? 'critical' : o.tone === 'accent' ? 'neutral' : o.tone }])) as Entry<T>;

export const RESERVATION = legacy<ReservationState>('booking');
export const READINESS = legacy<UnitReadiness>('readiness');
export const TASK = legacy<TaskState>('task');
export const STATEMENT = legacy<StatementState>('statement');
export const PAYOUT = legacy<PayoutState>('payout');
export const INTEGRATION = legacy<IntegrationState>('integration');
export const SYNC = legacy<SyncState>('sync');

/**
 * Channel identity. `border` keeps non-revenue holds readable without colour —
 * brand guide 14.4. Every calendar block also prints its label.
 */
export const CHANNEL: Record<BookingChannel, { label: string; color: string; border: 'solid' | 'dashed' | 'dotted'; tint: string; ink: string }> = {
  // The design's real platform colours (Desktop design, calendar), so a block's source reads before its name.
  // Direct is gold on purpose: it is The Conts' own channel. ink is AA on tint for every channel.
  airbnb:            { label: 'Airbnb',       color: '#FF5A5F', border: 'solid',  tint: '#FFF0F0', ink: '#B3383C' },
  booking_com:       { label: 'Booking.com',  color: '#003B95', border: 'solid',  tint: '#EAF0FA', ink: '#003B95' },
  agoda:             { label: 'Agoda',        color: '#5C2D91', border: 'solid',  tint: '#F2ECF9', ink: '#4A2475' },
  direct:            { label: 'Direct',       color: '#C8A46A', border: 'solid',  tint: '#FBF7F0', ink: '#8A6A2F' },
  maintenance_block: { label: 'Repair',       color: '#C2413B', border: 'dashed', tint: '#FCECEB', ink: '#A8352F' },
  owner_stay:        { label: 'Owner stay',   color: '#706D67', border: 'dotted', tint: '#FAF9F6', ink: '#5C5952' },
};

/** Tone → the three token roles. -fg is the only one legal for text. */
export const TONE: Record<Tone, { bg: string; fg: string; line: string }> = {
  success:  { bg: 'var(--color-success)',  fg: 'var(--color-success-fg)',  line: 'var(--color-success-line)' },
  warning:  { bg: 'var(--color-warning)',  fg: 'var(--color-warning-fg)',  line: 'var(--color-warning-line)' },
  critical: { bg: 'var(--color-critical)', fg: 'var(--color-critical-fg)', line: 'var(--color-critical-line)' },
  info:     { bg: 'var(--color-info)',     fg: 'var(--color-info-fg)',     line: 'var(--color-info-line)' },
  neutral:  { bg: 'var(--color-neutral)',  fg: 'var(--color-neutral-fg)',  line: 'var(--color-neutral-line)' },
};

/** Role names as people read them. Never print the raw code ("operations_staff"). */
/** The hidden role, for the few places that still name one (the field app header, an old audit row). A role no longer
 *  tells what an office person does: that is their department and position, see `jobTitle`. */
export const ROLE_LABEL: Record<string, string> = {
  management: 'Management', operations_staff: 'Office staff',
  housekeeper: 'Cleaner', technician: 'Maintenance technician', owner: 'Owner',
};

/** What to print under a person's name: their department for office accounts, the field or owner label otherwise. */
export const jobTitle = (u: { role: string; department?: string | null }): string => {
  if (u.role === 'housekeeper' || u.role === 'technician' || u.role === 'owner') return ROLE_LABEL[u.role];
  return u.department?.trim() || ROLE_LABEL[u.role] || u.role;
};

/** Malaysian bank codes as imported (SWIFT-style) -> the name people know. Unknown codes print as given. */
export const BANK_NAME: Record<string, string> = {
  MBBB: 'Maybank', MBBE: 'Maybank', MBBEMYKL: 'Maybank', PBBB: 'Public Bank', PBBE: 'Public Bank', CIBB: 'CIMB', CIBBMYKL: 'CIMB',
  HLBB: 'Hong Leong Bank', RHBB: 'RHB', AMBB: 'AmBank', BIMB: 'Bank Islam', BKRM: 'Bank Rakyat', BSNA: 'BSN',
  OCBC: 'OCBC', UOVB: 'UOB', HSBC: 'HSBC', SCBL: 'Standard Chartered', AFBQ: 'Affin Bank', ALSR: 'Alliance Bank',
  AGOB: 'Agrobank', MFBB: 'Alliance Bank', CTBB: 'Citibank', BMMB: 'Bank Muamalat', RJHI: 'Al Rajhi',
};
export const bankName = (code: string | null | undefined) => {
  if (!code) return null;
  const k = code.trim().toUpperCase();
  return BANK_NAME[k] ?? BANK_NAME[k.slice(0, 4)] ?? code;
};

/** One state label per status the search and lists show, so nothing prints a raw lower-case code. */
export const stateLabel = (domain: 'reservation' | 'readiness' | 'task', state: string) =>
  statusLabel(domain === 'reservation' ? 'booking' : domain, state);
