# Conts ERP — UI copy and status vocabulary

Older copy list, kept in step with docs/VOCABULARY.md (which wins where they differ). Voice rules: sentence case, direct, specific, calm,
accountable, human, consistent (guide 5.4, 18). Verb-first for actions, concise nouns for navigation.
Keys are stable; English is the default locale with `ms-MY` and `zh-Hans` planned (guide 17).
Allow 30% text expansion without clipping.

---

## 1. Status vocabulary — closed lists

**Colour note.** Each tone resolves to three tokens, not one: `--color-{tone}` (tint background),
`--color-{tone}-fg` (badge TEXT, measured >= 4.5:1 on that tint) and `--color-{tone}-line` (dot,
border, chart, fill). The brand guide's §4.2 base hexes fail AA as 11px badge text on their own
tints, so they are retained as `-line` and the text foregrounds are darkened. See tokens.json
`semantic.$accessibilityCorrection` — this is an open item to take back to the client.

Display labels are fixed. **Never** introduce synonyms (Complete / Completed / Done) for one state (guide 11).

### Reservation
| Enum | Label | Tone | Meaning |
| --- | --- | --- | --- |
| `inquiry` | Inquiry | neutral | No confirmed reservation |
| `pending` | Pending | warning | Awaiting payment or confirmation |
| `confirmed` | Upcoming | info | Reservation accepted |
| `checked_in` | Currently hosting | success | Guest currently in the unit |
| `checked_out` | Past | neutral | Reservation finished |
| `cancelled` | Cancelled | neutral (critical when action required) | Reservation cancelled |
| `no_show` | No-show | critical | Guest did not arrive |

### Unit readiness
| Enum | Label | Tone |
| --- | --- | --- |
| `occupied` | Occupied | info |
| `dirty` | Dirty | warning |
| `cleaning` | Cleaning | info |
| `inspection` | Inspection | warning |
| `ready` | Ready | success |
| `maintenance` | Maintenance | critical |
| `blocked` | Blocked | neutral |

### Task and issue
| Enum | Label | Tone |
| --- | --- | --- |
| `open` | Open | neutral |
| `assigned` | Assigned | info |
| `in_progress` | In progress | info |
| `waiting` | Waiting | warning |
| `resolved` | Resolved | success |
| `overdue` | Overdue | critical |
| `reopened` | Reopened | critical |

### Statement, payout, channel, sync
| Enum | Label |
| --- | --- |
| `provisional` / `finalised` / `sent` / `paid` | Draft / Final / Sent / Paid |
| `pending` / `processing` / `paid` / `failed` | Pending / Processing / Paid / Failed |
| `airbnb` / `booking_com` / `agoda` / `direct` / `maintenance_block` / `owner_stay` | Airbnb / Booking.com / Agoda / Direct / Repair / Owner stay |
| `queued` / `synced` / `failed` | Waiting to send / Sent / Not sent |

---

## 2. Navigation labels

Group labels are the only uppercase strings besides the wordmark (guide 5.4).

```
OVERVIEW        Dashboard · Portfolio
RESERVATIONS    Reservations · Calendar · Guests
OPERATIONS      Today · Cleaning · Maintenance
UNITS           Units · Owners · Contracts · Fit-out register
MONEY           Owner statements · Owner payouts · Expenses · Approvals
OWNERS          Owners · Contracts
PERFORMANCE     Analytics · Pricing · Reviews
COMMUNICATION   Messages · Automations
SYSTEM          Users and roles · Integrations · Settings
```

---

## 3. Authentication

| Key | String |
| --- | --- |
| `auth.login.heading` | Sign in |
| `auth.login.sub` | Use the work email your administrator invited. |
| `auth.field.email` | Email |
| `auth.field.email.placeholder` | you@theconts.com |
| `auth.field.password` | Password |
| `auth.field.password.placeholder` | Enter password |
| `auth.action.show` / `auth.action.hide` | Show / Hide |
| `auth.login.submit` | Sign in |
| `auth.login.forgot` | Forgot password? |
| `auth.login.ownerNote` | Unit owners sign in at the owner portal. |
| `auth.login.ownerLink` | Go to owner portal |
| `auth.error.invalid` | Invalid email or password. Five failed attempts lock the account for 15 minutes. |
| `auth.error.locked` | Account locked for 15 minutes after five failed attempts. Try again at {time} or ask an administrator to reset it. |
| `auth.error.inactive` | This account is inactive. Ask an administrator to reactivate it. |
| `auth.error.network` | Could not reach the server. Check your connection and try again. |
| `auth.forgot.heading` | Reset your password |
| `auth.forgot.sub` | Enter your work email and we will send a reset link. |
| `auth.forgot.submit` | Send reset link |
| `auth.forgot.sent` | If that email belongs to a Conts ERP account, a reset link is on its way. The link expires in 60 minutes. |
| `auth.forgot.back` | Back to sign in |
| `auth.reset.expired` | This reset link has expired. Request a new one. |
| `auth.change.heading` | Set a new password |
| `auth.change.sub` | Your invitation used a temporary password. Choose a new one to continue. |
| `auth.change.field` | New password |
| `auth.change.submit` | Save and continue |
| `auth.policy.title` | Password requirements |
| `auth.policy.length` | At least 8 characters |
| `auth.policy.upper` | At least 1 uppercase letter |
| `auth.policy.digit` | At least 1 digit |
| `auth.session.expired` | Your session expired. Sign in to continue. |

---

## 4. Dashboard

| Key | String |
| --- | --- |
| `dash.title` | Dashboard |
| `dash.sub` | {period} to date · Asia/Kuala Lumpur · last updated {time} |
| `dash.action.primary` | Add unit |
| `kpi.accommodation_revenue` | Earnings |
| `kpi.occupancy` | Occupancy |
| `kpi.adr` | Avg nightly price |
| `kpi.revpar` | Earnings per available night |
| `kpi.net_owner_payout` | Net Payout to Owner |
| `kpi.comparison` | vs {period} |
| `dash.trend.title` | Earnings and occupancy trend |
| `dash.trend.sub` | Earnings, RM · occupancy, % of available nights |
| `dash.trend.range` | 3 months / 12 months / Year to date |
| `dash.totals.gross` | Guest total |
| `dash.totals.collected` | Earnings |
| `dash.totals.fees` | Operator share |
| `dash.totals.net` | Net Payout to Owner |
| `dash.today.title` | Today |
| `dash.today.link` | Open operations |
| `dash.today.checkIns` | Check-ins |
| `dash.today.checkOuts` | Checkouts |
| `dash.today.cleaning` | Cleaning pending |
| `dash.today.maintenance` | Maintenance open |
| `dash.today.escalations` | Guest escalations |
| `dash.exceptions.title` | Needs attention |
| `dash.portfolio.title` | Portfolio performance |
| `dash.portfolio.sub` | {units} units · {buildings} buildings · {period} to date |
| `dash.portfolio.link` | View all units |
| `table.col.unit` | Unit |
| `table.col.occupancy` | Occupancy |
| `table.col.adr` | Avg nightly price |
| `table.col.revpar` | Earnings per available night |
| `table.col.revenue` | Earnings |
| `table.col.exception` | Exception |
| `table.exception.none` | None |

---

## 5. Operations today

| Key | String |
| --- | --- |
| `ops.title` | Today |
| `ops.sub` | {date} · {count} items need action before the next check-in |
| `ops.action.primary` | Assign cleaner |
| `ops.filter.all` | All work |
| `ops.filter.risk` | Check-in risk |
| `ops.filter.housekeeping` | Cleaning |
| `ops.filter.maintenance` | Maintenance |
| `ops.filter.unassigned` | Unassigned |
| `ops.table.title` | All work, highest risk first |
| `ops.table.sub` | Sorted by risk, then time · last updated {time} |
| `ops.col.work` | Work |
| `ops.col.readiness` | Readiness |
| `ops.col.nextGuest` | Next guest |
| `ops.col.sla` | Time allowed |
| `ops.col.assignee` | Assignee |
| `ops.assignee.none` | Unassigned |
| `sla.overdue` | Overdue {duration} |
| `sla.due` | Due in {duration} |
| `sla.onTrack` | On track |
| `sla.escalated` | Escalated |
| `sla.none` | No deadline |
| `ops.action.assign` | Assign cleaner |
| `ops.action.open` | Open job |
| `ops.action.confirmGuest` | Confirm with guest |
| `ops.action.startInspection` | Start inspection |
| `ops.action.updateOwner` | Update owner |

---

## 6. Calendar

| Key | String |
| --- | --- |
| `cal.title` | Calendar |
| `cal.sub` | {units} units · {from} to {to} · all channels |
| `cal.action.primary` | Add reservation |
| `cal.note` | Channel and status are labelled on every block; colour is never the only signal. Dragging a block asks for confirmation and reports conflicts before saving. |
| `cal.drag.confirm` | Move {guest} to {range}? This updates the channel and notifies the guest. |
| `cal.drag.conflict` | Blocked. {unit} already has {guest} on those dates. |
| `cal.cell.available` | Available |

---

## 7. Unit record

| Key | String |
| --- | --- |
| `unit.tabs` | Overview · Reservations · Operations · Financials · Maintenance · Documents · Activity |
| `unit.owner` | Owner |
| `unit.contract` | Contract · {pct}% To Operator · renews {date} |
| `unit.stat.openIssues` | Open maintenance jobs |
| `unit.stays.title` | Current and next reservation |
| `unit.pnl.title` | Monthly profit and loss |
| `unit.pnl.gross` | Gross Income |
| `unit.pnl.fee` | {pct}% To Operator |
| `unit.pnl.housekeeping` | Basic Cleaning Fee · {count} cleaning jobs |
| `unit.pnl.maintenance` | Maintenance |
| `unit.pnl.net` | Net Payout to Owner |
| `unit.maintenance.title` | Maintenance and inventory |
| `unit.maintenance.sub` | Fitted out by The Conts · {date} |
| `unit.updated` | Updated by {actor} at {time} · full activity trail on the Activity tab |

---

## 8. Owner statements

| Key | String |
| --- | --- |
| `stmt.title` | Owner statements |
| `stmt.sub` | {period} period · {count} statements not yet sent |
| `stmt.action.generate` | Generate statements |
| `stmt.action.send` | Send {count} statements |
| `stmt.action.export` | Export |
| `stmt.filters` | Filters applied: period {period}, {buildings} · generated {time} |
| `stmt.col.owner` | Owner |
| `stmt.col.gross` | Gross Income |
| `stmt.col.fees` | Fees |
| `stmt.col.expenses` | Expenses |
| `stmt.col.net` | Net Payout to Owner |
| `stmt.col.status` | Status |
| `stmt.footer.count` | {shown} of {total} owners · page size {size} |
| `stmt.footer.note` | Every deduction carries a category, date, amount and reference |
| `stmt.confirm.send` | Send {count} statements to owners? Owners receive an email and portal notification. |
| `stmt.success.send` | {count} statements sent. |
| `stmt.success.generate` | Statements generated for {count} owners. Review before sending. |
| `stmt.error.notFinalised` | {count} statements are still drafts and were not sent. Mark them final first. |
| `stmt.error.generate` | Statement could not be generated. Check the date range and try again. |

---

## 9. Owner portal

Lower density, simpler language, no internal shorthand (guide 15).

| Key | String |
| --- | --- |
| `owner.title` | Your unit |
| `owner.payout.label` | Net Payout to Owner · {period} |
| `owner.payout.paid` | Transferred {date} · {bank} ····{last4} |
| `owner.payout.pending` | Scheduled for {date} |
| `owner.grossToNet.title` | Gross to net |
| `owner.grossToNet.note` | Gross Income is the total before the Expense Deduction and the operator's share. |
| `owner.final` | Final statement. |
| `owner.provisional` | Draft figures. This statement is not final and may change. |
| `owner.trend.title` | Earnings over time |
| `owner.trend.sub` | Net Payout to Owner, RM · last {months} months · {unit} |
| `owner.health.title` | Unit health |
| `owner.docs.title` | Documents |
| `owner.docs.download` | Download |
| `owner.approve` | Approve quote |
| `owner.approve.confirm` | Approve RM {amount} for {title}? The Conts will schedule the work and deduct the amount from your next statement. |
| `owner.stat.bookings` | Reservations |
| `owner.stat.rating` | Guest rating |

---

## 10. Field app

| Key | String |
| --- | --- |
| `field.title` | My jobs |
| `field.sub` | {date} · {count} jobs assigned · works offline |
| `field.progress` | {done} of {total} jobs done |
| `field.access` | Access · {instruction} |
| `field.due` | Due {time} |
| `field.action.photo` | Add photo |
| `field.action.ready` | Mark ready |
| `field.action.damage` | Report damage or missing item |
| `field.action.call` | Call operations |
| `field.confirm.ready` | Mark {unit} ready for guest? Next check-in is {time}. |
| `field.error.photoRequired` | Add at least one photo before marking this unit ready. |
| `field.sync.queued` | Waiting to send · sends when you are back online |
| `field.sync.synced` | Sent {time} |
| `field.sync.failed` | Not sent. Tap to try again. |
| `field.finance.note` | Money figures are not shown to cleaners and technicians. |

---

## 11. Microcopy patterns (guide 18.1)

| Situation | Pattern | Example in this product |
| --- | --- | --- |
| Confirmation | Action plus target | Assign Nurul to Trion B-32-05? |
| Destructive | Consequence plus recovery | Cancel this reservation? This releases the dates and notifies the guest. |
| Empty state | Reason plus next action | No maintenance jobs match these filters. Clear filters. |
| Error | What failed plus recovery | Statement could not be generated. Check the date range and try again. |
| Success | Completed action and result | Cleaner assigned. Nurul has been notified. |
| Permission | Restriction plus route | You can view this owner payout but cannot edit it. Ask a Finance Admin for access. |
| Disabled action | Explain why | Cannot send. This statement is still a draft. |

## 12. Empty and system states

| Key | String |
| --- | --- |
| `empty.filtered` | No {entity} match these filters. |
| `empty.filtered.action` | Clear filters |
| `empty.firstUse.units` | No units yet. Add your first unit to start tracking readiness and earnings. |
| `empty.error` | This list could not load. Check your connection and try again. |
| `empty.error.action` | Retry |
| `empty.notDesigned` | {destination} is not designed yet. |
| `system.lastUpdated` | Last updated {time} |
| `system.sync.connected` | Connected to {provider} · last sent {time} |
| `system.sync.expired` | {provider} connection expired. Reconnect to keep the channels up to date. |
| `system.sync.degraded` | {provider} is slow. Some reservations may arrive late. |
| `system.sync.failed` | Not sent to {provider} at {time}. |
| `system.partial` | Some data could not load: {list}. Everything else is current. |

## 13. Formatting rules

| Value | Format | Example |
| --- | --- | --- |
| Currency, cents matter | `RM #,##0.00` | RM 12,450.00 |
| Currency, KPI card | `RM #,##0` | RM 12,450 |
| Percent | one decimal, with sign | 82.4% |
| Rating, detail view | `0.00 / 5` | 4.91 / 5 |
| Date, compact | `D MMM YYYY` | 16 Sep 2026 |
| Date range | always disambiguated | 16 Sep – 29 Sep 2026 |
| Time | 24-hour, MYT where cross-channel | 15:00 · 14:06 MYT |
| Negative deduction | minus sign, semantic colour only when it is a problem | − RM 2,315.00 |
| Unit reference | `{Building} {#unit}` | Vista Jaya One #A-12-03 |
