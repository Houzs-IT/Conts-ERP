# Conts ERP — control map

Every button, link, filter and row action in the product: what it does, which
endpoint it calls, which tables it touches, and what the user sees afterwards.
Read with `api.md` (request and response shapes), `schema.sql` (tables),
`permissions.json` (who may press it) and `copy.md` (the exact strings).

Conventions used in every row:
- **Writes** names the tables changed. Every write also appends to `audit_log`.
- A control absent from a role in `permissions.json` is **removed** from the UI,
  not disabled. Disabled is reserved for a state reason, and always carries text.
- Destructive and irreversible actions open a confirmation dialog first.

---

## 1. Authentication

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Sign in | `POST /api/auth/login` | `sessions`, `users.last_login_at`, `users.failed_attempts` | Sets the session cookie, returns `user.role` and a resolved `home`. The client redirects; it never asks which portal |
| Show / Hide password | — | — | Toggles the input between `password` and `text` |
| Keep me signed in | — | — | Requests the 30-day absolute session instead of the 8-hour one |
| Forgot password? | route | — | `/forgot-password` |
| Send reset link | `POST /api/auth/forgot-password` | `password_reset_tokens` | Always the same success block. Never reveals whether the account exists |
| Save and sign in | `POST /api/auth/reset-password` | `users.password_hash`, `password_reset_tokens.used_at` | Signs in and routes to the role home |
| Save and continue | `POST /api/auth/change-password` | `users.password_hash`, `users.must_change_password` | Clears the forced-change flag |
| Back to sign in | route | — | `/login` |
| Log out | `POST /api/auth/logout` | `sessions` (delete) | Clears the cookie, returns to `/login` |

**Login routing.** `POST /api/auth/login` returns `home`. Order: `must_change_password`
→ `/change-password`; `housekeeper`/`technician` → `/field/today`; `owner` → `/owner`;
everyone else → `/`. The client obeys `home`; it does not compute it.

---

## 2. Application shell

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Sidebar group (L2 with children) | — | — | Expands or collapses. Never navigates |
| Sidebar item (leaf) | route | — | Navigates. Built from the session permission list |
| Collapse sidebar | — | `localStorage` | 244px ⇄ 68px. Labels move to tooltips |
| Search / `/` key | `GET /api/search?q=` | — | Units, guests, reservations, owners. Scoped by role |
| Notification bell | `GET /api/notifications` | `notifications.read_at` on open | Every item links to a durable destination |
| Avatar | — | — | Opens the profile menu |
| Personal profile | route | — | `/profile` |
| Notification settings | route | — | `/profile/notifications` |
| Security and sessions | `GET /api/auth/sessions` | — | Active devices, with revoke |
| Page primary action | varies | varies | One per page, listed under that screen below |

---

## 3. Dashboard `/`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Add property | route | — | `/properties/new` |
| 3M / 12M / YTD | `GET /api/dashboard/trend?range=` | — | Re-reads the chart. `tone` on each delta comes from the server, never the sign of the number |
| Exception → Assign cleaner | `POST /api/housekeeping/tasks/:id/assign` | `tasks.assignee_id`, `tasks.state` | Notifies the assignee. 409 if they are double-booked, with an override |
| Exception → Notify owner | `POST /api/owners/:id/notify` | `notification_log` | Sends dates blocked, reason, revenue at risk, expected return |
| Exception → Review and send | route | — | `/finance/statements?period=latest` |
| Exception → Open pricing | route | — | `/performance/pricing?unitId=` |
| Portfolio row | route | — | `/properties/units/:unitId` |
| Open operations | route | — | `/operations/today` |

---

## 4. Reservations → Calendar `/reservations/calendar`

The calendar is the channel manager surface: it aggregates every connected
platform, and a rate set here is pushed back out through the channel APIs.

### Filters

| Control | Endpoint | Result |
| --- | --- | --- |
| Host | — | Fixed to the tenant. Present for multi-entity later |
| Property | `GET /api/reservations/calendar?propertyId=` | All properties, or one building. Reads `properties` and `units` |
| Channel checkboxes | `&channels=airbnb,booking_com,…` | Hides reservations from unchecked channels. Client-side over the loaded range |
| Select all / Deselect all | — | Bulk toggle of the channel set |
| Booking status chips | `&status=confirmed,checked_in,…` | Each chip removes its own status. Values are the `reservation_state` enum |
| Reset | — | Clears property, channels and statuses back to default |

### Toolbar

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Expand rates | — | — | Reveals Inventory, Web rate, Airbnb rate and Booking.com rate rows under every unit |
| Rate update | `POST /api/rates/bulk` | `pricing_rules`, `rate_pushes` | Range + units + channels in one operation. Pushed through each channel API |
| Block wizard | `POST /api/blocks` | `reservations` (channel `maintenance_block`) | Holds nights so no channel can sell them. Conflicts reported before saving |
| Refresh | `POST /api/integrations/sync` | `reservations`, `integrations.last_synced_at` | Pulls new and changed reservations. Expired channels are skipped and named |
| ◀ / ▶ / Today | `GET /api/reservations/calendar?from=&to=` | — | Moves the 14-night window |

### Grid

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Empty night | dialog | — | Three actions: **Block dates**, **Create reservation**, **Set price** |
| → Block dates | `POST /api/blocks` | `reservations` | Requires a reason. Pushed to every channel as unavailable |
| → Create reservation | `POST /api/reservations` | `reservations`, `guests` | Manual booking. 409 `DATE_CONFLICT` returns the conflicting reservation |
| → Set price | `PUT /api/rates` | `pricing_rules`, `rate_pushes` | One night, one unit. Pushed to every connected channel |
| Rate cell (expanded) | `PUT /api/rates` | `pricing_rules`, `rate_pushes` | Per-channel override for that night. Confirmed bookings keep their original rate |
| Booking block | — | — | Opens the reservation drawer |
| Drag a block | `PATCH /api/reservations/:id/dates` | `reservations` | Without `confirm` returns 428 with the consequence sentence. Conflicts name the blocking guest |

### Reservation drawer

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| View booking | route | — | `/reservations/bookings/:id` full record |
| Duplicate booking | `POST /api/reservations/:id/duplicate` | `reservations` | Same unit, guest and length, dates cleared for the operator to set |
| Chat with guest | `POST /api/messages` | `message_threads`, `messages` | Opens the thread on the booking's own channel, WhatsApp for direct |
| Activity log | `GET /api/audit?entityTable=reservations&entityId=` | — | Actor, timestamp, before and after |
| Change dates | `PATCH /api/reservations/:id/dates` | `reservations` | Confirmation states the consequence and notifies the guest |
| Cancel reservation | `POST /api/reservations/:id/cancel` | `reservations.state` | Releases the dates on every channel, notifies the guest |
| Quick status update | `PATCH /api/reservations/:id` | `reservations.state` | Closed list from the `reservation_state` enum |

---

## 5. Reservations → Bookings `/reservations/bookings`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Create reservation | `POST /api/reservations` | `reservations`, `guests` | Manual entry, same validation as the calendar |
| Import reservation | `POST /api/reservations/import` | `reservations`, `guests` | CSV. Returns per-row accepted and rejected with reasons |
| Download CSV | `GET /api/reservations/export` | — | Header prints the applied filters, generated time and scope |
| Filter chips | `GET /api/reservations?filter=` | — | All, arriving today, in house, pending payment, blocks, cancelled |
| Column sort | `&sort=column:dir` | — | Server-side. Sort state visible in the header |
| Column search | `&q=&field=` | — | Per-column search, matching the host platform |
| Row | — | — | Opens the reservation drawer |
| Chat icon | `POST /api/messages` | `messages` | Opens the guest thread |

**Columns pulled from the channel**, one row per reservation:
confirmation code (with the channel's own code in brackets), property name, unit
name, check-in, check-out, guest name, contact number, received date, booking
status, chat, deposit. All of it lands in `reservations` and `guests` from
`POST /api/webhooks/{channel}`.

---

## 6. Reservations → Guests `/reservations/guests`

Guests is arrival and departure control, not a CRM list.

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Today / Tomorrow tabs | `GET /api/guests/movements?date=` | — | Splits into **checking in** and **checking out** |
| Prepare early | `POST /api/reservations/:id/prepare` | `reservations.prepared_at` | Marks arrival pre-work done: access sent, unit confirmed ready |
| Send access details | `POST /api/messages` | `messages`, `notification_log` | Never earlier than 2 hours before check-in, and only when the unit is Ready |
| Mark checked in | `PATCH /api/reservations/:id` | `reservations.state`, `units.readiness` | State → `checked_in`, unit → `occupied` |
| Mark checked out | `PATCH /api/reservations/:id` | `reservations.state`, `units.readiness`, `tasks` | State → `checked_out`, unit → `dirty`, **and a cleaning task is created automatically** |
| Message guest | `POST /api/messages` | `messages` | Channel thread, WhatsApp for direct |
| Guest row | route | — | `/reservations/guests/:id` — stay history, lifetime value, rating |
| Add guest | `POST /api/guests` | `guests` | For walk-ins and direct bookings |

---

## 7. Operations → Housekeeping `/operations/housekeeping`

**Every checkout creates a cleaning task automatically.** The channel sync and the
manual check-out action both call the same internal routine, so a task exists the
moment a stay ends, with the window computed from the next arrival.

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Date tabs | `GET /api/housekeeping/tasks?date=` | — | Today, tomorrow, this week |
| Assign cleaner | `POST /api/housekeeping/tasks/:id/assign` | `tasks.assignee_id`, `tasks.state` | Notifies by push. 409 when the cleaner overlaps, with an override |
| Auto-assign by rule | `POST /api/housekeeping/auto-assign` | `tasks.assignee_id`, `tasks.sequence` | Applies the preset ordering rule to every unassigned task |
| Edit ordering rule | `PUT /api/housekeeping/rules` | `housekeeping_rules` | Sequence by earliest next check-in, by building, or manual |
| Reschedule | `PATCH /api/housekeeping/tasks/:id` | `tasks.scheduled_for`, `tasks.due_at` | Warns if the new window ends after the next arrival |
| Start | `POST /api/housekeeping/tasks/:id/start` | `tasks.started_at`, `tasks.state`, `units.readiness` | State → `in_progress`, unit → `cleaning` |
| Add photo | `POST /api/tasks/:id/photos` | `documents` (R2) | At least one is required before completion |
| Mark complete | `POST /api/tasks/:id/complete` | `tasks.state`, `tasks.completed_at`, `units.readiness` | 422 `PHOTO_REQUIRED` without a photo. Unit → `ready` |
| Report damage | `POST /api/maintenance/issues` | `maintenance_issues`, `documents` | Raised from the cleaning task, linked to the unit |

**Fields on a cleaning task:** unit, source reservation, cleaning window
(`scheduled_for` → `due_at`), **next guest arrival** (`next_guest_at`), assignee,
sequence position, linen set, instructions, photos, state. The window must close
before `next_guest_at`; the SLA pill counts down to it and turns critical on breach.

---

## 8. Operations → Maintenance `/operations/maintenance`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Create job | `POST /api/maintenance/issues` | `maintenance_issues` | Unit, title, detail, vendor, quote, charge-to, whether it blocks the unit |
| Assign technician | `PATCH /api/maintenance/issues/:id` | `maintenance_issues.assignee_id` | Notifies by push |
| Request owner approval | `POST /api/maintenance/issues/:id/request-approval` | `maintenance_issues.owner_approval_required` | Owner sees it in their portal with the quote |
| Block the unit | `POST /api/blocks` | `reservations`, `units.readiness` | Holds the dates and takes the unit off sale |
| Upload photo | `POST /api/maintenance/issues/:id/photos` | `documents` (R2) | Before and after evidence |
| Upload POD / invoice | `POST /api/maintenance/issues/:id/documents` | `documents` (R2) | Proof of delivery and the vendor invoice |
| Mark complete | `POST /api/maintenance/issues/:id/complete` | `maintenance_issues.state`, `expenses`, `units.readiness` | Requires a photo and a final amount. **Creates the expense**, releases the unit |
| Reopen | `PATCH /api/maintenance/issues/:id` | `maintenance_issues.state` | State → `reopened`, tone critical |

---

## 9. Operations → Today `/operations/today`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Filter chips | `GET /api/operations/today?filter=` | — | All work, check-in risk, housekeeping, maintenance, unassigned |
| Assign cleaner | `POST /api/housekeeping/tasks/:id/assign` | `tasks` | As above |
| Open task | route | — | `/operations/tasks/:id` |
| Confirm with guest | `POST /api/messages` | `messages` | Prefilled with the request being answered |
| Start inspection | `POST /api/inspections` | `inspections` | Opens the checklist |
| Update owner | `POST /api/owners/:id/notify` | `notification_log` | Blocked-unit notice |

`riskRank` and the SLA label are computed server-side and returned with each row.
The client never recomputes them from its own clock.

---

## 10. Properties `/properties`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Add building | `POST /api/properties` | `properties` | State → building. Units are added inside it |
| Add unit | `POST /api/units` | `units`, `unit_fields` | The full field set below |
| Building row | — | — | Expands to its units |
| Unit row | route | — | `/properties/units/:id` |
| Edit unit | `PATCH /api/units/:id` | `units`, `unit_fields` | Free-text and dropdown fields per the spec |
| Generate API key | `POST /api/units/:id/api-keys` | `unit_api_keys` | Shown once. Stored hashed |
| Revoke API key | `DELETE /api/units/:id/api-keys/:keyId` | `unit_api_keys` | Immediate. Channel sync for that unit stops |
| Add monthly expense | `POST /api/expenses` | `expenses` | Internet, electricity, water, cleaning, others. Manual now, API later |
| Edit monthly expense | `PATCH /api/expenses/:id` | `expenses` | Locked once the period's statement is sent |
| Generate report | `GET /api/expenses/report?unitId=&period=` | — | Per unit, per month. CSV or PDF |
| Reveal access code | `GET /api/access-credentials/:id?reveal=true` | `audit_log` | Masked by default. Revealing is itself audited |

---

## 11. Owners `/owners`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Add owner | `POST /api/owners` | `owners` | Name, IC, address, bank, contact |
| Owner row | route | — | `/owners/:id` — units, contract, statements, documents |
| Link unit to owner | `PATCH /api/units/:id` | `units.owner_id` | One owner holds many units |
| Add contract | `POST /api/contracts` | `owner_contracts`, `documents` | Fee percent, start, renewal, offer letter |
| Invite to portal | `POST /api/owners/:id/invite` | `users` | Creates an `owner` account with `must_change_password` |

---

## 12. Finance → Owner statements `/finance/statements`

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Generate statements | `POST /api/statements/generate` | `owner_statements`, `statement_lines` | Lands as `provisional` |
| Select rows | — | — | Only `finalised` rows are selectable |
| Send n statements | `POST /api/statements/send` | `owner_statements.state`, `notification_log` | 422 on provisional rows. Partial failures name only what failed |
| Export | `GET /api/statements/export` | — | Header prints filters, generated time and scope |
| Row | route | — | `/finance/statements/:id` |
| Download PDF | `GET /api/statements/:id/pdf` | — | Generated into R2, served signed |

---

## 13. Owner portal `/owner`

Every endpoint derives `owner_id` from the session. A mismatched id is 403, never
a silent empty list.

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Download statement | `GET /api/owner/statements/:id/pdf` | — | Finalised PDF |
| Download document | `GET /api/documents/:id/download` | — | Signed R2 URL |
| Approve quote | `POST /api/maintenance/issues/:id/approve` | `maintenance_issues.owner_approved_at` | Work is scheduled, amount deducted from the next statement |
| Unit row | route | — | Their own unit only |

---

## 14. System

| Control | Endpoint | Writes | Result |
| --- | --- | --- | --- |
| Invite user | `POST /api/users` | `users`, `notification_log` | Temporary password, `must_change_password = true` |
| Edit user | `PATCH /api/users/:id` | `users` | Role change rebuilds their navigation on next load |
| Edit org structure | `PUT /api/users/org-chart` | `users.manager_id` | Reporting line for escalation and rosters. **Not** a permission source |
| Manage integration | route | — | Units linked, sync interval, credentials |
| Reconnect | `POST /api/integrations/:provider/connect` | `integrations` | New API key. Sync resumes from the last successful pull |
| Retry sync | `POST /api/integrations/:provider/sync` | `integrations.last_synced_at` | One provider |
| Settings fields | `PUT /api/settings` | `settings` | Company, locale, operations defaults, statement cycle, security |

---

## 15. Automatic writes with no button

These happen without anyone pressing anything. They are the reason the operational
screens stay correct.

| Trigger | Creates or changes | Rule |
| --- | --- | --- |
| Channel webhook, new reservation | `reservations`, `guests` | Dates blocked on every other channel immediately |
| Channel webhook, cancellation | `reservations.state` | Dates released, any dependent cleaning task cancelled |
| Reservation reaches check-out | `tasks` (cleaning), `units.readiness = dirty` | **Window computed from the next arrival.** This is the core automation |
| Cleaning task completed with photo | `units.readiness = ready` | No separate approval step |
| Maintenance completed with a final amount | `expenses` | Flows into the owner statement for that period |
| Monthly cron, 1st at 01:00 | `owner_statements`, `statement_lines` | Provisional until a human reviews |
| SLA cron, hourly | `tasks.state = overdue` | Plus a check-in-risk alert when a turnover threatens an arrival |
