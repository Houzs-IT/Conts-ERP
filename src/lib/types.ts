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

/** The hidden role the server works out from the department's kind (management, staff, cleaning, maintenance), plus owner.
 *  No screen shows or picks it. The two older office roles (operations manager and finance admin) are retired: what set them apart now lives in
 *  the position and department rules. */
export type UserRole = 'management' | 'operations_staff' | 'housekeeper' | 'technician' | 'owner';

/** Which side of the business an account works on (migration 0143): The Conts is rental, Dream Crafter the supply chain. */
export type UserSide = 'conts' | 'dream_crafter' | 'both';

/** The five semantic tones. Gold is never a tone — see tokens.json. */
export type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  /** Absent on an older session, which reads as both. */
  side?: UserSide;
  /** Where the account sits (the managed list under Permissions). Absent on an owner and on an older session. */
  departmentId?: string | null;
  department?: string | null;
  positionId?: string | null;
  /** The department's kind, which decides the hidden role. */
  kind?: DepartmentKind | null;
  mustChangePassword: boolean;
  locale: string;
  permissions: string[];
  /** Each area's level for this person: their own settings, then position, then department (Users and roles > Permissions). Absent on an older session. */
  access?: Record<string, AccessLevel>;
  /** Management requires two-step sign-in for this role and it is not set up yet: only My account opens until it is. */
  twoStepSetupRequired?: boolean;
  /** EMP-001: signs in with this employee ID and a PIN (a cleaner or technician given app access), so new secrets are 6-digit PINs. */
  employeeId?: string | null;
}

export type AccessLevel = 'none' | 'view' | 'edit' | 'full';
/** A module's own setting on the Permissions chart: 'inherit' follows its category's baseline. */
export type AccessSetting = 'inherit' | AccessLevel;

/* ----------------------- departments, positions and rules ----------------------- */
// Shapes of the API contract in PLAN.md (/api/departments, /api/users/access, /api/users/:id/access).

/** What a department is for: decides the hidden role. Management is always Full, cleaning and maintenance use the field app only. */
export type DepartmentKind = 'management' | 'staff' | 'cleaning' | 'maintenance';

export interface Position { id: string; name: string; sort: number; headCount: number }

export interface Department {
  id: string; name: string; kind: DepartmentKind; side: UserSide; sort: number; headCount: number;
  positions: Position[];
}

export interface DepartmentsPayload { departments: Department[]; canEdit: boolean }

/** Where a person's level in an area comes from. 'fixed' is management / field app, 'none' is nothing set anywhere. */
export type AccessOrigin = 'user' | 'position' | 'department' | 'fixed' | 'none';
/** The origins a default can have: a person's own override is never part of the default. */
export type InheritedOrigin = 'position' | 'department' | 'none';

export interface AccessArea { key: string; label: string; managed: boolean }
export interface AccessCategory { group: string; areas: AccessArea[] }

/** Stored rows only. A missing key means inherit (area) or not set (category); category keys are `group:<Category>`. */
export interface AccessRules {
  department: Record<string, Record<string, AccessSetting>>;
  position: Record<string, Record<string, AccessSetting>>;
}

export interface AccessChart {
  levels: AccessLevel[]; categories: AccessCategory[]; departments: Department[]; rules: AccessRules; canEdit: boolean;
}

/** `level: null` deletes the stored row. Category keys take a level or null, never 'inherit'. */
export interface AccessChange { scope: 'department' | 'position'; scopeId: string; key: string; level: AccessSetting | null }

export interface PersonAccessArea {
  key: string; label: string; group: string; level: AccessLevel; origin: AccessOrigin;
  /** The person's own override, or null when they follow their position / department. */
  override: AccessLevel | null;
  /** What they get with no override: what "Inherit (position default)" goes back to. */
  inherited: { level: AccessLevel; origin: InheritedOrigin };
}

export interface PersonAccess {
  user: {
    id: string; fullName: string; departmentId: string | null; departmentName: string | null;
    positionId: string | null; positionName: string | null; kind: DepartmentKind; side: UserSide;
  };
  areas: PersonAccessArea[];
  canEdit: boolean;
}

/** `level: null` resets that area to the position default. */
export interface PersonAccessChange { area: string; level: AccessLevel | null }

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

/** An extra bank account on an owner (GET /api/owners/:id/accounts). Only the last four digits ever come with the list;
 *  `inUse` is how many units pay to it. */
export interface OwnerBankAccount {
  id: string; label: string | null; bankName: string; accountHolder: string; last4: string; inUse: number;
}
/** The body to add or change an extra account. On a change, an empty `accountNumber` keeps the stored one. */
export interface OwnerBankAccountInput {
  label?: string; bankName?: string; accountNumber?: string; accountHolder?: string;
}
