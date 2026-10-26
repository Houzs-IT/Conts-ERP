/**
 * The one status vocabulary. Every status pill and status menu in the app reads its words and colour from here,
 * through <StatusBadge entity value /> and <StatusMenu />. Stored values never change; only what people read does.
 * A value missing from its map still renders as words (humanised), never as a raw code like `checked_in`.
 */

/** Meaning-based tones. `danger` is the red one; `accent` is the gold identity mark, never a warning. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

/** Older names still passed by some callers: `critical` is danger, `gold` is accent. */
export type AnyTone = StatusTone | 'critical' | 'gold';
export const normTone = (t: AnyTone): StatusTone => (t === 'critical' ? 'danger' : t === 'gold' ? 'accent' : t);

export interface StatusEntry { label: string; tone: StatusTone; outline?: boolean }
type Vocab = Record<string, StatusEntry>;

const ACTIVE_INACTIVE: Vocab = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'danger' },
};

const BOOKING = {
  inquiry: { label: 'Inquiry', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Upcoming', tone: 'info' },
  checked_in: { label: 'Currently hosting', tone: 'success' },
  checked_out: { label: 'Past', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger', outline: true },
  no_show: { label: 'No-show', tone: 'warning', outline: true },
} satisfies Vocab;

export const STATUS_VOCAB = {
  /* ---------- Rental side ---------- */
  booking: BOOKING,
  /** A reservation as people read it: the stored state worked out against today's date (lib/bookingStatus stayPhase,
   *  the same rule as the calendar and functions/api/units/stays.ts). Lists, the drawer and the calendar all show this. */
  stay: {
    upcoming: BOOKING.confirmed,
    arriving: { label: 'Arriving soon', tone: 'info' },
    hosting: BOOKING.checked_in,
    checking_out: { label: 'Checking out', tone: 'warning' },
    past: BOOKING.checked_out,
    cancelled: BOOKING.cancelled,
    no_show: BOOKING.no_show,
    inquiry: BOOKING.inquiry,
    pending: BOOKING.pending,
  },
  /** The calendar's status filter: the live booking states plus maintenance blocks, which have no booking state. */
  calendar: {
    confirmed: BOOKING.confirmed, checked_in: BOOKING.checked_in, checked_out: BOOKING.checked_out, pending: BOOKING.pending,
    blocked: { label: 'Blocked', tone: 'danger' },
  },
  readiness: {
    occupied: { label: 'Occupied', tone: 'info' },
    dirty: { label: 'Dirty', tone: 'warning' },
    cleaning: { label: 'Cleaning', tone: 'info' },
    inspection: { label: 'Inspection', tone: 'warning' },
    ready: { label: 'Ready', tone: 'success' },
    maintenance: { label: 'Maintenance', tone: 'danger' },
    blocked: { label: 'Blocked', tone: 'neutral' },
  },
  task: {
    open: { label: 'Open', tone: 'neutral' },
    assigned: { label: 'Assigned', tone: 'info' },
    in_progress: { label: 'In progress', tone: 'info' },
    waiting: { label: 'Waiting', tone: 'warning' },
    resolved: { label: 'Resolved', tone: 'success' },
    overdue: { label: 'Overdue', tone: 'danger' },
    reopened: { label: 'Reopened', tone: 'danger' },
  },
  /** A repair job as the Maintenance screen reads it (derived from task state, approval and vendor). */
  maintenance: {
    new: { label: 'New', tone: 'neutral' },
    assigned: { label: 'Assigned', tone: 'neutral' },
    awaiting_owner: { label: 'Awaiting owner approval', tone: 'warning' },
    in_progress: { label: 'In progress', tone: 'info' },
    repair_finished: { label: 'Repair finished', tone: 'info' },
    done: { label: 'Done', tone: 'success' },
  },
  /** One clean, in words the office and the cleaner both use. */
  cleaning: {
    done: { label: 'Done', tone: 'success' },
    cleaning: { label: 'Cleaning', tone: 'info' },
    ready: { label: 'Guest out, ready to clean', tone: 'accent' },
    guest_in: { label: 'Guest still in', tone: 'neutral' },
    unassigned: { label: 'Unassigned', tone: 'danger' },
    waiting: { label: 'To do', tone: 'warning' },
    unplanned: { label: 'No clean planned', tone: 'danger' },
  },
  statement: {
    provisional: { label: 'Draft', tone: 'neutral' },
    finalised: { label: 'Final', tone: 'info' },
    sent: { label: 'Sent', tone: 'warning' },
    paid: { label: 'Paid', tone: 'success' },
  },
  payout: {
    pending: { label: 'Pending', tone: 'neutral' },
    processing: { label: 'Processing', tone: 'info' },
    paid: { label: 'Paid', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
  },
  /** Whether an owner can sign in to the owner portal. */
  owner: {
    active: { label: 'Active', tone: 'success' },
    not_invited: { label: 'Not invited', tone: 'neutral' },
  },
  /** A staff or owner login on Users and roles. */
  user: {
    active: { label: 'Active', tone: 'success' },
    invited: { label: 'Invited', tone: 'warning' },
    portal_only: { label: 'Portal only', tone: 'neutral' },
    inactive: { label: 'Inactive', tone: 'neutral' },
  },
  unit: {
    listed: { label: 'Listed', tone: 'success' },
    not_listed: { label: 'Not listed on any channel', tone: 'neutral' },
    sub_unit: { label: 'Sub-unit', tone: 'warning' },
  },
  contract: {
    active: { label: 'Active', tone: 'success' },
    ending_soon: { label: 'Ending soon', tone: 'warning' },
    ended: { label: 'Ended', tone: 'neutral' },
  },
  integration: {
    connected: { label: 'Connected', tone: 'success' },
    expired: { label: 'Expired', tone: 'danger' },
    degraded: { label: 'Degraded', tone: 'warning' },
    failed: { label: 'Failed', tone: 'danger' },
    not_connected: { label: 'Not connected', tone: 'neutral' },
  },
  sync: {
    queued: { label: 'Waiting to send', tone: 'warning' },
    synced: { label: 'Sent', tone: 'success' },
    failed: { label: 'Not sent', tone: 'danger' },
    not_connected: { label: 'Not connected', tone: 'neutral' },
  },
  automation: {
    running: { label: 'Running', tone: 'success' },
    not_running: { label: 'Not running yet', tone: 'neutral' },
  },
  /** A money action waiting for, or decided by, an approver. */
  approval: {
    pending: { label: 'Waiting', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'danger' },
    cancelled: { label: 'Withdrawn', tone: 'neutral' },
  },
  review: {
    replied: { label: 'Replied', tone: 'success' },
    needs_reply: { label: 'Needs reply', tone: 'warning' },
  },
  /** A request on IT Support, as the person who sent it reads it. The values are the IT Hub's. `resolved` is IT
   *  saying it is fixed and asking the person to check; `waiting_reporter` is IT waiting for their answer. */
  it_request: {
    open: { label: 'Sent', tone: 'neutral' },
    in_progress: { label: 'In progress', tone: 'info' },
    on_hold: { label: 'On hold', tone: 'neutral' },
    testing: { label: 'Being tested', tone: 'info' },
    waiting_reporter: { label: 'Waiting for you', tone: 'warning' },
    resolved: { label: 'Done, please confirm', tone: 'success' },
    closed: { label: 'Closed', tone: 'neutral' },
    rejected: { label: 'Not going ahead', tone: 'danger', outline: true },
  },
  it_urgency: {
    urgent: { label: 'Urgent', tone: 'danger' },
    high: { label: 'High', tone: 'warning' },
    medium: { label: 'Medium', tone: 'neutral' },
    low: { label: 'Low', tone: 'neutral' },
  },
  condition: {
    good: { label: 'Good', tone: 'success' },
    fair: { label: 'Fair', tone: 'neutral' },
    replace_soon: { label: 'Replace soon', tone: 'warning' },
    damaged: { label: 'Damaged', tone: 'danger' },
  },
  cleaner: {
    active: { label: 'Active', tone: 'success' },
    inactive: { label: 'Inactive', tone: 'neutral' },
  },
  /** Expenses carry no workflow status; the category is shown with its own colour. */
  expense_category: {
    internet: { label: 'Internet', tone: 'info' },
    electricity: { label: 'Electricity', tone: 'warning' },
    water: { label: 'Water', tone: 'info' },
    cleaning: { label: 'Cleaning', tone: 'info' },
    housekeeping: { label: 'Laundry', tone: 'info' },
    maintenance: { label: 'Maintenance', tone: 'warning' },
    utilities: { label: 'Utilities', tone: 'neutral' },
    consumables: { label: 'Consumables', tone: 'neutral' },
    furniture: { label: 'Furniture', tone: 'info' },
    management_fee: { label: 'Operator share', tone: 'neutral' },
    channel_fee: { label: 'Service fee', tone: 'neutral' },
    other: { label: 'Other', tone: 'neutral' },
  },

  /* ---------- Supply chain documents (built-in screens) ---------- */
  active_flag: ACTIVE_INACTIVE,
  customer: ACTIVE_INACTIVE,
  supplier: ACTIVE_INACTIVE,
  product: ACTIVE_INACTIVE,
  purchase_order: {
    SUBMITTED: { label: 'Submitted', tone: 'info' },
    PARTIALLY_RECEIVED: { label: 'Partly received', tone: 'warning' },
    RECEIVED: { label: 'Received', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  purchase_consignment: {
    SUBMITTED: { label: 'Submitted', tone: 'info' },
    PARTIALLY_RECEIVED: { label: 'Partly received', tone: 'warning' },
    RECEIVED: { label: 'Received', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  purchase_invoice: {
    POSTED: { label: 'Posted', tone: 'info' },
    PARTIALLY_PAID: { label: 'Part paid', tone: 'warning' },
    PAID: { label: 'Paid', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  purchase_return: {
    POSTED: { label: 'Posted', tone: 'info' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  goods_receipt: {
    POSTED: { label: 'Posted', tone: 'success' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
    CANCELLED: { label: 'Cancelled', tone: 'danger' },
  },
  sales_order: {
    CONFIRMED: { label: 'Confirmed', tone: 'info' },
    IN_PRODUCTION: { label: 'In production', tone: 'warning' },
    READY_TO_SHIP: { label: 'Ready to ship', tone: 'info' },
    SHIPPED: { label: 'Shipped', tone: 'info' },
    DELIVERED: { label: 'Delivered', tone: 'success' },
    INVOICED: { label: 'Invoiced', tone: 'success' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
    ON_HOLD: { label: 'On hold', tone: 'warning' },
    CANCELLED: { label: 'Cancelled', tone: 'danger' },
  },
  so_amendment: {
    REQUESTED: { label: 'Requested', tone: 'info' },
    APPROVED: { label: 'Approved', tone: 'warning' },
    APPLIED: { label: 'Applied', tone: 'success' },
    REJECTED: { label: 'Rejected', tone: 'danger' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  sales_invoice: {
    SENT: { label: 'Sent', tone: 'info' },
    PARTIALLY_PAID: { label: 'Part paid', tone: 'warning' },
    PAID: { label: 'Paid', tone: 'success' },
    OVERDUE: { label: 'Overdue', tone: 'danger' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  sales_return: {
    POSTED: { label: 'Posted', tone: 'info' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  delivery_order: {
    LOADED: { label: 'Loaded', tone: 'info' },
    DISPATCHED: { label: 'Dispatched', tone: 'info' },
    IN_TRANSIT: { label: 'In transit', tone: 'warning' },
    SIGNED: { label: 'Signed', tone: 'info' },
    DELIVERED: { label: 'Delivered', tone: 'success' },
    INVOICED: { label: 'Invoiced', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'danger' },
  },
  delivery_schedule: {
    UNPLANNED: { label: 'Unplanned', tone: 'neutral' },
    SCHEDULED: { label: 'Scheduled', tone: 'info' },
    DISPATCHED: { label: 'Dispatched', tone: 'warning' },
    DELIVERED: { label: 'Delivered', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  credit_note: {
    DRAFT: { label: 'Draft', tone: 'warning' },
    POSTED: { label: 'Posted', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  payment_voucher: {
    POSTED: { label: 'Posted', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  consignment_note: {
    OPEN: { label: 'Open', tone: 'info' },
    PARTIALLY_SETTLED: { label: 'Part settled', tone: 'warning' },
    CLOSED: { label: 'Closed', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  stock_take: {
    OPEN: { label: 'Open', tone: 'info' },
    POSTED: { label: 'Posted', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  vehicle: {
    AVAILABLE: { label: 'Available', tone: 'success' },
    MAINTENANCE: { label: 'In maintenance', tone: 'warning' },
    INACTIVE: { label: 'Inactive', tone: 'neutral' },
  },
  driver: {
    AVAILABLE: { label: 'Available', tone: 'success' },
    ON_LEAVE: { label: 'On leave', tone: 'warning' },
    INACTIVE: { label: 'Inactive', tone: 'neutral' },
  },
  // HR > Employees > Worker Penalty (migration 0169), Hookka's lifecycle.
  penalty: {
    draft: { label: 'Draft', tone: 'neutral' },
    pending: { label: 'Pending approval', tone: 'warning' },
    approved: { label: 'Approved, awaiting payroll', tone: 'info' },
    posted: { label: 'Posted', tone: 'success' },
  },
  // HR > Workers > Payroll and the portal's Pay screen (migration 0165). 'none': the month has not been run for them.
  payslip: {
    none: { label: 'Not run', tone: 'neutral' },
    draft: { label: 'Draft', tone: 'warning' },
    approved: { label: 'Approved', tone: 'info' },
    paid: { label: 'Paid', tone: 'success' },
  },
  // HR > Workers > Leave and the portal's Me screen (migration 0164).
  leave: {
    pending: { label: 'Waiting', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Not approved', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
  fabric_tier: {
    standard: { label: 'Standard', tone: 'neutral' },
    premium: { label: 'Premium', tone: 'info' },
    luxury: { label: 'Luxury', tone: 'success' },
  },
} satisfies Record<string, Vocab>;

export type StatusEntity = keyof typeof STATUS_VOCAB;

/** "operations_staff" / "IN_TRANSIT" -> "Operations staff" / "In transit". */
const words = (code: string) => code.replace(/[_.]+/g, ' ').trim().toLowerCase().replace(/^./, c => c.toUpperCase());

/** The label and tone for one stored value. Unknown values read as words in a neutral pill. */
export function statusOf(entity: StatusEntity, value: string | null | undefined): StatusEntry {
  const v = value ?? '';
  const map = STATUS_VOCAB[entity] as Vocab;
  return map[v] ?? map[v.toLowerCase()] ?? map[v.toUpperCase()] ?? { label: v ? words(v) : 'Not set', tone: 'neutral' };
}

/** Just the words, for filters, exports and sentences ("Booking is now Checked in"). */
export const statusLabel = (entity: StatusEntity, value: string | null | undefined) => statusOf(entity, value).label;

/** Every value of an entity in the order written above, for filter menus. */
export const statusOptions = (entity: StatusEntity) =>
  Object.entries(STATUS_VOCAB[entity] as Vocab).map(([value, e]) => ({ value, ...e }));

/** CSS for each tone: the tint behind, the text on it (AA), and the line for dots and borders. */
export const TONE_STYLE: Record<StatusTone, { bg: string; fg: string; line: string }> = {
  success: { bg: 'var(--color-success)', fg: 'var(--color-success-fg)', line: 'var(--color-success-line)' },
  warning: { bg: 'var(--color-warning)', fg: 'var(--color-warning-fg)', line: 'var(--color-warning-line)' },
  danger: { bg: 'var(--color-critical)', fg: 'var(--color-critical-fg)', line: 'var(--color-critical-line)' },
  info: { bg: 'var(--color-info)', fg: 'var(--color-info-fg)', line: 'var(--color-info-line)' },
  neutral: { bg: 'var(--color-neutral)', fg: 'var(--color-neutral-fg)', line: 'var(--color-neutral-line)' },
  accent: { bg: 'var(--color-gold-50)', fg: 'var(--color-gold-700)', line: 'var(--color-gold-500)' },
};
