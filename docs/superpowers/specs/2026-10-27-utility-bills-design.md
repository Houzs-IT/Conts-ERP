# Utility bills: late bills, backfill and OCR (Property OS)

Date: 2026-10-27. Owner: chew (finance). Status: design agreed with chew in chat on 2026-10-27; plan to follow.

Scope: three pieces of work on Property OS (the repo root: `src/`, `functions/`, schema `pos`), built in this order because each needs the one before:

1. **Late bills.** A utility bill keeps the month on the bill; if that month's owner statement is already final, the bill is deducted on the next statement that is not final.
2. **Backfill.** Load January–October 2026 utility bills from chew's AutoCount payment listings and original bills, under the rules in §4.
3. **OCR.** Upload scanned bills (TNB, management-office water, Indah Water, internet), read them with Claude, match each to a unit, a person confirms, the bill is recorded with its page as the receipt.

Two further pieces were discussed and are recorded in §7 for later designs: the utility listing screen and the unit cost-to-income analysis.

All product text is English with British spelling (chew, 2026-10-27). Chat with chew is in Chinese.

---

## 1. Why

- chew keys utility bills in Property OS (SOP 3.10 in `docs/finance/FINANCE-SOP.md`). Bills arrive late: "有时我是月尾才收到或下个月才收到". Today a bill whose month is final cannot be saved at all (`PERIOD_LOCKED`), so staff date it a month later. Most water bills are recorded one month after the month printed on them (found when comparing the listings, §4). The record is then wrong for usage analysis.
- chew wants the record to carry the real month and the owner to be charged once, on the first statement that can still take it: "这个是记录 utility，这样就根据对的月份；owner report 如果这个月没有扣到就下个月扣".
- Bills are scans. TNB masks part of the account number and the unit. chew will not hand-write on them ("过后我不会手写哦"). Keying ~250 bills a month by hand is the cost being removed.
- Uncertain matches must never be recorded silently: "认不出或不确定就不能随便放".

## 2. Goals, non-goals, anti-goals

Goals
- A utility bill has a **bill month** (what the bill is for) and a **deduction month** (which owner statement takes it). They are equal unless the bill month was already final when the bill was saved.
- A bill can be **record only**: kept for history and analysis, never on an owner statement.
- The backfill loads the listings' missing bills without changing any final statement's figures by one sen.
- OCR proposes a unit for every page with a confidence (green / amber / red); nothing is saved until a person confirms; amber and red need a person to choose the unit.
- The system learns each account's fingerprint so next month's bills match on their own.

Non-goals
- Other expense kinds (maintenance, cleaning, supplies) keep today's behaviour: a final month refuses them.
- No automatic payment of bills, no bank matching, no change to the ERP (engine/).
- No usage (kWh, m³) analytics yet; OCR stores readings, the listing/analysis designs use them later.

Anti-goals (a failure even if it works)
- An owner charged twice for one bill, or a final statement's total changing.
- A bill attached to the wrong unit without a person having confirmed it.
- Bill images sent anywhere except Anthropic (chew approved Claude, "跟 ERP 一样用 Claude").

## 3. Late bills (piece 1)

### 3.1 Data

Migration on `pos.expenses` (number: next free on `origin/main` at build time; `origin/main` is at 0173 today):
- `deduct_month text` — `YYYY-MM`, the owner statement month that takes this expense. Back-filled for every existing row as `left(incurred_on, 7)`; `NOT NULL` after the back-fill.
- `record_only boolean NOT NULL DEFAULT false` — true means never on an owner statement.
- An index on `(unit_id, deduct_month)` for the statement load.

`incurred_on` stays the bill date (bill month = `left(incurred_on, 7)`), so every report that reads usage by `incurred_on` keeps working.

### 3.2 Rules

- **On save of a utility bill** (categories `electricity`, `water`, `internet`, `sewerage`) charged to the owner:
  - bill month not final for that unit's owner → `deduct_month = bill month`;
  - bill month final → `deduct_month` = the first month after it whose statement for that owner is not `finalised`, `sent` or `paid` (a month with no statement yet counts as open). "Final" is exactly `LOCKED_SQL` in `functions/_lib/expenses.ts:20`.
  - The save is refused only when the bill would **replace** an existing bill for the same account and bill month whose deduction month is final (editing a bill that is already on a final statement stays forbidden).
- `deduct_month` is fixed at save time. It is recomputed only when the bill is edited while its current deduction month is still open.
- **Statements read `deduct_month`**, not `incurred_on`: in `functions/_lib/ownerStatement.ts` the cost query in `loadInputs` (`:426-429`) and the month filters in `computeMonth` (`:486`) and `computeUnitMonth` (`:259`) select `charge_to = 'owner' AND NOT record_only AND deduct_month = <month>` (for a range: `deduct_month` in the range). Every caller of these (statements generate, owner report `functions/api/portfolio/owner-report.ts`, unit P&L `functions/_lib/unitPnl.ts`, year-to-date) then agrees with the statements. The builder audits other readers of owner-charged expenses by `incurred_on` (`functions/_lib/unitCosts.ts`, `functions/api/finance/expenses.ts`, `src/lib/ownerOverall.ts` inputs) and switches the ones that mean "what the owner was charged" to `deduct_month`; ones that mean "what was used" stay on `incurred_on`.
- **Statement line wording** when `deduct_month ≠ bill month`: the line's description gets the bill month and "(late bill)", e.g. "Water Apr 2026 (late bill)", on the statement screen, PDF and owner portal.
- **Utility bills screen** (`functions/api/expenses/utilities.ts`, `ExpensesPage` utilities mode): the POST no longer skips final months; it saves with the rolled `deduct_month` and returns, per row, `deductMonth` when it differs from the bill month. The screen tells the user before saving: "Apr 2026 is final. This bill will be deducted on the May 2026 statement." The GET returns `deductMonth` and `recordOnly` per bill.
- `record_only` bills skip the receipt rule (`src/lib/receipts.ts` `receiptRequired` gains the condition) and never reach a statement. Only the backfill (and later an explicit control) sets it; the normal screens do not offer it yet.

### 3.3 Checks (tests)

API checks in `scripts/api-checks/` (the project's endpoint test style, `harness.mjs`):
- bill for an open month → on that month's statement;
- bill for a final month → saved, `deduct_month` = next open month, on that statement with "(late bill)", final statement unchanged;
- two consecutive final months → the third month takes it;
- replacing a bill already on a final statement → refused;
- `record_only` bill → on no statement, no receipt needed;
- regenerating a provisional statement twice never doubles a late bill.
A `src/lib/*.test.mjs` unit test for the "first open month" function.

## 4. Backfill (piece 2)

A one-off script, run by Claude Code with chew's approval, writing to production through the `supabase-conts-prod` MCP connection only (project `cweomoenhsjvsxfsmiiw`). It runs after piece 1 is live.

### 4.1 Inputs

- AutoCount PV listings (local, not committed): `ABNB ELECTRICAL (JAN26 - OCT26).xlsx`, `ABNB WATER PV (JAN26 - OCT26).xlsx` (includes Indah Water rows: description contains `IWK` / `INDAH`), `ABNB WIFI PV (JAN26 - OCT26).xlsx`. Columns: Date, Acc. Desc, Proj. No. (unit code), Ref. 1 (PV no.), Desc. (bill month, e.g. `TNB AUG26`, `APRIL26`, `IWK JUL - DEC26`), Home DR (RM).
- Original bills (local, personal data, never published): electricity Aug/Sep/Oct, water Aug/Sep, internet Sep/Oct, Indah Water.
- The comparison already built: `exports/水电费对比-2026-10-27.xlsx` (matching logic in the session scratchpad `util-compare.cjs`; the builder ports it into the backfill script).

### 4.2 Rules (decided with chew, 2026-10-27)

| Case | Action |
|---|---|
| Listing and system agree (amount within 5 sen) | Nothing. |
| Jan–Aug (final months), in the listing, not in the system | Insert as `record_only`, bill month from the description. No owner charge, no receipt. |
| Jan–Aug, both have it but amounts differ | Do not change the system amount (the owner was settled on it). Report the total difference per owner in one line to chew. "这个要特别注意." |
| Sep–Oct (open), in the listing, not in the system | Insert, charged to the owner, `deduct_month` = bill month. Amount from the original bill where there is one (the listing only checks it); the bill page is uploaded as the receipt. A listing row with no original bill uses the listing amount and is counted in the report. |
| Before 2026 | Not loaded. |
| Unit codes mapped by chew | `D-4204` → SV2 D4203(A). Skipped: `B-4205`, `A1503A` (stopped), `A-0518`, `S-2005` (new, no unit yet), `B-13A07`, `B1908` (renovation showrooms), `OFF & WH` (company office and warehouse). |
| Split units sharing one meter (B16-05 (A)/(B), etc.) | Record on one side: the side that already has that kind of bill; Trion B56-06 → (A). |
| Same unit, kind and bill month both under `D-4204` and `D4203A` | Stop and ask chew (possible double payment). |
| Half-year Indah Water bills (`JUL - DEC26`) | Bill month = first month of the period. |

**Relabelling existing water records.** Existing bills that the comparison shows were entered a month late (the per-unit shift in `util-compare.cjs`) get their `incurred_on` moved to the real bill month while their `deduct_month` stays where it was. Statements and the owner report do not change (they read `deduct_month`); the usage record becomes right. This is my call following chew's rule "根据对的月份"; it is listed for chew's check.

### 4.3 Safety

- Before writing: a dry run that prints counts per rule and total RM charged to owners for Sep–Oct; chew sees the one-line summary and says go.
- One transaction. Afterwards, for every statement with state `finalised`, `sent` or `paid`, the totals computed by the statement engine before and after must be identical; any difference rolls back and stops.
- Each inserted row: `created_by` = a backfill marker, `reference` = account number or the PV number, description as the utilities screen writes it.

## 5. OCR (piece 3)

### 5.1 Flow (as played back to chew and approved)

1. On the Utility bills screen, "Scan bills": the user picks one or more PDFs (one PDF per bill kind per month is the usual case, 30+ pages) or photos.
2. In the browser, each PDF page is rendered to a JPEG (long edge ~2000 px, quality 0.85, as `engine/frontend/src/vendor/shared/image-compress.ts` does) and uploaded as a `receipt` document (`POST /api/documents`, under the 8 MB limit).
3. For each page the browser calls `POST /api/expenses/utilities/scan { documentId }` (three at a time). The function reads the image from R2, sends it to Claude, and returns the extraction plus the proposed unit and confidence. No DB write besides a scan log row.
4. A review table lists every page: thumbnail, bill kind, bill month, amount, proposed unit, confidence colour and the reasons ("account 2104010945XX02 + deposit RM 998.38 match Agile C37-13A"). Green rows are pre-ticked; amber rows show the candidates; red rows need a unit picked. The user can change any field.
5. "Record bills" saves the ticked rows through the same rules as §3 (late-bill roll, duplicate check), each with its page as `receipt_document_id`.
6. On save, the account's fingerprint is updated (§5.3). A unit picked by hand teaches the system that page's identifiers.

### 5.2 Reading (Claude)

- Anthropic Messages API from Pages Functions with the official TypeScript SDK (`@anthropic-ai/sdk`; works on Workers). Structured output via `output_config.format` with a JSON schema. Before writing the call, the builder reads the claude-api skill's TypeScript README; it is authoritative over this note.
- **Models (chew, 2026-10-27, "先 Haiku，读不好再用 Sonnet"):** read every page with `claude-haiku-5-5` (effort `low`). Read the page again with `claude-sonnet-5-5` (effort `low`) when the Haiku read fails a check: no amount or no bill month, the match is red, or the amount fails the guard in §5.4. The scan log records which model produced the result. Both model ids live in one constant so they can be changed without code edits elsewhere.
- Cost, rough (one page ≈ 1.6k input + ~0.6k output tokens): Haiku 5.5 under RM 0.01 a page, Sonnet 5.5 about RM 0.04. With ~250 bills a month and most read by Haiku, a few ringgit a month. chew rejected Opus 5.5 (RM 0.10–0.15 a page) as too expensive.
- Before release, an accuracy run on chew's Aug–Oct samples (§5.5) reports how many pages Haiku got right on its own; if Haiku alone is poor the split is revisited with chew.
- Secret: `ANTHROPIC_API_KEY` set by chew as a Cloudflare Pages secret for project `theconts-os` (production and preview). Never pasted in chat. Without it the endpoint returns 503 "Bill scanning isn't set up yet." and the rest of the screen works.
- **No reading time limit (chew: "别限制读的时间").** A page is never cut off for being slow; a batch has no overall limit; pages appear in the review table as they finish and the user can keep working. The only stop is a request with no response at all for 5 minutes (a dead connection), which is retried automatically; retries on 429/5xx/overloaded follow `engine/backend/src/scm/lib/scan-ocr.ts` `anthropicFetchWithRetry` (or the SDK's built-in retries). The browser keeps the queue, so a closed tab loses only the unfinished pages, which can be scanned again.
- Extraction schema (sen for money, `null` when not printed): `kind` (electricity | water | sewerage | internet | other), `provider`, `billMonth` (YYYY-MM; for a period bill the first month), `periodFrom`, `periodTo`, `amountDue`, `currentCharges`, `accountNoVisible` (as printed, masks kept as `X`), `accountNoFull` (from the barcode or anywhere it is printed whole), `deposit`, `invoiceNo`, `premiseAddress`, `buildingName`, `unitText`, `ownerName`, `meterPrevious`, `meterCurrent`, `usageHistory` ([{month, amount, units}] where printed), `confidenceNotes`.
- Prompt notes from the samples: TNB pages are rotated 90°; account numbers are masked in the middle (e.g. `2104010945XX02`); the security deposit is fixed per account; management water bills have no account number but carry owner name, building and meter readings; Indah Water and Maxis print the full account number.

### 5.3 Matching

New table `pos.utility_account_marks` (one row per account, created on first confirm): `account_id` (FK `unit_utility_accounts`), `account_no_pattern`, `deposit_sen`, `building_text`, `owner_name`, `last_meter_reading`, `last_bill_month`, `updated_at`. Plus `unit_utility_accounts` gets accounts for water where none exist today (water has no account numbers; its row is keyed by unit and kind with `account_no` empty).

Score each account against the page:
- full account number equal → decisive;
- visible digits match the pattern (masked positions ignored) → strong;
- deposit equal → strong;
- previous meter reading equals the account's last current reading → strong;
- building / owner name match → supporting;
- amount within the unit's usual range and the payment listing (when present) → supporting.

Green: one account with a decisive clue, or two strong clues, and no other account with a strong clue. Amber: one strong clue, or clues split across accounts. Red: nothing. Rules in one pure function with unit tests over the sample pages' extractions (fixtures from the real samples with personal fields replaced).

### 5.4 Guards

- Same unit, kind and bill month already recorded → the row is marked "Already recorded" and unticked.
- Amount over 50 % above or below the unit's last three bills → amber with the reason.
- A page Claude could not read (no amount or no month) → red, the user types the figures.
- Scan log `pos.utility_bill_scans` (document_id, extraction json, proposed account, confidence, confirmed expense_id, by, at) for audit and for measuring accuracy.

### 5.5 Checks

- Unit tests: matching scores and colours; "first open month"; schema coercion (RM → sen, masks).
- API checks: scan endpoint with the Claude call stubbed (`fetch`/client injected), 503 without the key, record → late-bill roll, duplicate refusal, fingerprint update.
- A manual accuracy run on chew's sample bills (Aug–Oct) before release, reported as green/amber/red counts and any wrong green.

## 6. Constraints

- Property OS conventions: migrations in `migrations-pg/` (`set local search_path to pos`, header summary and `-- REVERSAL:` block, owner `pos_app`, RLS enabled, grants to `pos_app`); applied to production before merging, in one transaction with the `public.pos_migrations` row (checksum = first 16 hex of sha256 of the file with CRLF → LF); every new endpoint calls `requireSession` and `audit` (`npm run check` lints this); utilities need `session.manage`.
- Money in sen everywhere; dates as `YYYY-MM-DD` text as `expenses.incurred_on` is today.
- Bills and listings contain personal data: processed locally or inside Property OS/Anthropic only, never committed, never published.
- English UI copy, British spelling, sentence case.

## 7. Recorded for later designs (not in this build)

**Utility listing** (approved mockup, 2026-10-27): units down, months across with the newest on the left; "All bills" splits each month into Electricity, Water, Internet, IWK and Total; single-unit view (one row per bill kind); cell background = charged to owner (green), owner pays not charged yet (amber), company pays (none), record only (blue), "–" no bill; per unit average per month and average per night booked (months with no nights left out of the per-night figure); an "Unusual" tab (over 50 % above or below the unit's previous three months) with nights booked; click a cell to open the bill.

**Unit cost-to-income analysis** (spike in `exports/单位收入与费用分析-2026-10-27.html`, real data Apr–Sep 2026): income = what the guest paid; every cost by kind including platform fees and taxes; layer one = the unit's operating profit, layer two = after the owner's portion, what the company keeps; RM and % of income per line; negatives in brackets and in the danger colour; Property OS theme colours; trend chart and cost-share chart; per-unit table with drill-down. "Normal" is judged three ways: against the unit's own past, against units in the same building, and against limits chew sets. The report must flag incomplete data itself (e.g. a month with no cleaning costs recorded, units with no bookings). Data owned by others (bookings import, cleaning costs) is not chew's part.

## 8. Calls put to chew (2026-10-27)

chew was shown these five, changed #3, added the no-time-limit rule, and raised no objection to the rest.
1. Late-bill roll-forward applies to utility bills only; other expenses still refuse a final month.
2. Existing water bills entered a month late are relabelled to their real bill month, with their deduction month unchanged, so no statement moves.
3. ~~OCR uses Claude Opus 5.5~~ → Haiku 5.5 first, Sonnet 5.5 when the read fails (§5.2).
4. Who pays a scanned bill defaults to the account's previous bill, and to the owner for a new account.
5. PDFs are split into page images in the browser, one Claude call per page, three at a time; no reading time limit (§5.2).

## 8a. Settled after the builder check (my calls)

- **Locks follow the deduction month for utility bills.** A utility bill can be edited or deleted while its `deduct_month` statement is open, even if its bill month is final (`functions/api/expenses/[id].ts`, `functions/_lib/approvals.ts`, the `locked` flag from `LOCKED_SQL` in the finance expenses list). Other categories keep locking on `incurred_on`. Two named helpers replace the ambiguous use: `isMonthFinal(owner, month)` (what `LOCKED_SQL` means today) and `isExpenseLocked(expense)` (utility: its deduct month is final; others: its date's month is final).
- **"(late bill)" wording comes from a stored flag**, `expenses.rolled boolean NOT NULL DEFAULT false`, set only when a save rolls the deduction month forward. Relabelled backfill rows and existing rows are not flagged, so statements already sent read as before.
- **The backfill reads each owner's real statement states at run time.** Bill month January–August 2026: record only, always (whatever that owner's statements are). Bill month September–October: the "first open month" rule from §3.2, so a September already finalised rolls to October with `rolled = true`. The dry run lists any owner whose state differs from "Jan–Aug final, Sep–Oct open".
- **Relabel collisions are skipped and reported.** If moving a bill back a month would land on a month that already holds that unit's bill of that kind (after all moves in the run are applied together), the bill is left where it is and listed in the report. The utilities screen's replace step matches on account, kind and bill month, so it never deletes a bill from another month.
- **Water accounts get a generated account number**, `WATER-<unit code>` (e.g. `WATER-C13-13A`), created by the backfill for every unit with a water bill; existing water bills get it as their `reference` in the same transaction, so the utilities screen's "recorded elsewhere" rule (empty account number) stops applying to water. Fingerprints key on the account id.
- **A shared meter belongs to one account**, on the unit side that holds the bill (§4.2). The other side has no account of that kind, so a page can match only one side.

## 9. Left to the builder

File layout inside `functions/` and `src/`; review table component choice (reuse the existing utilities modal styles); exact prompt wording; how the browser renders PDF pages (Property OS may need `pdfjs-dist`, which the ERP frontend already uses); scan log retention.
