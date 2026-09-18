# The Conts Property OS — API contracts

Companion to `schema.sql`, `routes.json`, `tokens.css`, `copy.md`.
Conventions for every endpoint:

| Concern | Rule |
| --- | --- |
| Base | `/api` |
| Auth | httpOnly session cookie. `401` unauthenticated, `403` authenticated but not permitted |
| Money | string decimal, 2 dp, `"9260.00"` — never float. Always paired with `currency: "MYR"` |
| Dates | `date` = `"2026-09-16"`; `timestamp` = ISO 8601 UTC. Client renders Asia/Kuala_Lumpur |
| Enums | exactly the values in `schema.sql`. Never send display labels |
| Freshness | list and dashboard responses include `generatedAt` — the UI must show last updated (guide 9.3) |
| Errors | `{ "error": { "code": "...", "message": "...", "fields": { "email": "..." } } }` — `message` is user-safe and follows the what-failed-plus-recovery pattern |
| Paging | `?page=1&pageSize=25` → `{ data, page, pageSize, total }`. Finance and audit tables always explicit (guide 10) |
| Partial failure | return successful content with `"partial": true` and `"failed": [...]`; never fail the whole view (guide 9.3) |

---

## 1. Authentication

### POST /api/auth/login
```json
{ "email": "aina@theconts.com", "password": "..." }
```
**200**
```json
{
  "user": { "id": "uuid", "fullName": "Aina Zulkifli", "email": "aina@theconts.com",
            "role": "operations_manager", "mustChangePassword": false, "locale": "en-MY" },
  "home": "/"
}
```
| Response | Code | UI behaviour |
| --- | --- | --- |
| Success | 200 | Redirect to `home`. If `mustChangePassword` → `/change-password` |
| Wrong credentials | 401 `INVALID_CREDENTIALS` | Inline error block. Preserve the email field (guide 9.2) |
| Locked | 423 `ACCOUNT_LOCKED` + `unlockAt` | Inline error block with the unlock time |
| Inactive | 403 `ACCOUNT_INACTIVE` | Inline error block, route to administrator |

Backend must increment `users.failed_attempts`, set `locked_until = now() + 15 min` at 5, and reset both on success. Response time must not reveal whether the email exists.

### POST /api/auth/forgot-password
`{ "email": "..." }` → **200 always**, body `{ "ok": true }`. Never disclose account existence. Token hashed into `password_reset_tokens`, 60 minute expiry.

### POST /api/auth/reset-password
`{ "token": "...", "password": "..." }` → **200** signs the user in. **410 `TOKEN_EXPIRED`** → UI offers "Request a new link".

### POST /api/auth/change-password
`{ "password": "..." }` → **200** `{ "home": "/" }`. Clears `must_change_password`. Policy enforced server-side as well as in the UI: min 8 chars, ≥1 uppercase, ≥1 digit. **422** returns `fields.password`.

### GET /api/auth/session
→ current user + permissions array, or **401**. Frontend calls this on boot to build navigation.

### POST /api/auth/logout
→ **204**, clears cookie.

---

## 2. Dashboard — `/`

### GET /api/dashboard/kpis?period=2026-09
```json
{
  "generatedAt": "2026-09-16T06:06:00Z",
  "period": "2026-09", "comparisonPeriod": "2026-08",
  "kpis": [
    { "key": "accommodation_revenue", "value": "121900.00", "currency": "MYR",
      "delta": { "value": "9.4", "unit": "percent", "direction": "up", "tone": "success" } },
    { "key": "occupancy", "value": "86.2", "unit": "percent",
      "delta": { "value": "3.1", "unit": "points", "direction": "up", "tone": "success" } },
    { "key": "adr",    "value": "276.00", "currency": "MYR", "delta": { "value": "14.00", "direction": "up", "tone": "success" } },
    { "key": "revpar", "value": "238.00", "currency": "MYR", "delta": { "value": "21.00", "direction": "up", "tone": "success" } },
    { "key": "net_owner_payout", "value": "79416.00", "currency": "MYR", "delta": { "value": "8.2", "unit": "percent", "direction": "up", "tone": "success" } }
  ]
}
```
`tone` is decided by the backend, not the sign of the number — expected seasonality must not render red (guide 12).

### GET /api/dashboard/trend?range=12m
```json
{ "generatedAt": "...", "currency": "MYR",
  "points": [ { "period": "2026-09", "revenue": "122000.00", "occupancy": "86.0", "isCurrent": true } ],
  "totals": { "grossBookingValue": "138410.00", "collectedRevenue": "121900.00",
              "managementFees": "30475.00", "netOwnerPayout": "79416.00" } }
```
`range` ∈ `3m | 12m | ytd`. The three totals are distinct definitions and must never be merged (guide 15.2).

### GET /api/dashboard/today
```json
{ "date": "2026-09-16",
  "rows": [ { "key": "check_ins", "count": 3, "state": "confirmed", "tone": "info" },
            { "key": "cleaning_pending", "count": 5, "state": "dirty", "tone": "warning" } ] }
```

### GET /api/dashboard/exceptions
Ordered by the backend, highest risk first (guide 14.1).
```json
{ "exceptions": [
  { "id": "uuid", "severity": "critical", "state": "overdue",
    "title": "Check-in at risk in 48 minutes",
    "detail": "The Establishment #A-21-02 is Dirty with no cleaner assigned. Guest arrives 15:00.",
    "action": { "label": "Assign cleaner", "kind": "dialog", "target": "AssignCleanerDialog", "taskId": "uuid" },
    "entity": { "table": "units", "id": "uuid" } } ] }
```
`action.kind` ∈ `dialog | route | api`. The frontend renders one action per row — never a menu of maybes.

### GET /api/portfolio/performance?period=2026-09
Rows of `{ unitId, unitNumber, propertyName, ownerName, occupancy, adr, revpar, revenue, rating, exception: { label, tone } | null }`.

---

## 3. Operations today — `/operations/today`

### GET /api/operations/today?date=&building=&filter=
`filter` ∈ `all | checkin_risk | housekeeping | maintenance | unassigned`.
```json
{ "generatedAt": "2026-09-16T06:06:00Z", "date": "2026-09-16",
  "rows": [
    { "id": "uuid", "kind": "turnover",
      "unit": { "id": "uuid", "unitNumber": "#A-21-02", "propertyName": "The Establishment" },
      "work": "Full turnover, 2BR", "note": "No cleaner assigned. Linen set A.",
      "readiness": "dirty",
      "nextGuestAt": "2026-09-16T07:00:00Z",
      "dueAt": "2026-09-16T06:54:00Z",
      "sla": { "state": "overdue", "minutes": -12, "label": "Overdue 12 min", "tone": "critical" },
      "assignee": null,
      "action": { "label": "Assign cleaner", "kind": "dialog", "target": "AssignCleanerDialog" },
      "riskRank": 1 } ] }
```
The backend owns `riskRank` and `sla`. The client must not recompute SLA from clock drift.

### POST /api/housekeeping/tasks/:id/assign
`{ "assigneeId": "uuid" }` → **200** task. **409 `ASSIGNEE_BUSY`** → `"Nurul has 2 overlapping tasks at 13:45. Assign anyway?"` (dialog offers `?force=true`).
Writes `tasks.assignee_id`, `state = assigned`, audit `task.assign`, and notifies the assignee.

### POST /api/tasks/:id/complete
`{ "photoIds": ["uuid"], "note": "..." }` → **200**. **422 `PHOTO_REQUIRED`** when `requires_photo` and none supplied. Sets `state = resolved`, `completed_at`, and `units.readiness = ready` for turnover and inspection kinds.

### POST /api/tasks/:id/photos
multipart `file` → **201** `{ documentId }`. Field app may queue offline; response is the only thing that flips the UI to synced (guide 19).

---

## 4. Reservations

### GET /api/reservations/calendar?from=&to=&propertyId=
```json
{ "from": "2026-09-16", "to": "2026-09-29",
  "units": [ { "id": "uuid", "unitNumber": "#A-12-03", "propertyName": "Vista Jaya One" } ],
  "blocks": [ { "id": "uuid", "unitId": "uuid", "channel": "airbnb", "state": "checked_in",
                "guestName": "Nadia Abdullah", "checkIn": "2026-09-13", "checkOut": "2026-09-16",
                "label": "Airbnb · Checked in" } ] }
```
`label` is server-provided so channel and status never depend on colour (guide 14.4).

### POST /api/reservations
`{ unitId, channel, guest: { fullName, email, phone }, checkIn, checkOut, guestsCount, grossBookingValue }` → **201**. **409 `DATE_CONFLICT`** with `conflict: { reservationId, guestName, checkIn, checkOut }` → UI copy: `"Blocked. {unit} already has {guest} on those dates."`

### PATCH /api/reservations/:id/dates
`{ checkIn, checkOut, confirm: true }` → **200**. Without `confirm` returns **428 `CONFIRMATION_REQUIRED`** with the consequence sentence for the dialog. Drag on the calendar always round-trips this (guide 14.4).

### POST /api/reservations/:id/cancel
`{ reason }` → **200**. Dialog copy: "Cancel this reservation? This releases the dates and notifies the guest."

---

## 5. Units and properties

### GET /api/units?propertyId=&readiness=&ownerId=&q=
Rows of `{ id, unitNumber, propertyName, ownerName, readiness, occupancy, adr, isListed }`.

### GET /api/units/:id
```json
{ "id": "uuid", "unitNumber": "#A-12-03",
  "property": { "id": "uuid", "name": "Vista Jaya One", "addressLine": "C-41-06, Jaya One, Jalan Universiti", "city": "Petaling Jaya", "postcode": "46200" },
  "owner": { "id": "uuid", "displayName": "Lim Chee Keong" },
  "contract": { "managementFeePct": "25.00", "renewsOn": "2027-03-01" },
  "readiness": "occupied",
  "channels": ["airbnb", "booking_com", "direct"],
  "stats": { "occupancy": "94.1", "adr": "284.00", "revpar": "267.00", "rating": "4.92", "openIssues": 1 },
  "stays": { "current": { "guestName": "Nadia Abdullah", "channel": "airbnb", "checkIn": "2026-09-13", "checkOut": "2026-09-16", "state": "checked_in" },
             "next":    { "guestName": "Aaron Lee", "channel": "direct", "checkIn": "2026-09-16", "state": "confirmed" } },
  "lastUpdated": { "at": "2026-09-16T06:14:00Z", "by": "Aina Zulkifli" } }
```

### GET /api/units/:id/pnl?period=2026-08
`{ lines: [ { label, amount, type } ], netPayout }` — `type` ∈ `gross | fee | expense | adjustment | net`. Requires a finance-permitted role.

### GET /api/units/:id/maintenance | /reservations | /documents | /activity
Tab payloads. `activity` is chronological, attributable and filterable: `{ actorLabel, action, occurredAt, before, after, source }` straight from `audit_log` (guide 14.3).

### GET /api/access-credentials?unitId=
`secret` is returned **masked** (`"••••17#"`) unless `?reveal=true` with an operations or management role; a reveal writes `audit_log` (`access.reveal`).

---

## 6. Maintenance

### POST /api/maintenance/issues
`{ unitId, title, detail, photoIds, blocksUnit, quotedAmount, chargeTo }` → **201**. Created by the field app's "Report damage or missing item". Sets `state = open` and, when `blocksUnit`, `units.readiness = maintenance`.

### POST /api/maintenance/issues/:id/approve
Owner-portal action on a `waiting` issue. `{ approved: true }` → **200**, writes `owner_approved_at`, moves to `assigned`, and creates the expense when work completes.

---

## 7. Finance

### GET /api/statements?period=2026-08&status=
```json
{ "generatedAt": "2026-09-16T06:06:00Z",
  "filtersApplied": { "period": "2026-08", "building": "all" },
  "page": 1, "pageSize": 25, "total": 19,
  "summary": { "notSent": 2, "netTotal": "79416.00" },
  "data": [ { "id": "uuid", "owner": { "id": "uuid", "displayName": "Lim Chee Keong" },
              "unitsLabel": "Vista Jaya One #A-12-03",
              "grossBookingValue": "9260.00", "managementFee": "2315.00",
              "expensesTotal": "463.00", "netPayout": "6482.00",
              "state": "paid", "currency": "MYR" } ] }
```
`filtersApplied` and `generatedAt` are mandatory — exports must print them (guide 10).

### POST /api/statements/generate
`{ "period": "2026-08", "ownerIds": [] }` → **202** `{ jobId, count }`. Statements land in `provisional`. **409 `PERIOD_LOCKED`** if already finalised.

### POST /api/statements/send
`{ "statementIds": ["uuid"] }` → **200** `{ sent: 2, failed: [] }`. Only `finalised` statements may be sent; `provisional` returns **422 `NOT_FINALISED`**. Partial failures return the successful count plus a `failed` array — the UI keeps the sent ones and names only what failed.

### GET /api/statements/:id/pdf → `application/pdf`
### GET /api/statements/export?period=&format=csv|xlsx
Export includes a header block with applied filters, generated time and scope.

---

## 8. Owner portal (scoped to the signed-in owner)

Every endpoint derives `owner_id` from the session. A mismatched `?ownerId` is **403**, never a silent empty list.

### GET /api/owner/summary?period=2026-08
```json
{ "period": "2026-08", "isFinal": true,
  "payout": { "amount": "6482.00", "currency": "MYR", "state": "paid",
              "paidAt": "2026-09-03", "bankLast4": "4417" },
  "grossToNet": [
    { "label": "Gross booking value", "amount": "9260.00", "type": "gross" },
    { "label": "Management fee · 25%", "amount": "-2315.00", "type": "fee" },
    { "label": "Housekeeping · 11 turnovers", "amount": "-385.00", "type": "expense", "category": "housekeeping" },
    { "label": "Maintenance · aircon service", "amount": "-78.00", "type": "expense", "category": "maintenance", "reference": "INV-2026-0912" },
    { "label": "Net payout", "amount": "6482.00", "type": "net" } ],
  "stats": { "occupancy": "94.1", "adr": "284.00", "bookings": 11, "rating": "4.92" } }
```
`isFinal: false` must render the provisional-data notice (guide 15.2).

### GET /api/owner/trend?months=8 · GET /api/owner/property-health · GET /api/owner/documents
Property health returns factual, owner-safe language only — no internal shorthand (guide 15.2).

---

## 9. Field app

### GET /api/field/tasks?date=today
Assigned tasks for the signed-in user, ordered by `dueAt`. Each row carries `unit`, `addressLine`, `accessInstruction`, `work`, `dueAt`, `readiness`, `flag`, `requiresPhoto`, `sync`. **Never** includes revenue, fees or payout fields (guide 16.1).

### POST /api/field/sync
`{ "mutations": [ { "clientId": "...", "op": "task.complete", "payload": {...}, "queuedAt": "..." } ] }`
→ **200** `{ "results": [ { "clientId": "...", "state": "synced" | "failed", "error": {...} } ] }`. The client shows queued until this returns, and failed rows stay visibly failed.

---

## 10. System

### GET /api/integrations
`[ { provider, state, lastSyncedAt, lastError } ]` — `state` distinguishes connected, expired, degraded, failed so the shell can render the sync pill honestly.

### GET /api/users · POST /api/users · PATCH /api/users/:id
Invite creates the user with `must_change_password = true` and emails a temporary password.

### GET /api/audit?entityTable=&entityId=&actorId=&from=&to=
Paged audit trail: actor, timestamp, before, after, source.

---

## 11. Validation rules the backend must enforce

| Rule | Reason |
| --- | --- |
| Password: ≥8 chars, ≥1 uppercase, ≥1 digit | Matches the UI checklist; never trust the client |
| `check_out > check_in` | DB `CHECK` plus API validation |
| No overlapping reservations per unit | DB `EXCLUDE` constraint; API returns the conflicting reservation |
| Statement may only be sent when `finalised` | Prevents provisional numbers reaching owners |
| `management_fee_pct` between 0 and 100 | Contract integrity |
| Expense requires category, amount, `incurred_on` | Every deduction is explainable (guide 15.2) |
| Task completion requires a photo when `requires_photo` | Evidence for ready-for-guest |
| Owner queries scoped by session `owner_id` | Least privilege |
| Field-role responses exclude financial fields | Guide 16.1 |
| Financial mutations write `audit_log` with before and after | Guide 19 |
