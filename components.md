# The Conts Property OS — component inventory

Maps every UI element in the designs to a component, states it needs, and the
props the domain modules pass in. Shared primitives come from the Houzs and
Hookka foundation and are **never forked to change colour or radius** — they read
`tokens.css`. Domain modules are The Conts-specific compositions.

---

## 1. Shared primitives (reuse as-is)

| Component | Variants | States required | Notes for this product |
| --- | --- | --- | --- |
| `Button` | primary, secondary, tertiary, brandAccent, danger, icon | default, hover, active, focus, loading, disabled | Disabled must render a reason. One primary per decision area. Height 40 desktop / 44 touch. |
| `Input` | text, email, password, number, currency | default, focus, error, disabled, read-only | Label persists above. Placeholder is an example, never a label. Currency variant is right-aligned and tabular. |
| `Select` | single, multi, searchable | default, open, focus, error, disabled | Multi shows selected count and a clear action. |
| `DatePicker` | single, range, time, timezone | default, open, error, disabled | Ranges always disambiguated. Timezone shown explicitly where cross-channel timing matters. |
| `Badge` | semantic status, channel, role | — | Takes `tone` (success/warning/critical/info/neutral) plus required `label`. Renders `-fg` on `bg`, never the `-line` value — the guide's base hexes fail AA at 11px. Gold is not an accepted tone. |
| `Card` | kpi, action, summary, media | default, hover (when interactive), loading skeleton | 12 px radius, 1 px border, no shadow at flat level. |
| `Dialog` | confirmation, edit, destructive | open, closing, submitting, error | States consequence and target in the body, not just the title. |
| `Toast` | success, warning, failure | — | Never the only record of something the user must revisit. |
| `Tabs` | page-level, local | default, active, disabled, overflow | Active tab carries a 2 px gold underline. |
| `Table` | standard 48 px, compact 40 px | loading, empty, filtered-empty, error, row-hover, row-selected | Sticky sentence-case header, visible sort state, money right-aligned. |
| `Pagination` | explicit, virtualised | — | Finance and audit tables always explicit with a stated page size. |
| `FilterBar` | — | default, active-count, cleared | Shows applied filter count and a clear-all. |
| `EmptyState` | first-use, filtered, error, permission | — | Reason plus next action, always. |
| `Skeleton` | text, row, card, chart | — | For predictable blocks. Never over financial values already loaded. |
| `Avatar` | initials, image | — | Initials on charcoal with gold text in the sidebar. |
| `Tooltip` | — | — | Required for any unlabelled icon. |

## 1a. Icons

`lucide-react` **^0.477.0** — already a dependency in both `houzs-erp` and `hookka-erp`.
`hookka-erp/src/components/layout/sidebar.tsx` renders it at 16px with `strokeWidth={1.75}`,
which matches brand guide §7.2. The Conts adds **no second icon family**; it adds a
destination-to-icon map, published in `tokens.json` under `icon.navMap` and `icon.uiMap`.

| Surface | How to render |
| --- | --- |
| React (production) | `import { Wallet } from "lucide-react"` — 16px in tables and the shared sidebar, 17px in The Conts nav, 20px default, 24px for high-level actions |
| HTML (these design files) | `<span class="icon icon-nav" style="--icon:url(https://unpkg.com/lucide-static@0.477.0/icons/wallet.svg)">` — the `.icon` class in `tokens.css` masks the SVG with `currentColor` so it inherits text colour and active states |

Never hand-draw a glyph. If a concept has no lucide icon, compose from two lucide icons or use a label.

The 36 SVGs in `./icons/` were copied from `lucide-icons/lucide` at tag `0.477.0` with `stroke-width`
set to 1.75. They exist only so these HTML previews have no CDN dependency — **production imports
`lucide-react` and should ignore this folder.** Each file carries a provenance metadata block added by
the authoring platform; it does not affect rendering and is stripped by any SVG pipeline.

## 2. Shared patterns (extend through props and slots)

| Pattern | Responsibility | The Conts composition |
| --- | --- | --- |
| `AppShell` | Sidebar, header, content region | Sidebar 240/72 px on `--sidebar-background`; nine nav groups from the session permissions |
| `PageHeader` | Breadcrumb, title, subline, actions | Subline carries period, timezone and last-updated time |
| `DataTable` | Columns, sort, selection, bulk actions | Column sets for bookings, units, statements, operations |
| `FormSection` | Grouped fields, validation, submit | Grouped by user decision, not database structure |
| `AuditTimeline` | Chronological, attributable events | Powers every unit Activity tab, reading `audit_log` |

## 3. Domain modules (The Conts)

| Module | Composed from | Props | Owns |
| --- | --- | --- | --- |
| `KpiRow` | Card | `kpis[]`, `period`, `comparisonPeriod` | Delta formatting; tone comes from the API, never the sign |
| `RevenueTrendChart` | chart primitive | `points[]`, `range`, `onRangeChange` | Charcoal revenue bars, gold occupancy series, direct labels, freshness stamp |
| `ExceptionList` | Card, Badge, Button | `exceptions[]` | One action per row, rendered from the API `action` object |
| `OperationsQueue` | DataTable, Badge | `rows[]`, `filter`, `onAssign` | Risk-first ordering, SLA pill, row edge tone |
| `ReservationCalendar` | table primitive | `units[]`, `blocks[]`, `from`, `to`, `onMove` | Frozen unit column, labelled blocks, drag confirmation and conflict feedback |
| `UnitReadinessBadge` | Badge | `readiness` | The seven readiness states and their tones |
| `UnitRecordHeader` | PageHeader, Tabs, Badge | `unit`, `activeTab` | Seven tabs, live status, active channels, owner and contract |
| `UnitPnl` | Card | `lines[]` | Gross-to-net chain with the net row emphasised |
| `OwnerStatementTable` | DataTable | `statements[]`, `onSend` | Provisional / Not sent / Paid, selection count, send guard |
| `OwnerPayoutHero` | Card | `payout`, `grossToNet[]` | Dark panel, gold figure, paid state, definitions note |
| `FieldTaskList` | Card, Button | `tasks[]`, `onComplete`, `onPhoto` | 44 px targets, access instruction, photo gate, sync state |
| `AssignCleanerDialog` | Dialog, Select | `taskId`, `candidates[]` | Conflict warning when the assignee is double-booked |
| `SyncStatePill` | Badge | `provider`, `state`, `lastSyncedAt` | Connected, expired, degraded, failed — worded honestly |

## 4. Form validation contract

| Field | Rule | Message | When |
| --- | --- | --- | --- |
| Email | RFC-valid, required | Enter a valid work email address. | blur |
| Password | ≥8 chars, ≥1 uppercase, ≥1 digit | Live checklist, no error text until submit | change + submit |
| Check-in / check-out | check-out after check-in | Check-out must be after check-in. | blur |
| Reservation dates | no overlap for that unit | Blocked. {unit} already has {guest} on those dates. | submit (server) |
| Gross booking value | ≥ 0, 2 dp | Enter an amount of RM 0.00 or more. | blur |
| Management fee | 0–100 | Enter a percentage between 0 and 100. | blur |
| Expense | category, amount, date all required | Every expense needs a category, amount and date. | submit |
| Quote approval | amount unchanged since the owner saw it | This quote changed to RM {amount}. Review it again before approving. | submit (server) |
| Task completion | photo when `requiresPhoto` | Add at least one photo before marking this unit ready. | submit |

Field-level rules validate on blur; cross-field rules on submit. User input is
always preserved after a recoverable error.

## 4a. Text on the dark shell

| Need | Token | Ratio |
| --- | --- | --- |
| Body, field labels, anything you must read | `--color-text-on-dark` #DEDAD3 | 13.10:1 |
| Quietest micro labels, corner stamps, stat captions | `--color-text-on-dark-muted` #8A8680 | 5.04:1 |

Never set dark-shell text with a white alpha. `rgba(255,255,255,0.3)` composites to 2.72:1 on the
login canvas and fails AA, and alpha values hide the failure from a quick eyeball check. The smallest
authored font-size anywhere is the 11px micro step.

## 5. Keyboard and focus

| Context | Behaviour |
| --- | --- |
| Global | `/` focuses global search; `Esc` closes the top-most overlay |
| Dialog | Focus trapped, returns to the trigger on close, `Enter` submits the primary action |
| Table | Arrow keys move the row cursor, `Enter` opens the record, `Space` toggles selection |
| Row actions | Reachable by keyboard without hover — never hover-only |
| Focus ring | 2 px with offset, gold on both light and dark surfaces, never removed |
