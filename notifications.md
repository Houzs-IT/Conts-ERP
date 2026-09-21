# Conts ERP — notifications and automations

Every message the system sends, who receives it, what triggers it and which
data it needs. The frontend surfaces these as Automations (`/communication/automations`);
the backend owns delivery. Channels: transactional email, WhatsApp Business
(already in use operationally), in-app notification, push for the field app.

Rules that apply to all of them:

- Sentence case, calm and specific. No all-caps operational messages.
- Every guest-facing message states the property, dates and a contact route.
- Owner-facing language is factual and avoids internal shorthand.
- Field roles never receive financial figures.
- Timezone Asia/Kuala Lumpur in every timestamp; currency as `RM 1,234.00`.
- A notification is never the only record of something a user must revisit — it
  always has a durable destination in the product.

---

## 1. Guest messages

| Key | Trigger | Timing | Channel | Needs |
| --- | --- | --- | --- | --- |
| `guest.booking_confirmed` | `reservation.state → confirmed` | Immediate | Email, WhatsApp | Guest name, property, unit, dates, nights, total, contact |
| `guest.pre_arrival` | `reservation.check_in` approaching | −48 h | Email, WhatsApp | Check-in window, address, parking note |
| `guest.access_details` | Unit readiness = `ready` AND check-in approaching | −2 h (never earlier) | WhatsApp | Access instruction, door code, wifi. Code rotates after the stay |
| `guest.checkin_delayed` | Turnover task overdue past check-in time | On breach | WhatsApp | New expected time, apology, contact. Sent by a human, drafted by the system |
| `guest.checkout_reminder` | `reservation.check_out` approaching | −12 h | WhatsApp | Check-out time, key return, late check-out option |
| `guest.review_request` | `reservation.state → checked_out` | +24 h | Email, channel API | Channel review link |
| `guest.cancellation` | `reservation.state → cancelled` | Immediate | Email | Refund position, reason, contact |

## 2. Owner messages

| Key | Trigger | Timing | Channel | Needs |
| --- | --- | --- | --- | --- |
| `owner.statement_ready` | `statement.state → sent` | On send | Email + portal | Period, net payout, portal link, PDF |
| `owner.payout_paid` | `payout.state → paid` | Immediate | Email + portal | Amount, bank last 4, value date |
| `owner.payout_failed` | `payout.state → failed` | Immediate | Email + phone call task | Amount, reason, next step. Also creates an internal task |
| `owner.approval_required` | `maintenance_issue.owner_approval_required` | Immediate | Email + portal | Title, quote, consequence of declining |
| `owner.approval_reminder` | Approval outstanding | +48 h, then +5 d | Email | Same, plus the revenue at risk if the unit is blocked |
| `owner.unit_blocked` | `unit.readiness → maintenance` with nights blocked | Immediate | Email + portal | Dates blocked, reason, revenue at risk, expected return |
| `owner.monthly_summary` | Period close | 1st of month | Email | Occupancy, ADR, rating, upcoming bookings |

## 3. Staff notifications

| Key | Trigger | Channel | Destination in product |
| --- | --- | --- | --- |
| `ops.checkin_at_risk` | Turnover incomplete within 60 min of check-in | In-app + WhatsApp group | Operations today, filtered to check-in risk |
| `ops.task_unassigned` | Task within 3 h of due with no assignee | In-app | Operations today, Unassigned filter |
| `ops.damage_reported` | Field app creates a maintenance issue | In-app + WhatsApp | The maintenance issue |
| `ops.guest_message` | Inbound guest message | In-app | Inbox thread |
| `ops.channel_sync_failed` | `integration.state → failed` | In-app banner + email to management | System, Integrations |
| `finance.statements_unsent` | Finalised statements unsent 3 days after period close | In-app + email | Owner statements, filtered to Not sent |
| `finance.payout_failed` | `payout.state → failed` | In-app + email | Payouts |

## 4. Field app notifications

| Key | Trigger | Channel | Notes |
| --- | --- | --- | --- |
| `field.task_assigned` | `task.assignee_id` set | Push | Unit, due time, address. No financials |
| `field.task_reassigned` | Assignee changed away | Push | Removes it from their list |
| `field.schedule_changed` | `task.due_at` moved | Push | Old and new time stated |
| `field.sync_failed` | Offline mutation rejected | In-app, persistent | Stays visible as Failed to sync until resolved |

## 5. Authentication and account

| Key | Trigger | Channel | Needs |
| --- | --- | --- | --- |
| `account.invited` | User created | Email | Temporary password, sign-in link, `must_change_password` is true |
| `account.password_reset` | Forgot-password request | Email | Reset link, 60-minute expiry stated |
| `account.password_changed` | Password change succeeds | Email | Time and device, plus a route if it was not them |
| `account.locked` | 5 failed attempts | Email | Unlock time, administrator route |
| `account.new_device` | Sign-in from an unrecognised device | Email | Time, approximate location, device |

## 6. Delivery requirements for backend

- **Idempotency.** Every send carries a key of `{template, entity_id, trigger_at}`. Retries must not double-send.
- **Quiet hours.** No non-urgent guest or owner message between 22:00 and 08:00 MYT; queue to 08:00. Check-in risk and payout failure override this.
- **Audit.** Each send writes `notification_log` with template, recipient, channel, payload hash, provider message id, state.
- **Failure surface.** A failed send is a visible state in the product, never a silent drop. The related record shows Failed to notify with a retry action.
- **Localisation.** Templates are keyed, not hard-coded. English at launch; Bahasa Malaysia and Simplified Chinese planned.
- **Opt-out.** Owner monthly summaries and guest review requests are opt-out. Transactional messages are not.
