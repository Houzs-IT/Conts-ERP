# Save and data-loss bug classes

The "saved but did not save" and "the screen shows a number the data does not" bugs that the sister systems
(Houzs ERP, Hookka ERP) and this engine have already hit, grouped by shape. Check new save code against this list.
Examples are commits in the Houzs (H) or Hookka (K) repositories, or in this one (C).

## 1. Error swallowed, shown as success

**How to spot it.** A `catch` that logs and still returns 200 or toasts success. A route that answers 200 with
`movementErrors`, `cancelErrors`, `reversalErrors`, `recountError`, `ledger: { posted: false }` and a screen that
never reads the field. A success toast fired before the request is awaited.

**Examples.** H 49e80ffd7 (DO, GRN and SO override half-failed saves read as success). K 417d91b04 (Edit Supplier
refused a save in silence). C: GRN create, GRN line add/edit and delivery returns returned `movementErrors` nobody read.

**How we guard it.** The server reports a partial failure in the body; every frontend hook that calls such a route
passes the response to `reportInBandFailure` (`vendor/scm/lib/mutation-error.ts`), which also reads `recountError`.
In-band failure fields are always lists of strings. `frontend/scripts/check-inband-failures.mjs` counts producers
against readers.

## 2. Partial write without a transaction

**How to spot it.** Two or more dependent writes as separate statements: status then stock, delete lines then insert
lines, journal then settlement loop, reverse then re-post. A failure between them leaves half a document, and a retry
often takes an "already done" early return and never finishes the rest.

**Examples.** H 46629611f, 83f24d437, d69d27420, 198df5716 (GRN post, DO first ship, returns, receipt bank move made
one transaction each). K 847ab1e89 (payroll saves a whole period or nothing).

**How we guard it.** Multi-step money and stock writes run in one SQL transaction (`runScmPgCommand`, `inRenoTx`,
`db.batch`) or one SQL function. Where that is not done yet, the "already done" path must be able to re-run the
missing step, and the step's failure must reach the screen (class 1).

## 3. Stale screen after a save

**How to spot it.** A mutation whose `onSuccess` does not invalidate every query key that shows what it moved, or
invalidates a key nothing reads (typo, wrong prefix). Paged lists (`'<doc>-paged'`) are siblings of `'<doc>'`, not
children. Writes made outside react-query (raw `authedFetch`, `api.post`) refresh nothing by themselves.

**Examples.** H 5c7810697 and 3417810aa (in-flight read dropped; uploads did not clear the read cache).
K d364c382d (customer outstanding did not refresh after a payment). C: SO payments did not refresh the SO header or
money panel; voucher approve/post did not refresh the invoices it settled; PO hold refreshed keys that do not exist.

**How we guard it.** Every successful `useMutation` invalidates all `*-paged` lists (`lib/queryClient.ts`). A write
that moves money or stock invalidates the documents on the other side (invoice for a voucher, PO for a receipt,
`['inventory']` for any stock move, `['mfg-sales-order-detail', docNo]` and `['so-money', docNo]` for SO payments).
A test asserts the keys (`save-refreshes-what-it-moved.test.tsx`).

## 4. One number from two sources

**How to spot it.** A screen, list or PDF shows a figure read from a stored or cached header column (paid, balance,
outstanding, received, invoiced, on hand) next to the rows it summarises, read fresh. Or a stored total that some
write paths update and others do not.

**Examples.** H 2026-09-12 migrated-SO lock: the write-back read `total_revenue_sen`, the screen `local_total_sen`.
K C33 "one business figure computed in several copies that drift". C: the SO PDF "Paid to date" came from a stale
header while the payment list beside it was fresh. `mfg_sales_orders.balance_sen` is the gross total, not a balance
(9 of 9 production orders with payments, 21 Nov 2026), and `paid_sen` is never written.

**How we guard it.** Derive paid / balance from payment rows at read time through one shared rule
(`scm/shared/so-outstanding.ts`, the `balance_sen_live` view column). Never read `mfg_sales_orders.paid_sen` or
`balance_sen` as money owed. A document shows a figure from one source only.

## 5. Lost update (two editors)

**How to spot it.** A header PATCH that re-sends the whole record with no version or `updated_at` check, so the
second Save silently puts back what the first changed.

**Examples.** H 59e4c8d00 and 9cd4708d1 (PO second buyer's Save undid the first; then a DB compare-and-set).
K cd2994974 (a stale SO / PO save is refused instead of overwriting).

**How we guard it.** Documents edited by more than one person carry a `version` column claimed with
`UPDATE ... WHERE version = $loaded` and answer 409 on a miss. The SO header and SO payments have it; POs do not yet.

## 6. Status change without compare-and-set

**How to spot it.** `UPDATE ... SET status = $new WHERE id = $id` with no `AND status = $read`. A late or double
request brings back a cancelled document, or posts twice.

**Examples.** H 50daf5a35 (delivery return), 653b762ab (GRN double confirm). K bfa8690ab (duplicate DO and return
status races). C 5c6b527c, fc6468d7 (DO cancel, GRN confirm).

**How we guard it.** Every status write carries `.eq('status', <status read>)` (or `.neq('status','CANCELLED')` for
cancel) with `maybeSingle()`, and a miss answers 409 `status_changed`. Capture the read status in a const before
any await.

## 7. Double submit

**How to spot it.** Save stays enabled while the request is in flight, or the lock is set after the first await. A
create or payment endpoint without an `Idempotency-Key`, or a key kept after a refusal so the corrected save is
refused.

**Examples.** H 68554fd7c (the same transfer booked twice on an SO, 2 s apart). K a8ee3a316 (PO, GRN and PI create
screens send an idempotency key). C 4c48a0a6, 4080c64c (refused saves release their key).

**How we guard it.** Create and payment screens send one content-bound key per form (`lib/idempotency`); routes
release it on every refusal before the first write. Buttons are disabled from press until everything after the
request settles.

## 8. Slow save (timeout, 504)

**How to spot it.** A save that loops over lines with several awaited queries each, or that waits for a whole-company
recompute (MRP, `recomputeSoStockAllocation`) before answering. The Workers request dies part-way, which is also
class 2.

**Examples.** H ea85df4cd (procurement overview ~380 round trips down to ~90), e8d15cf57 (board reads p95 208 s).
C: the SO area swap returned 504.

**How we guard it.** Batch line writes into one statement (`jsonb_to_recordset`), queue whole-company recomputes
(`deferAllocationRecompute`) instead of awaiting them, and count round trips per line in review.

## 9. A failed read treated as empty or zero

**How to spot it.** `const { data } = await ...` with the error ignored, then `data ?? []` deciding a write: no lines,
nothing to reverse, paid 0. A reversal helper that answers `ok: false, failed: 0` checked only on `failed > 0`.

**Examples.** H beb4c363d (refuse a post when the read in front of it fails), a62c7d234 (a failed read on a money or
stock screen answers an error, not 0). H af903b606 (reads that stopped at 1,000 rows).

**How we guard it.** Every read that feeds a write checks its error and refuses (503) before writing. Reversal
results are checked with `!rev.ok || rev.failed > 0`. Lists read through `paginateAll`, never a bare `.limit()`.

## 10. Lost input

**How to spot it.** A dialog that closes before the save resolves or on failure; a form reset by a refetch while the
user typed during the save; a long form with no draft.

**Examples.** H d269169f0 (a photo stuck on "Uploading" for ever). C 4080c64c (long forms keep a local draft).

**How we guard it.** Close only in `onSuccess`; disable fields while saving; long forms use `useFormDraft`.
