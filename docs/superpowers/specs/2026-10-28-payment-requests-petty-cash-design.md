# Staff payment requests and petty cash

Date: 2026-10-28, revised 2026-10-29. Owner: chew (finance). Status: rules agreed with chew in chat on 2026-10-28/29 and written in `docs/finance/FINANCE-SOP.md` §3.2, §3.5 and §6; this design is waiting for chew's review.

The SOP is the source of the business rules. This document says how they are built. Where the two differ, the SOP wins; flag the difference instead of choosing.

All product text is English with British spelling. The field portal's screens are in its four languages: en, ms, zh, my (`src/lib/portalI18n.ts`). Chat with chew is in Chinese.

---

## 1. Why

- **Office staff cannot ask for money in the system today.** A Payment voucher can only be opened by someone with Ledger edit access, which is finance.
  - Staff ask finance outside the system, and finance keys everything.
  - chew: "员工要能自己提交报销和付款申请".
- **Petty cash is not in the system at all.** It was dropped with Houzs's "strip-to-core" cut-over (`engine/backend/src/db/migrations-pg/0017_drop_deleted_modules.sql`).
  - chew wants every float's spending listed, with the receipts, by month, and exportable to Excel.
- **The person who spends is usually not the person who keeps the cash.**
  - In maintenance, renovation and cleaning, staff pay first out of their own pocket.
  - They hand in the receipt. The department's petty cash keeper pays them back in cash.
  - chew: "submit 的人可以是很多人，但是 hold cash 的可能是那个部门的其中一个人".
- **People work across both systems.** Staff work in Property OS (Rental), in the engine (Supply chain), or in both.
  - chew: "可能一个人负责两边，所以不能限制哪里提交".

## 2. Goals, non-goals, anti-goals

### Goals

1. **Any staff member hands in a receipt** from either system. Field staff do it on the phone.
   - It is paid back from their department's petty cash.
   - If the department has none, finance pays it back by bank transfer.
   - Field staff never choose who pays.
2. **Any office staff member can ask finance to pay a supplier**, from either system, and follow the request to "Paid":
   - a supplier payment, including one against a PO;
   - a deposit.

   Their own spending is a receipt (goal 1).
3. **A department's keeper sees the receipts waiting for them**, pays out cash and marks them paid. The float's balance follows.
4. **Finance works in one place: the engine's Finance area.**
   - Turn requests into Payment vouchers, or reject them.
   - Check receipts.
   - Set floats and keepers.
   - Top floats up.
5. **Finance has a petty cash listing per float.** It shows:
   - the float and its balance;
   - every receipt, with photos, filtered by month and exportable to Excel;
   - an overview of all floats.
6. **Every line says where the cost belongs**: department (Rental / Supply chain / Shared), plus an optional unit, maintenance job or project, and an expense account. The ledger and the project limits use the same lines.

### Non-goals

- **Maintenance parts bought into the store.** chew has settled the cost rule: weighted average, expensed when drawn onto a job (2026-10-29). The rules for drawing stock wait on management, so this whole piece waits. Until then, such a buy is handed in as an ordinary receipt.
- **Buying Supply chain goods out of petty cash.** Supply chain goods always go through a PO, and are paid by a payment request against it (chew, 2026-10-29).
- The Payment centre (SOP §3.6) and bank batch files (§3.7).
- The "owes a formal invoice" tracking list and deposit offsets (§3.8). This design only sets the flag.
- Charging an owner from a receipt. The owner is charged through the maintenance job's quote, as today (§4.6a).
- Owner-paid items that are not maintenance, for example a kettle for a unit. They are parked by chew (2026-10-29) and stay as today: operations record them in Property OS. In this version, a receipt is a company cost or a maintenance job's cost.
- Notifications other than on-screen banners and badges.
- Engine mobile screens: Houzs's phone app stays switched off.

### Anti-goals (a failure even if it works)

- A receipt or request counted twice: in a balance, the ledger or a project limit.
- An owner charged both by a job's quote and by a receipt for the same job.
- Staff seeing other people's money. Field staff see only the amounts of their own receipts: no balance, and no job quote or cost. A keeper also sees their own float (§4.7).
- Two copies of the data or the rules, one per system, that can drift apart.
- A receipt refused because a project is over its limit. The money is already spent (SOP §6), so it is flagged, never refused.

## 3. Decisions made in chat (chew)

**2026-10-28**
- Staff submit requests themselves, from either system. Both systems show the same data.
- The listing:
  - photos, a month filter, an Excel export;
  - an overview with float, balance, waiting for a check, and the last top-up.
- A float may be overspent. The next top-up repays every checked receipt, and the balance returns to the float.
- On a maintenance job, the owner pays the job's quote. The receipt is the company's cost of the job and never charges the owner again.
- Example: quote RM 130, faucet RM 45. The owner is charged RM 130; RM 45 is the job's cost.

**2026-10-29**
- Field staff (technicians, cleaners) only hand in receipts and choose no payer. They see no balance. (Revised the same day: they do see and confirm the OCR amount of their own receipt, chew: "我希望他们提交时看到金额".)
  - The receipt is read by OCR.
  - Everything the system reads is checked on finance's side.
- **One float per department**, kept by one person. The keeper can be any staff member, not necessarily a supervisor.
  - Everyone in the department hands receipts in against that float.
  - One staff member can be pointed at another department's float.
  - A department with no float sends receipts to finance as a reimbursement.
- **A keeper cannot pass a receipt on to finance.** A department with a float pays every receipt from it. Short of cash, the keeper asks for a top-up (chew: "b").
- Maintenance receipts come from the job. Cleaning receipts are not always tied to a job, so the phone also has a stand-alone "Hand in a receipt".
- Supply chain goods: PO first. When the goods arrive or payment is due, a payment request is made against the PO.
- From the SOP (agreed earlier):
  - No multi-level approval. Finance may reject, and must give a reason.
  - Top-ups are monthly, or earlier on request, and equal the checked receipts.
  - A rejected receipt is borne by the person unless they bring a proper one.

## 4. How it is built (design calls are mine unless marked)

### 4.1 One owner of the data: the engine

- **All new tables live in schema `scm`.** All rules live in the engine backend (`engine/backend/src/conts/`).
- **Property OS never writes these tables.** It forwards to the engine (§4.3). This is the only way to meet the "no two copies" anti-goal; finance, the Payment vouchers and the project limit already live in the engine.
- **Migrations:**
  - They go in the root `migrations-pg/`, after the latest number on `origin/main` (0176 today).
  - New `scm` tables are owned by `scm_engine` and granted to `service_role` and `pos_app`, as `0162_project_limit.sql` does, because the engine reaches them through the REST client.
- **Prerequisite:** this builds on the project-limit work on branch `feat/finance-1b-h-project-limit` (`engine/backend/src/conts/project-limit.ts`, not yet on `origin/main`).
  - That branch must be merged first, with its 0162 migration renumbered.
  - Where this document says "as today" about the project limit, it means that branch.
  - `engine/backend/src/db/migrations-pg/` is the frozen Houzs copy. It is not used.
- **The inherited Houzs table `scm.acc_payment_requests` is not reused.**
  - Its requester is an engine integer id.
  - It carries Houzs's own instalment fields.
  - Nothing in this design uses it.

### 4.2 People, departments, floats

**A person** is keyed by their Property OS user id (`pos.users.id`, text).
- The engine finds the caller's key by email through the view `public.conts_staff`.
- That view gains `department_id`, the department's `side`, and the role.

**A department** is a row of `pos.departments`. Its `kind` is one of management, staff, cleaning or maintenance, and its `side` is one of conts, dream_crafter or both.

**A float** belongs to one department and has one keeper, and books to its own account in the chart (§4.5).
- At most one active float per department.
- A person keeps at most one float.
- An account belongs to at most one active float.

**Which float takes a person's receipts:**
1. their own override, if finance set one;
2. otherwise their department's active float;
3. otherwise none. The receipt stays a receipt with no float, and finance pays it back by bank transfer (§4.5, "Paid back by finance").

**The default line department** comes from the person's department side:

| Side | Line department |
|---|---|
| conts | rental |
| dream_crafter | supply |
| both or none | shared |

**Field staff** are accounts whose role is housekeeper or technician.
- They sign in by phone and PIN. Their email is the placeholder `<id>@no-email.invalid` (`migrations-pg/0143_field_pin_sign_in.sql`), which still matches by email.
- Production has no field accounts yet, and no account in a Cleaning, Maintenance or Renovation department.
- Accounts and departments must be set up before field staff can hand in receipts. Until people are placed in departments, everyone's default line department comes out as "shared".

### 4.3 Where people submit, and how the engine knows them (revised 29 Oct after review)

**Everyone submits in Property OS.** Every Conts staff member has a Property OS account; the engine has accounts only for
those with an engine area, and an engine session also opens routes that need only a sign-in (search, the assistant), which
carry customer details. So there is no engine sign-in for claims (a claims-only engine role was built and removed in review).

| Who | Where |
|---|---|
| Office staff | **My claims** in the Property OS sidebar: hand in a receipt, ask finance to pay, mine, and for a keeper the float |
| Field staff on the phone | The field portal: the receipt upload on their maintenance job, "Hand in a receipt", "My receipts", and the keeper's "Petty cash" tab |

**How the engine knows them.**
- Property OS Functions forward each call to the engine at `/api/claims-forward/*`, server to server.
- Each call carries a signed staff assertion: `{ aud: "claims", userId, email, exp }`. It is HMAC-SHA256 with the single sign-on secret, and `exp` is at most 60 seconds ahead.
- The engine checks the assertion (`conts/staff-identity.ts`), finds the person by email in `public.conts_staff`, and requires the asserted id to be that person.
- The route is mounted before the engine's global session check and answers on the assertion alone.

`/api/claims/*` is the same router for someone signed in to the engine; finance's own screens use its pickers.

**Staff endpoints** need only a Conts staff member.
- Every query is limited to the caller, and a keeper's to their own float.
- The bill reader is reached through `/extract` on the same router.

**Finance endpoints** stay under `/api/scm/accounting/*`, behind the Ledger gate.

### 4.4 Lines, files, OCR (shared by receipts and requests)

**Line:**
- department: rental, supply or shared
- optional `unit_id`: a Property OS unit
- optional `maintenance_issue_id`
- optional `project_id`
- `account_id`: the expense account. People pick it by expense category name (SOP §2). Until that list exists, they pick from accounts marked staff-visible.
- amount, description

**Files:** photos or PDFs, at least one. They are stored in the engine's existing R2 bucket for voucher files, under a new prefix, within the existing size and type limits.

**OCR:**
- The bill reader reads the payee, date, number and amount when a receipt is handed in.
- **Every submitter sees the read amount and confirms or corrects it before sending** (chew, 2026-10-29). Field staff included. If OCR reads nothing, they type it. Their line takes:
  - the job's unit, department and job, for a job receipt;
  - their default department, for a stand-alone receipt, plus a unit if they pick one. Cleaners pick a unit from a list, with no amounts shown.

  The expense account is left for finance.
- Office staff also see the other read figures (payee, date, number).
- Finance can still correct any amount while checking (§4.5).

### 4.5 Receipts and petty cash

**Receipt** (a person's own spending, to be paid back):
- submitter, float (resolved by §4.2 at hand-in and fixed on the receipt), spend date, files, lines, note.

```
Handed in (= paid from the float) → Checked (finance) → Topped up
   ↘ Rejected (finance, reason) → a proper receipt → Handed in again
                                ↘ Repaid (money given back to the float)
                                ↘ Written off (finance)
```

- **A receipt on a float counts as paid the moment it is handed in** (chew, 2026-10-29: "就提交时当做已付吧，那是他们之间的事了").
  - Its amount comes off the balance at once.
  - When the keeper hands the cash over is between them; the system records no pay-out step.
- **Rejected:** the submitter owes the float. A later proper receipt, a repayment, or a write-off clears it.
- **Department decides the fields** (chew, 2026-10-29). Renovation receipts mostly must name a project, and renovation staff work only in the engine.
- **Paid back by finance** (no float, §4.2 step 3):
  - The receipt has no float and goes to finance's "Receipts to pay back" list. There is no request row, so nothing counts twice.
  - Finance confirms the amount and account while checking, then **Create voucher** makes a DRAFT Payment voucher to the submitter, using the staff bank details (§4.8).
  - The receipt is "Paid back" when that voucher posts.
  - Over the project limit is flagged, never refused, like any receipt.
- **Resubmitting after a rejection:** a proper receipt handed in after a rejected one replaces it. It is not taken off the balance a second time.
- **Which amount counts:**
  - The OCR amount, or the amount an office submitter confirms, is taken off the balance at hand-in.
  - Finance may correct it while checking. The balance follows the corrected figure, and the ledger and the project limit use it. Any difference in cash is settled between the keeper and the staff member.
  - (Every receipt has an amount from hand-in, since the submitter confirms or types it.)
  - The keeper may also enter the amount, on their own tab.
- **No passing on** (chew, "b"): the keeper has no way to send a receipt to finance.
- **Project limit:** a receipt's project lines count as used from Handed in (SOP §6). They stop counting when the receipt is rejected and then repaid or written off. Over the limit is flagged, never refused.

**Float:**
- department, keeper, float amount, low-balance warning % (default 20%), active.
- Finance sets them.
- Changing the keeper keeps the float and its history. The handover cash count is done outside the system.

**Balance** (cash the keeper should hold):

```
money paid to the keeper (posted vouchers)
  − receipts handed in on the float
  + rejected receipts that were repaid
  − money returned to finance
```

- **Overspending is allowed** (chew, 2026-10-28). The balance can go below zero, which is the keeper's own money. Nothing is refused for it. It shows in the danger colour.
- **Banner:** shown to the keeper and to finance below the warning %.

**Money to the keeper** (a new float, a raise, a top-up):
- Always a Payment voucher, purpose `OTHER`, to the keeper, with one line on the float's own account, linked to the float.
- **"Top up"** proposes **float − balance**, which brings the float back to its amount. It therefore includes write-offs, and any rejected receipt still owed by a staff member.
  - The voucher lists the checked receipts it covers, and they turn "Topped up" when it posts.
  - Receipts not yet checked are shown as a warning. Finance may still top up, or check them first.
  - A later repayment raises the balance, so it simply lowers the next top-up.
- **The keeper's "Ask for a top-up"** flags the float for finance.

**"Returned"** is the keeper giving cash back: the float is lowered or closed. Finance records it with a date and an amount. In the ledger it is an ordinary money-received entry, made by hand; the form says so.

**Ledger** (my call):

| Event | Journal |
|---|---|
| A voucher to the keeper posts | Dr petty cash, Cr bank |
| A receipt on a float is checked | Dr each line's account, Cr petty cash, on the spend date. The engine has no month close yet; a spend date before the ledger start date is posted on the ledger start date, and the receipt keeps its real date |
| A rejected receipt | Nothing |
| A repayment | Nothing (the cash goes back into the tin) |
| A write-off | Dr the account finance picks, for example a staff debtor; Cr petty cash |

- **Each float books to its own GL account** (chew, 2026-10-29; replaces one petty cash account chosen in Ledger setup). The chart already keeps one cash-in-hand account per float, named after its keeper: for example Renovation → 315-0100 PETTY CASH - ALEX (RENO), Maintenance → 315-0101 PETTY CASH - AMIN. "Petty cash" in the table above means that account.
  - The account is chosen when the float is set up: an active cash-in-hand account (money, kind SCH), not the cash drawer, and not another active float's.
  - It can be changed only until something is booked to it. After that, the balance is moved with a journal entry and a new float started.
  - A float without its account books nothing: its receipts wait unchecked and it cannot be topped up.
  - A float's account needs no voucher letter, and is not offered as a bank to pay from.

### 4.6 Payment requests (to finance)

**Types:**
- `PAYMENT`: to a supplier, optionally against a PO.
- `DEPOSIT`

A person's own spending is never a request. It is always a receipt (§4.5), paid back from a float or, with no float, by finance.

**Header:**
- requester, payee, wanted pay date, note
- `owes_formal_invoice`: set for a deposit, and can be ticked on the others
- optional `purchase_order_id`
- files, lines

**Payee:**
- **Payment and deposit:** a supplier from `scm.suppliers`, which already holds bank details. If not on the list, the payee is typed in and marked "to be checked"; finance must link or add the supplier before paying (SOP §3.2).
- **With a PO:** the supplier comes from the PO.

**Deposit** (my call):
- It must name a supplier from the list.
- Its voucher is a supplier payment booked as a supplier advance (the existing `acc_supplier_advances`), so the later invoice can be offset (SOP §3.8, later).

**Project limit** (my call, so nothing counts twice):
- A submitted request reserves, per project, only the part not yet on any of its vouchers. Its vouchers reserve or use the rest, as today.
- Submission is refused over the limit (SOP §3.2). `conts/project-limit.ts` gains request reservations and receipts as further sources.
- A rejected, withdrawn or closed request reserves nothing.
- Everyday-expense accounts are left out, as today.

**Status** (SOP §3.5):

```
Submitted (waiting for payment) → Part paid → Paid
     ↘ Rejected (reason)     ↘ Closed (paid short, reason)
     ↘ Withdrawn (requester, while no voucher)
```

- **Create voucher** makes a DRAFT Payment voucher pre-filled from the request:
  - payee, lines (department, project, unit), files;
  - `payment_request_id` set;
  - for a PO request, the supplier, so finance allocates the purchase invoice as today.
- The voucher then follows Submit → Check → Approve → Post.
- **Several vouchers per request.** The request is Paid when its posted vouchers reach its amount.
- **Close** frees the remaining reservation (SOP §3.4).
- **Cancelling a voucher** moves the request back.
- **Reject** needs a reason.
- **Voucher lines gain `unit_id`.**

### 4.6a Maintenance jobs

- **The job's document upload** (`functions/api/maintenance/issues/[id]/documents.ts`) gains a kind: **"My purchase (pay me back)"**. My call: it is a document type in the existing list, not a payer choice.
  - Uploading it hands in a receipt for the job (§4.5). The person uploads once.
    - Property OS keeps the file in its `MEDIA` bucket as today.
    - The forwarding Function sends a copy to the engine's bucket for the receipt.
  - The existing kinds (contractor's bill, receipt, invoice, proof of work) are unchanged. A contractor's bill keeps its path (`contractor_amount`).
- **The owner pays the job's quote** through the existing complete → expense flow (SOP §3.11). The receipt is the company's cost of the job.
- **The job page shows its receipts as part of actual cost** (office only; field staff see no job cost). When actual cost goes above the quote, the job shows the SOP §3.11 step 4 warning.
- **Two read-only views** (part of the list in §5):
  - one of `pos.maintenance_issues` (id, unit, title, assignee, state) for `scm_engine`;
  - one of receipt lines by job for `pos_app`.

### 4.7 Screens

**Field portal** (phone; four languages; field staff see the amounts of their own receipts only, and a keeper also sees their float):
- **On a maintenance job:** the upload offers "My purchase (pay me back)".
- **"Hand in a receipt":** a button on the Jobs tab. Take photos, optionally pick a unit, add a note, send.
- **"My receipts":** each receipt with date, what it was for, and status in words (Waiting, Paid back, Rejected and why). With amounts.
- **For a field keeper only, a "Petty cash" tab:**
  - the balance;
  - this month's receipts on their float, each with photo, submitter and amount, so they know what cash to hand over. The amount can be entered where OCR could not read it;
  - "Ask for a top-up".

**My claims** (engine page; also in Property OS through the frame):
1. **Hand in a receipt.** The form shows the OCR figures, lines and files. Its route follows §4.2: the person's float, or finance as a reimbursement.
2. **Ask finance to pay.** Payment (optionally against a PO) or Deposit to a supplier.
3. **Mine:** my receipts and requests, with status, reasons and voucher numbers.
4. **For a keeper, Petty cash I keep:** the same as the field keeper tab, plus a month filter.

**Finance** (engine Finance group):

*Payment requests:*
- Filter by status, type, department and requester. Submitted ones come first, oldest first.
- Each request shows its lines, files and payee.
- **Create voucher**, **Reject**, **Close**.

*Petty cash overview:* one row per float.
- Columns: department, keeper, float, balance, waiting for a check (amount and count), last top-up, low-balance marker.
- A totals row.
- **New float**, **Change float / keeper**.
- **Staff pointed at another float:** a small list to add and remove overrides.

*Float page:*
- Header: float, balance, waiting for a check.
- Month filter, defaulting to this month.
- Table columns: date, submitter, description, department, unit / job / project, account, amount, status, receipts (thumbnails that open the file).
- Finance can set the account and correct the amount while checking.
- Bulk **Check**; **Reject** (reason).
- **Top up**, **Returned**, **Repaid**, **Write off**.
- **Export to Excel**:
  - SheetJS, as the other engine exports;
  - follows the month filter;
  - one row per receipt line;
  - shows the number of receipts.
- Over-limit flags.

The screens follow the engine's existing theme. Amounts are right-aligned, in RM.

### 4.8 Staff bank details

- **In-house cleaners and technicians:** their details already live in `pos.employees` (`bank_name`, `bank_account`; `migrations-pg/0165_employees.sql`, linked through the technician and cleaner rosters). They are read from there through a view for `scm_engine`, not copied.
- **Everyone else:** a new table keyed by person, with bank name, account number, account name, checked by and checked at. Finance keeps it; HR supplies the details (SOP §2).
- A receipt paid back by finance can be handed in without bank details. **Create voucher** is refused until there are details, and the person sees "Bank details missing — please ask finance".

### 4.9 Permissions

| Who | Can do |
|---|---|
| Any staff member | Hand in receipts; see their own receipts and requests. Office staff may also ask finance to pay |
| A float's keeper | See the receipts on their own float, enter missing amounts, ask for a top-up |
| Ledger edit | Process requests; check and reject receipts; record returned and repaid; see every float |
| Ledger full | Also set floats, keepers, overrides, staff bank details, top-ups and write-offs. Approving a voucher still needs voucher approve, as today |

## 5. Data (new; names are the builder's choice)

| Table | Contents |
|---|---|
| Payment requests | Header (§4.6) |
| Payment request lines | Lines (§4.4) |
| Request files | Files |
| Petty cash floats | Department, keeper, amount, warning %, active (§4.5) |
| Float overrides | Person → float (§4.2) |
| Receipts | Header and status (§4.5) |
| Receipt lines | Lines (§4.4) |
| Receipt files | Files |
| Float events | Money paid in (voucher link), Returned, Repaid. With the receipts, these are the source of the balance |
| Staff bank details | §4.8 |

**Changed:**
- `scm.payment_vouchers`: add `payment_request_id` and `petty_cash_float_id`.
- Voucher lines: add `unit_id`.
- `public.conts_staff`: add `department_id`, the department's side, and the role.
- **New views:**
  - Property OS units, for `scm_engine`;
  - maintenance jobs, for `scm_engine`;
  - employees' bank details, for `scm_engine`;
  - receipt lines by job, for `pos_app`.

## 6. Open, not blocking this version

- **Maintenance parts into the store:** waits on chew and management (§2).
- **Which kinds a person sees** will be bound to user settings later. For now, field staff see receipts, and office staff see receipts and requests.

## 7. Noted, out of scope

- This branch's `migrations-pg/0162_project_limit.sql` clashes with main's 0162. It must be renumbered before this work's migrations are numbered; it is already on the follow-up list.
- The expense category list (SOP §2) does not exist yet. Lines use staff-visible accounts until it does.
