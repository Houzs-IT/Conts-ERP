/** Mirrors the enums in schema.sql. Do not add synonyms — see copy.md section 1. */

export type ReservationState =
  | 'inquiry' | 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

export type UnitReadiness =
  | 'occupied' | 'dirty' | 'cleaning' | 'inspection' | 'ready' | 'maintenance' | 'blocked';

export type TaskState =
  | 'open' | 'assigned' | 'in_progress' | 'waiting' | 'resolved' | 'overdue' | 'reopened';

export type BookingChannel =
  | 'airbnb' | 'booking_com' | 'agoda' | 'direct' | 'maintenance_block' | 'owner_stay';

export type StatementState = 'provisional' | 'finalised' | 'sent' | 'paid';
export type PayoutState = 'pending' | 'processing' | 'paid' | 'failed';
export type IntegrationState = 'connected' | 'expired' | 'degraded' | 'failed';
export type SyncState = 'queued' | 'synced' | 'failed';

export type UserRole =
  | 'management' | 'operations_manager' | 'operations_staff'
  | 'finance_admin' | 'housekeeper' | 'technician' | 'owner';

/** The five semantic tones. Gold is never a tone — see tokens.json. */
export type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  locale: string;
  permissions: string[];
  /** Each area's level for this person's role (Users and roles > Permissions). Absent on an older session. */
  access?: Record<string, AccessLevel>;
  /** Management requires two-step sign-in for this role and it is not set up yet: only My account opens until it is. */
  twoStepSetupRequired?: boolean;
  /** EMP-001: signs in with this employee ID and a PIN (a cleaner or technician given app access), so new secrets are 6-digit PINs. */
  employeeId?: string | null;
}

export type AccessLevel = 'none' | 'view' | 'edit' | 'full';

export interface Money {
  /** Integer sen. RM 12,450.00 === 1245000. Never a float. */
  amount: number;
  currency: 'MYR';
}

export interface Unit {
  id: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  ownerId: string;
  ownerName: string;
  readiness: UnitReadiness;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  baseRate: number;
  isListed: boolean;
  channels: BookingChannel[];
}

export interface Reservation {
  id: string;
  ref: string;
  externalRef: string | null;
  unitId: string;
  unitNumber: string;
  propertyName: string;
  guestId: string | null;
  guestName: string;
  guestPhone: string | null;
  channel: BookingChannel;
  state: ReservationState;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  nights: number;
  guestsCount: number;
  grossBookingValue: number;
  collectedRevenue: number;
  receivedAt: string;
  reason?: string;
}

export interface Task {
  id: string;
  unitId: string;
  unitNumber: string;
  propertyName: string;
  kind: 'turnover' | 'deep_clean' | 'light_clean' | 'inspection' | 'maintenance' | 'delivery' | 'other';
  state: TaskState;
  title: string;
  instructions: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  scheduledFor: string | null;
  dueAt: string | null;
  nextGuestAt: string | null;
  requiresPhoto: boolean;
  photoCount: number;
  sequence: number;
  sync: SyncState;
  /** Server-computed. Never recalculate from the client clock. */
  sla: { state: 'on_track' | 'due' | 'overdue' | 'escalated' | 'none'; minutes: number; label: string; tone: Tone };
  riskRank: number;
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface Paged<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  generatedAt: string;
  filtersApplied?: Record<string, string>;
  partial?: boolean;
  failed?: string[];
}
