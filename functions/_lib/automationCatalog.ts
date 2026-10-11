/** The automation rules the product ships with. Only on/off is stored (table automations, keyed by id); everything else is fixed here.
 *  Copy and triggers come from notifications.md. */
export interface CatalogRule {
  id: string; name: string; template: string; group: string; trigger: string; timing: string; channels: string[];
  needs: string; preview: string; delivery: 'transactional' | 'opt_out'; quietHours: 'queue' | 'override' | 'always'; isActive: boolean;
}

export const CATALOG: CatalogRule[] = [
  {
    "id": "guest.booking_confirmed",
    "name": "Reservation confirmed",
    "template": "guest.booking_confirmed",
    "group": "new_booking",
    "trigger": "reservation.state → confirmed",
    "timing": "Immediate",
    "channels": [
      "Email",
      "WhatsApp"
    ],
    "needs": "Guest name, building, unit, dates, nights, total, contact",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "Hi {guest}, your reservation at {property} {unit} is confirmed for {checkIn}–{checkOut} ({nights}). Total {total}. We are on WhatsApp if you need anything.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "guest.cancellation",
    "name": "Reservation cancelled",
    "template": "guest.cancellation",
    "group": "new_booking",
    "trigger": "reservation.state → cancelled",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Refund position, reason, contact",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "Hi {guest}, your reservation at {property} {unit} for {dates} has been cancelled. {refundPosition} Reply here and we will help.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "guest.pre_arrival",
    "name": "Check-in details",
    "template": "guest.pre_arrival",
    "group": "before_arrival",
    "trigger": "reservation.check_in approaching",
    "timing": "48 hours before check-in",
    "channels": [
      "Email",
      "WhatsApp"
    ],
    "needs": "Check-in window, address, parking note",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "You check in at {property} {unit} on {checkIn}, from {checkInTime}. Address: {address}. Parking: {parkingNote}.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "guest.access_details",
    "name": "Access details",
    "template": "guest.access_details",
    "group": "before_arrival",
    "trigger": "unit.readiness = ready AND check-in approaching",
    "timing": "2 hours before check-in, never earlier",
    "channels": [
      "WhatsApp"
    ],
    "needs": "Access instruction, door code, wifi. Code changes after checkout",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "You are all set for {property} {unit}. Door code {doorCode}, wifi {wifiName} / {wifiPass}. {accessInstruction}",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "guest.checkin_delayed",
    "name": "Check-in delayed",
    "template": "guest.checkin_delayed",
    "group": "before_arrival",
    "trigger": "turnover task overdue past check-in time",
    "timing": "On breach",
    "channels": [
      "WhatsApp"
    ],
    "needs": "New expected time, apology, contact. Sent by a human, drafted by the system",
    "preview": "Apologies {guest} — {unit} needs a little longer. New check-in time is {newTime}. Call us on {contact} any time.",
    "delivery": "transactional",
    "quietHours": "override",
    "isActive": false
  },
  {
    "id": "guest.checkout_reminder",
    "name": "Checkout reminder",
    "template": "guest.checkout_reminder",
    "group": "stay_departure",
    "trigger": "reservation.check_out approaching",
    "timing": "12 hours before checkout",
    "channels": [
      "WhatsApp"
    ],
    "needs": "Checkout time, key return, late checkout option",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "Checkout at {property} {unit} is tomorrow by {checkOutTime}. Leave keys in the lockbox. Need a late checkout? Just ask.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "guest.review_request",
    "name": "Review request",
    "template": "guest.review_request",
    "group": "stay_departure",
    "trigger": "reservation.state → checked_out",
    "timing": "24 hours after checkout",
    "channels": [
      "Email",
      "Channel API"
    ],
    "needs": "Channel review link",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "Thanks for staying at {property} {unit}, {guest}. If it felt like home, a quick review helps a lot: {reviewLink}",
    "delivery": "opt_out",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "owner.statement_ready",
    "name": "Owner statement ready",
    "template": "owner.statement_ready",
    "group": "owner_finance",
    "trigger": "statement.state → sent",
    "timing": "On send",
    "channels": [
      "Email",
      "Portal"
    ],
    "needs": "Period, Net Payout to Owner, owner portal link, PDF",
    "preview": "Your {period} owner statement for {unit} is ready. Net Payout to Owner {netPayout}. View it in your owner portal: {portalLink}",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "owner.payout_paid",
    "name": "Owner payout paid",
    "template": "owner.payout_paid",
    "group": "owner_finance",
    "trigger": "payout.state → paid",
    "timing": "Immediate",
    "channels": [
      "Email",
      "Portal"
    ],
    "needs": "Amount, bank last 4, value date",
    "preview": "Your owner payout of {amount} for {period} has been transferred to {bank} ••••{last4}, value date {valueDate}.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "owner.payout_failed",
    "name": "Owner payout failed",
    "template": "owner.payout_failed",
    "group": "owner_finance",
    "trigger": "payout.state → failed",
    "timing": "Immediate",
    "channels": [
      "Email",
      "Phone call task"
    ],
    "needs": "Amount, reason, next step. Also creates an internal task",
    "preview": "We could not complete your owner payout of {amount} for {period}: {reason}. We are on it and will call you shortly.",
    "delivery": "transactional",
    "quietHours": "override",
    "isActive": true
  },
  {
    "id": "owner.monthly_summary",
    "name": "Monthly summary",
    "template": "owner.monthly_summary",
    "group": "owner_finance",
    "trigger": "period close",
    "timing": "1st of the month",
    "channels": [
      "Email"
    ],
    "needs": "Occupancy, avg nightly price, rating, upcoming reservations",
    // vocab-ok: {property} and {adr} are template tokens the sender fills in
    "preview": "Your {period} summary for {unit}: occupancy {occupancy}, avg nightly price {adr}, rating {rating}. {upcomingCount} reservations ahead.",
    "delivery": "opt_out",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "owner.approval_required",
    "name": "Approval required",
    "template": "owner.approval_required",
    "group": "owner_approvals",
    "trigger": "maintenance_issue.owner_approval_required",
    "timing": "Immediate",
    "channels": [
      "Email",
      "Portal"
    ],
    "needs": "Title, quote, consequence of declining",
    "preview": "{unit} needs {title}. Quote {amount}. If it is not approved, {consequence}. Approve in your portal: {portalLink}",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "owner.approval_reminder",
    "name": "Approval reminder",
    "template": "owner.approval_reminder",
    "group": "owner_approvals",
    "trigger": "approval outstanding",
    "timing": "48 hours, then 5 days",
    "channels": [
      "Email"
    ],
    "needs": "Same, plus the earnings at risk if the unit is blocked",
    "preview": "Reminder: {title} on {unit} is awaiting your approval. Gross Income at risk while blocked: {revenueAtRisk}.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": false
  },
  {
    "id": "owner.unit_blocked",
    "name": "Unit blocked",
    "template": "owner.unit_blocked",
    "group": "owner_approvals",
    "trigger": "unit.readiness → maintenance with nights blocked",
    "timing": "Immediate",
    "channels": [
      "Email",
      "Portal"
    ],
    "needs": "Dates blocked, reason, earnings at risk, expected return",
    "preview": "{unit} is blocked for maintenance {dates}: {reason}. Gross Income at risk {revenueAtRisk}. Expected back {expectedReturn}.",
    "delivery": "transactional",
    "quietHours": "queue",
    "isActive": true
  },
  {
    "id": "ops.checkin_at_risk",
    "name": "Check-in at risk",
    "template": "ops.checkin_at_risk",
    "group": "ops_alerts",
    "trigger": "turnover incomplete within 60 min of check-in",
    "timing": "60 min before check-in",
    "channels": [
      "In-app",
      "WhatsApp group"
    ],
    "needs": "Destination: Operations today, filtered to check-in risk",
    "preview": "Check-in risk: the {unit} cleaning job is not finished and a guest checks in at {arrivalTime}. Assign or escalate now.",
    "delivery": "transactional",
    "quietHours": "override",
    "isActive": true
  },
  {
    "id": "ops.task_unassigned",
    "name": "Job unassigned",
    "template": "ops.task_unassigned",
    "group": "ops_alerts",
    "trigger": "task within 3 h of due with no assignee",
    "timing": "3 hours before due",
    "channels": [
      "In-app"
    ],
    "needs": "Destination: Operations today, Unassigned filter",
    "preview": "The {unit} cleaning job is due {dueTime} with no cleaner assigned. Assign from Operations today.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "ops.damage_reported",
    "name": "Damage reported",
    "template": "ops.damage_reported",
    "group": "ops_alerts",
    "trigger": "field app creates a maintenance job",
    "timing": "Immediate",
    "channels": [
      "In-app",
      "WhatsApp"
    ],
    "needs": "Destination: the maintenance job",
    "preview": "{crew} reported {issue} at {unit}. Opened as a maintenance job — review and triage.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "ops.guest_message",
    "name": "Guest message",
    "template": "ops.guest_message",
    "group": "ops_alerts",
    "trigger": "inbound guest message",
    "timing": "Immediate",
    "channels": [
      "In-app"
    ],
    "needs": "Destination: Messages",
    "preview": "New message from {guest} about {unit}: \"{snippet}\". Reply in Messages.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "ops.channel_sync_failed",
    "name": "Channel connection failed",
    "template": "ops.channel_sync_failed",
    "group": "ops_alerts",
    "trigger": "integration.state → failed",
    "timing": "Immediate",
    "channels": [
      "In-app banner",
      "Email to management"
    ],
    "needs": "Destination: System, Integrations",
    "preview": "{provider} connection failed at {time}. New reservations may arrive late until it is reconnected.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "finance.statements_unsent",
    "name": "Owner statements unsent",
    "template": "finance.statements_unsent",
    "group": "ops_alerts",
    "trigger": "final owner statements unsent 3 days after close",
    "timing": "3 days after period close",
    "channels": [
      "In-app",
      "Email"
    ],
    "needs": "Destination: Owner statements, Not sent filter",
    "preview": "{count} final owner statements for {period} are still unsent, {days} days after close.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "finance.payout_failed",
    "name": "Owner payout failed (internal)",
    "template": "finance.payout_failed",
    "group": "ops_alerts",
    "trigger": "payout.state → failed",
    "timing": "Immediate",
    "channels": [
      "In-app",
      "Email"
    ],
    "needs": "Destination: Owner payouts",
    "preview": "Owner payout to {owner} ({amount}) failed: {reason}. Retry or update bank details in Owner payouts.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "field.task_assigned",
    "name": "Job assigned",
    "template": "field.task_assigned",
    "group": "field",
    "trigger": "task.assignee_id set",
    "timing": "Immediate",
    "channels": [
      "Push"
    ],
    "needs": "Unit, due time, address. No financials",
    "preview": "New cleaning job: {unit}, due {dueTime}. Address {address}. Access {accessInstruction}.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "field.task_reassigned",
    "name": "Job reassigned",
    "template": "field.task_reassigned",
    "group": "field",
    "trigger": "assignee changed away",
    "timing": "Immediate",
    "channels": [
      "Push"
    ],
    "needs": "Removes it from their list",
    "preview": "{unit} on {dueDate} has been reassigned. It has been removed from your list.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "field.schedule_changed",
    "name": "Schedule changed",
    "template": "field.schedule_changed",
    "group": "field",
    "trigger": "task.due_at moved",
    "timing": "Immediate",
    "channels": [
      "Push"
    ],
    "needs": "Old and new time stated",
    "preview": "Schedule change: the {unit} cleaning job moved from {oldTime} to {newTime}.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": false
  },
  {
    "id": "field.sync_failed",
    "name": "Change not saved",
    "template": "field.sync_failed",
    "group": "field",
    "trigger": "offline mutation rejected",
    "timing": "On failure",
    "channels": [
      "In-app, persistent"
    ],
    "needs": "Stays visible as Not saved until it goes through",
    "preview": "A change you made offline could not be saved. It stays marked Not saved until it goes through.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "account.invited",
    "name": "User invited",
    "template": "account.invited",
    "group": "account",
    "trigger": "user created",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Temporary password, sign-in link, must_change_password is true",
    "preview": "Welcome to Conts ERP. Sign in at {signInLink} with temporary password {tempPassword} and set your own.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "account.password_reset",
    "name": "Password reset",
    "template": "account.password_reset",
    "group": "account",
    "trigger": "forgot-password request",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Reset link, 60-minute expiry stated",
    "preview": "Reset your Conts ERP password using this link: {resetLink}. It expires in 60 minutes.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "account.password_changed",
    "name": "Password changed",
    "template": "account.password_changed",
    "group": "account",
    "trigger": "password change succeeds",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Time and device, plus a route if it was not them",
    "preview": "Your Conts ERP password was changed {time} on {device}. If this was not you, secure your account: {securityLink}.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "account.locked",
    "name": "Account locked",
    "template": "account.locked",
    "group": "account",
    "trigger": "5 failed sign-in attempts",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Unlock time, administrator route",
    "preview": "Your account is locked until {unlockTime} after five failed sign-ins. Ask an administrator to reset it sooner.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  },
  {
    "id": "account.new_device",
    "name": "New device sign-in",
    "template": "account.new_device",
    "group": "account",
    "trigger": "sign-in from an unrecognised device",
    "timing": "Immediate",
    "channels": [
      "Email"
    ],
    "needs": "Time, approximate location, device",
    "preview": "New sign-in to Conts ERP from {device} near {location} at {time}. If this was not you, {securityLink}.",
    "delivery": "transactional",
    "quietHours": "always",
    "isActive": true
  }
];

export const QUIET_HOURS = {
  "from": "22:00",
  "to": "08:00",
  "timezone": "Asia/Kuala_Lumpur",
  "note": "Non-urgent guest and owner messages wait until 08:00. Check-in risk and owner payout failures are sent at once."
};

/** The rules some code really sends today (grep the template name in functions/ to check). Everything else
 *  in the catalog is "Not running yet": no code reads its on/off switch or sends its message. Keep this list
 *  honest: add a template only together with the code that sends it. */
export const RUNNING = new Set([
  'owner.statement_ready', 'owner.payout_paid', 'owner.payout_failed', 'owner.unit_blocked',
  'ops.damage_reported', 'field.task_assigned',
  'account.invited', 'account.password_reset', 'account.password_changed',
]);

/** What a rule that is not running would need before it could. */
export function needsToRun(rule: CatalogRule): string {
  if (rule.template === 'finance.statements_unsent') return 'Written, but it runs from the scheduled run (theconts-cron), which is not deployed yet.';
  const timed = /before|after|approaching|outstanding|period close|1st of the month|within|unassigned/i.test(`${rule.trigger} ${rule.timing}`);
  const toGuest = rule.group === 'new_booking' || rule.group === 'before_arrival' || rule.group === 'stay_departure';
  return [
    'No code sends this message yet.',
    timed ? 'It needs the scheduled run (theconts-cron) to check the time.' : 'It needs the event to call the message sender.',
    toGuest ? 'Guest messages also need the email and WhatsApp keys.' : '',
  ].filter(Boolean).join(' ');
}
