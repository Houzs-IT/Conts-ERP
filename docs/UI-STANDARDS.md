# UI standards (Property OS)

How every screen in `src/` looks and behaves the same way, the shared pieces to use, and the checks that keep it so.
Run `npm run check` before a pull request; CI (`.github/workflows/ci.yml`) runs it with the typecheck and build on
every pull request.

## 1. Status: one vocabulary, one pill

- Every status word and colour lives in `src/lib/status.ts` (`STATUS_VOCAB`), one map per entity: `booking`,
  `readiness`, `task`, `maintenance`, `cleaning`, `statement`, `payout`, `owner`, `user`, `unit`, `contract`,
  `integration`, `sync`, `automation`, `review`, `condition`, `expense_category`, `calendar`, and the supply chain
  documents (`purchase_order`, `sales_invoice`, ...).
- Stored values never change. Only what people read is decided here. A value missing from a map still reads as words
  ("In transit"), never as the raw code (`IN_TRANSIT`, `checked_in`).
- Show a status with `<StatusBadge entity="booking" value={b.state} />`. A one-off flag that is not a stored status uses
  `<StatusBadge tone="danger" label="Missing ID" />`. A dot beside words: `<StatusDot entity="readiness" value={r} />`.
- Change a status with `<StatusMenu entity value options onPick />` (the booking drawer's menu). Filter by status with
  `<StatusFilterMenu entity off onChange />` (the calendar's Status filter).
- In text (filters, exports, toasts) use `statusLabel(entity, value)`.

## 2. Colour: meaning, not paint

- Tones: `success`, `warning`, `danger`, `info`, `neutral`, `accent` (gold, identity only, never a warning).
- Utilities: `text-{tone}` (readable text colour), `bg-{tone}-bg` (the tint behind it), `border-{tone}-line` /
  `bg-{tone}-line` (dots, borders, fills). Defined once in `src/styles/tokens.css` (`@theme inline`).
- Surfaces and ink keep their names: `bg-card`, `bg-page`, `bg-muted`, `text-ink`, `text-muted-ink`, `border-line`.
- Banned in `src/`: raw hex (`#A8352F`), Tailwind palette shades (`text-red-600`), and status variables pasted into
  arbitrary classes (`text-[var(--color-critical-fg)]`).
- Fixed 10 Oct 2026: `text-critical` / `text-success` used to render the pale tint, because the root `tokens.css`
  defines `--color-critical` etc. as the tint and won over Tailwind's theme. The inline theme block carries the value
  itself, so the utilities are now right everywhere.

## 3. Confirming an action

- One dialog: `ConfirmDialog` (`src/components/ConfirmDialog.tsx`). Say what happens to what, and how to undo it.
- Destructive and money actions (delete, cancel, remove a payment, mark paid, hold) use `danger: true`.
- When the reason must be kept (cancel a booking, remove a block), ask for it with `reason: { placeholder }`; the
  dialog will not go ahead without it and hands it to `onConfirm(reason)` for the audit log.
- From a handler: `const [dialog, ask] = useConfirm(); if (await ask({ ... }) === null) return;` and render `{dialog}`.
- A button that asks first: `<ConfirmButton confirm={{ title, confirmLabel }} onConfirm={remove}>Delete</ConfirmButton>`.
- Never `window.confirm`, `alert` or `prompt`.

## 4. Dates, money, numbers, phones

- Only through `src/lib/format.ts`: `date` (16 Sep 2026), `dateShort`, `dateRange`, `time` (14:06), `dateTime`,
  `weekdayDate` (Sat 10 Oct), `dateTimeShort`, `monthLabel`, `relative`, `rm` (RM 1,250.00), `rmShort`, `rmRange`,
  `amount` (number only, under an RM heading), `count` (4,290), `plural`.
- Phones: `phone(raw)` shows `+60 18-980 0069`, `+65 9123 4567`, `+62 812 3456 7890`, `+63 917 123 4567`, otherwise
  `+<code> <rest>`. Guests' phones are stored as bare digits (`60189800069`) and stay that way. On screen use
  `<PhoneText value={...} />`: tap to call, and a WhatsApp link beside it.

## 5. Errors people can read

- `src/lib/api.ts` turns every failure into one sentence: the server's own message when it is written for people,
  otherwise a plain fallback by error code. Status numbers, SQL, stack traces and platform pages never reach the screen.
- In a `catch`, show `errorMessage(e, 'fallback')`, never `e.message`.
- On the server, an endpoint that throws is caught in `functions/api/_middleware.ts` and answered as
  `INTERNAL` with a plain sentence; the details go to the log.

## 6. Language

- All UI text English. No emoji anywhere (icons are lucide). No Chinese characters in `src/`: the owner workbook's
  sheet and column names live in `functions/_lib/hostplatformImport.ts` and are never shown.

## 7. Server rules

- Every `functions/api/**` handler calls `requireSession` first (directly or through a `_lib` gate such as
  `linkedUnitFor`). Public endpoints are allow-listed with their reason in `scripts/checks/require-session.mjs`.
- Every handler that changes data writes `audit()` (directly or through the `_lib` function it calls). Exceptions are
  allow-listed with their reason in `scripts/checks/require-audit.mjs`.

## The checks

| Check (`scripts/checks/`) | Fails on |
| --- | --- |
| `formatting.mjs` | `toLocaleDateString` / `toLocaleString` / `Intl.*Format` / hand-built `RM ...` outside `format.ts` |
| `colours.mjs` | raw hex, palette shades, `[var(--color-success...)]` classes |
| `no-browser-dialogs.mjs` | `window.confirm`, `alert`, `prompt` |
| `english-only.mjs` | Chinese / Japanese / Korean characters in `src/`; emoji in `src/` or `functions/` |
| `status-pills.mjs` | private `StatusPill` / `Pill`, `<Badge>`, local status maps, rounded pills tinted by hand |
| `require-session.mjs` | an API handler that never checks the session |
| `require-audit.mjs` | a POST / PUT / PATCH / DELETE handler that never writes the audit log |

Each check first runs its matcher on a planted bad sample and a good sample, and fails if the bad one is not caught,
so a broken pattern cannot report a clean codebase. Allow-lists are short and every entry states its reason; fix the
code instead of adding to them. Run one check alone with `node scripts/checks/<name>.mjs`.
