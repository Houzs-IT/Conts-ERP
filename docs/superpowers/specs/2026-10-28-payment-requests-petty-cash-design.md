# Staff payment requests and petty cash

Date: 2026-10-28. Owner: chew (finance). Status: rules agreed with chew in chat on 2026-10-28 and written in `docs/finance/FINANCE-SOP.md` §3.2, §3.5 and §6; this design is waiting for chew's review.

The SOP is the source of the business rules. This document says how they are built. Where the two differ, the SOP wins; flag the difference instead of choosing.

All product text is English with British spelling. Chat with chew is in Chinese.

---

## 1. Why

- **Office staff cannot ask for money in the system today.** A Payment voucher can only be opened by someone with Ledger edit access, which is finance.
  - Today staff ask finance outside the system. Finance then keys everything.
  - chew: "员工要能自己提交报销和付款申请".
- **Petty cash is not in the system at all.** It was dropped with Houzs's "strip-to-core" cut-over (`engine/backend/src/db/migrations-pg/0017_drop_deleted_modules.sql`).
  - chew wants every holder's spending listed: "每个员工的 petty cash listing，就是他们 submit 他们用的费用".
  - The listing must show the receipts, filter by month and export to Excel.
- **People work across both systems.** Staff work in Property OS (Rental) or the engine (Supply chain), and some work in both.
  - chew: "可能一个人负责两边，所以不能限制哪里提交".
  - A person has one petty cash float, whichever side they spend it on (chew, 2026-10-28).

## 2. Goals, non-goals, anti-goals

### Goals

1. **Any signed-in staff member can submit a payment request** from either system and follow it to "Paid". The request types are Reimbursement, Payment and Deposit.
2. **A holder of petty cash records each spend** from either system, with receipt photos. Field staff record theirs on the phone. The holder's balance drops at once.
3. **Finance works in one place: the engine's Finance area.**
   - Turn a request into a Payment voucher, or reject it with a reason.
   - Check petty cash spends.
   - Set floats.
   - Top a holder back up to their float.
4. **Finance has a petty cash listing per holder.** It shows:
   - the float and the balance;
   - every spend, with receipt photos, filterable by month and exportable to Excel;
   - an overview of all holders.
5. **Every line says where the cost belongs**: department (Rental / Supply chain / Shared), and optionally a unit or a project, plus an expense account. The ledger and the project limits use the same lines.

### Non-goals (later phases, per SOP §14)

- The Payment centre (§3.6) and bank batch files (§3.7).
- The "owes a formal invoice" tracking list and deposit offsets (§3.8). This design only sets the flag.
- **Goods purchases.** chew wants a "Goods" kind with two variants, both deferred until chew settles the stock rules with management (chew, 2026-10-28: "拿货和算法到时我再决定"):
  - maintenance parts into the Property OS parts store: weighted-average cost, expensed when drawn onto a job;
  - Supply chain goods: site materials as project cost, and warehouse goods through the engine's goods receipt.

  Until then, staff submit such buys as a Claim.
- Sending owner-borne costs onto owner statements from a claim. The owner is charged through the maintenance job's quote, as today (§4.4a).
- Notifications other than on-screen banners.
- Engine mobile screens (Houzs's phone app stays switched off).

### Anti-goals (a failure even if it works)

- A spend or request counted twice: in the balance, the ledger or the project limit.
- Staff seeing or changing anyone else's requests or petty cash.
- Two separate copies of the data or the rules, one per system, that can drift apart.
- A petty cash spend blocked because a project is over its limit. The money is already spent (SOP §6), so it is flagged, never refused.

## 3. Decisions made in chat (chew, 2026-10-28)

- Staff must be able to submit Reimbursement and Payment requests themselves.
- Submission is not limited to one system. Both systems show the same data.
- There is one petty cash float per person. A person working on both sides has one float. The department comes from each line.
- The petty cash listing:
  - Per holder: the float, the balance, and each spend with its receipt photos.
  - Filtered by month, exportable to Excel.
  - An overview of all holders: float, balance, amount waiting for a check, and last top-up date.
- From the SOP (agreed earlier):
  - No multi-level approval. A submitted request goes straight to "waiting for payment".
  - Finance may reject a request; the reason is required.
  - A holder's spend defaults to "paid from my petty cash". The holder can switch it off.
  - Top-ups are monthly, or earlier on request. A top-up equals the checked spends.
  - A rejected spend is borne by the holder unless they bring a receipt.

## 4. How it is built (design calls, mine unless marked)

### 4.1 One owner of the data: the engine

All new tables live in schema `scm` and all rules live in the engine backend (`engine/backend/src/conts/`). Property OS never writes these tables; it forwards to the engine (§4.3).

This is the only way to meet the "no two copies" anti-goal. Finance, the Payment vouchers and the project limit already live in the engine.

Migrations go in the root `migrations-pg/`, after the latest number on `origin/main`, which is 0176 today. Grant them to `scm_engine`, as the `scm` migrations there do. The engine's own `engine/backend/src/db/migrations-pg/` is the frozen Houzs copy and is not used.

The inherited Houzs table `scm.acc_payment_requests` is **not reused**:
- its requester is an engine integer id;
- it carries Houzs's own installment fields;
- nothing here uses it.
New tables keep Conts's model clean.

### 4.2 Who a person is

- **A person is keyed by their Property OS user id** (`pos.users.id`, text). Every Conts staff member has one; engine users are created from it by single sign-on.
- **The engine finds the caller's key by email** through the existing view `public.conts_staff`.
- **Default department** comes from the department's `side`, which is added to the view (my call):
  - `conts` → rental
  - `dream_crafter` → supply
  - `both` → shared
  - none → shared

  The view's `department` column is a free-text name, not one of these.
- The key is stored on every request (`requested_by`) and float (`holder`). The engine's `public.users.id` is never stored.

### 4.3 Where people submit

| Who | Where | How |
|---|---|---|
| Staff in the engine | "My claims" page in the engine | Engine screen |
| Office staff in Property OS | "My claims" in the Property OS sidebar | The same engine page in the existing frame, signed in by the existing single sign-on (`functions/api/supply-chain/engine-session.ts`). Today the single sign-on refuses anyone with no engine area (`engine/backend/src/conts/sso.ts:64`). So a new engine area, **"My claims"**, is given to every non-field Conts staff member, and it counts as access there (my call). This keeps one set of staff screens instead of building them twice |
| Field staff (cleaners, technicians) on the phone | "Petty cash" tile in the field portal (`/portal`) | A Property OS page. Its Functions forward each call to the engine's staff endpoints, server to server. Each call carries a new signed staff assertion: the person's Property OS user id and email, signed with the existing engine assertion key, with a short expiry. The engine checks it in its own middleware, separate from the single sign-on, which accepts only the existing assertion (`functions/_lib/scmEngine.ts:25`, `engine/backend/src/conts/sso.ts:19-33`). The single sign-on refuses field roles, so the frame cannot be used for them |

**Field staff record petty cash spends**, and a "reimburse me" receipt on their own maintenance job. Their other costs are submitted by their supervisor (SOP §3.1).

**Staff endpoints:** `/scm/my/*`.
- They need only a signed-in Conts staff member. They are mounted outside `/payment-vouchers`, so neither `scmAreaGuard("scm.finance.accounting")` nor `requireLedgerAccess` applies.
- The bill reader is reached through a staff route of their own, `/scm/my/extract`, which calls the same `acc/bill-extract.ts`. The voucher route's `/extract` is still behind the Finance area guard.
- Every query is limited to the caller's own key.
- Finance endpoints keep the Ledger gate.

### 4.4 Payment requests

**Request:**
- type: `REIMBURSEMENT | PAYMENT | DEPOSIT`
- requested_by, payee, wanted pay date, note
- `owes_formal_invoice`: set for DEPOSIT; can be ticked on the others
- files
- lines

**Line:**
- department: `rental | supply | shared`. The default is the requester's department.
- `unit_id`: optional, a Property OS unit
- `maintenance_issue_id`: optional; set for kind Maintenance (§4.4a)
- `project_id`: optional
- `account_id`: the expense account. Staff pick it by expense category name (SOP §2's expense category list). Until that list exists, they pick from accounts marked as staff-visible.
- amount, description

**Payee:**
- Reimbursement: the requester. Bank details come from §4.6.
- Payment and Deposit: a supplier from `scm.suppliers`, which already holds bank details. A payee not on the list can be typed in. It is marked "to be checked", and finance must link it or add the supplier before paying (SOP §3.2).

**Receipts and OCR:**
- Files: photos or PDFs, at least one.
- The existing bill reader (`POST /extract`, `acc/bill-extract.ts`) pre-fills payee, date, number and amount.
- Nothing is saved until the person presses Submit.

**Project limit** (my call, so nothing counts twice):
- A submitted request reserves, per project, only the part **not yet on any of its vouchers**. Its vouchers then reserve or use the rest, as they do today.
- Submission is refused when a line would take its project over the limit (SOP §3.2), using `conts/project-limit.ts`. That file gains the request reservations and the petty cash spends (§4.5) as further sources.
- A rejected, withdrawn or closed request reserves nothing.
- Everyday-expense accounts are left out, as today.

**Deposit** (my call):
- A Deposit must name a supplier from the list.
- Its voucher is a supplier payment booked as a supplier advance (the existing `acc_supplier_advances`), not as an expense. That way the later invoice can be offset against it (SOP §3.8, a later phase).

**Status (SOP §3.5):**

```
Submitted (waiting for payment) → Part paid → Paid
        ↘ Rejected (reason)          ↘ Closed (paid short, reason)
        ↘ Withdrawn (by the requester)
```

- The requester can edit or withdraw while no voucher exists.
- Finance's "Create voucher" makes a DRAFT Payment voucher pre-filled from the request:
  - the payee and the lines, including department, project and unit;
  - the files, copied to the voucher;
  - `payment_request_id` set on the voucher.
- The voucher then follows its normal Submit → Check → Approve → Post.
- A request can have several vouchers (part payments). It is Paid when its posted vouchers reach its amount.
- Finance can **Close** a part-paid request with a reason (paid less than asked). The rest of its reservation is freed (SOP §3.4: once paid, the amount actually paid counts).
- Cancelling a voucher puts the request back to Submitted or Part paid.
- Rejecting needs a reason. It frees the reserved limit, and the requester sees the reason.

**Voucher lines gain `unit_id`** (optional, a Property OS unit) so a Rental cost keeps its unit in the ledger.

### 4.4a One submit screen; maintenance costs (chew, 2026-10-28)

**One submit screen**, the same in both systems and on the phone, starts with **what the cost is for**:

| Kind | What the person fills | Filled for them |
|---|---|---|
| **Maintenance** | Pick one of their own maintenance jobs | Unit, department `rental`, and the job link |
| **Claim** (general spending) | Department, project or unit, expense category | — |
| Goods | Deferred (§2) | — |

- Which kinds a person sees will later be bound to their user settings. Until then, everyone sees both.
- **Paid by**: "My petty cash" (the default for a holder), or "I paid — reimburse me". A Payment or Deposit to a supplier is a Claim with "Pay a supplier".
- **The amount comes from the receipt by OCR.** The person confirms or corrects it.

**Maintenance:**
- On a maintenance job, the existing receipt upload (`functions/api/maintenance/issues/[id]/documents.ts`, kinds `receipt` and `claim`) gains "Paid by" when a staff member uploads their own receipt.
- "My petty cash" or "Reimburse me" creates the spend or request through the engine, with the same file. There is no second upload.
- Opening the submit screen from a job pre-sets kind Maintenance and the job.
- A contractor's bill keeps today's path (`contractor_amount`).
- **The owner is never charged from the claim.** The owner pays the job's quote through the existing complete → expense flow (SOP §3.11). The claim is the company's cost of the job.
  - The job page shows its claims as part of its actual cost.
  - Example: quote RM 130, faucet bought with petty cash RM 45. The owner is charged RM 130; RM 45 is the job's cost.
- When actual cost goes above the quote, SOP §3.11 step 4 applies: HOD and finance are warned. That warning is shown on the job here; any further alert is out of scope.
- The engine reads jobs (id, unit, title, assignee, state) through a new read-only view of `pos.maintenance_issues`, granted to `scm_engine`.
- Property OS reads a job's claims through a read-only view of the claim lines, granted to `pos_app`.
- A person may pick only open jobs assigned to them. Office staff may pick any open job.

### 4.5 Petty cash

**Float** (one per person, unique on the holder):
- holder, float amount, low-balance warning % (setting, default 20%), active flag.
- Finance sets and changes it.

**Spend:**
- holder, spend date, files (at least one), note
- lines, exactly as request lines (§4.4)
- status:

```
Submitted → Checked → Topped up
    ↘ Rejected (reason) → resubmitted with a receipt → Submitted
                        ↘ Repaid by holder
                        ↘ Written off (finance)
```

- A spend can be edited until finance checks it.
- A spend's project lines **count as used from Submitted** (SOP §6: the money is already spent). They stop counting if the spend is rejected and the holder repays, or the spend is written off.
- An over-limit project line is flagged on the spend and in finance's list. It is never refused.

**Paying money to the holder (giving a float, raising it, topping up):**
- It is always a Payment voucher, with purpose `OTHER`, to the holder, with one line on the petty cash account. It is linked to the float.
- A top-up voucher also lists the checked spends it covers. When it posts, they become "Topped up".
- "Top up" proposes the total of checked spends not yet topped up. Finance may top up mid-month (SOP §6).
- **Spending beyond the float is allowed** (chew, 2026-10-28: "如果他们用超过我给的我还要在下一次补回").
  - The balance can go below zero; that is the holder's own money.
  - A spend is never refused for that.
  - The next top-up covers every checked spend, so the holder is paid back in full and returns to the float.
  - A negative balance is shown in the danger colour.

**Balance** = posted money paid to the holder − every spend not rejected − rejected spends not yet repaid − money the holder returned.
- Shown live on the holder's page and in finance's overview.
- A banner shows when the balance is below the warning %.
- A holder returning cash (lowering or closing a float) is recorded by finance as "Returned", with a date and amount. In the ledger it is a normal money-received entry, done by hand. Finance's "Returned" form says so.

**Ledger** (my call):
- One petty cash GL account, chosen in the Ledger setup posting rules, in the same place as the other control accounts.
- A voucher to the holder posts Dr petty cash, Cr bank.
- Checking a spend posts its journal on the spend date: Dr each line's expense account, Cr petty cash.
  - If that month is already closed, the journal goes into the first open month, and the spend keeps its real date (SOP §3.10).
- A rejected spend posts nothing. If the holder repays, the cash goes back into the float, and that needs no journal either.
- If a rejected spend is never repaid (for example, the holder leaves), finance can **Write off** the spend:
  - Finance picks the account, for example a staff debtor or salary deduction.
  - The write-off posts Dr that account, Cr petty cash.
  - It counts in the balance like a repayment.
- The per-holder split lives in the petty cash tables, not in separate GL accounts.

### 4.6 Staff bank details

- New table: staff bank details, keyed by the person. Fields: bank name, account number, account name, checked by, checked at.
- Finance keeps it (HR supplies the details, SOP §2).
- A reimbursement can be submitted without bank details, but "Create voucher" is refused until they are checked. The requester sees "Bank details missing — please ask finance".

### 4.7 Screens

**Staff: "My claims"** (engine page; also in Property OS through the frame). Three tabs:
1. **New**
   - Choose Reimbursement / Payment / Deposit.
   - A holder sees "Paid from my petty cash" ticked. Unticking it makes a reimbursement request.
   - Upload receipts. OCR pre-fills the form.
   - Add the lines and submit.
2. **My requests**: each request with its status, the reject reason, and the voucher number once there is one.
3. **My petty cash** (holders only):
   - Float, balance, and a low-balance banner.
   - Each spend: date, description, unit / project, amount, status, receipts.
   - Month filter.
   - "Ask for a top-up" button. It flags the float for finance.

**Field portal: "Petty cash"** (phone; holders only):
- The balance.
- "Record a spend": the same submit screen (§4.4a), Maintenance or Claim. Take photos; OCR reads the amount.
- The holder's spends this month, with status.
- On their own maintenance jobs, the receipt upload offers "Paid by" (§4.4a).

**Finance (engine Finance group)**

*Payment requests:*
- The list. Filters: status, type, department, requester. Submitted ones come first, oldest first.
- Each request shows its lines, files and payee.
- Actions: **Create voucher**, **Reject** (reason).

*Petty cash:*
- **Overview**: one row per holder, with holder, department, float, balance, waiting for a check (amount and count), last top-up date, and a low-balance marker. Totals row at the bottom. Actions: **New float**, **Change float**.
- **Holder page:**
  - Header: float, balance, waiting for a check.
  - Month filter. The default is this month.
  - Table: date, description, department, unit / project, account, amount, status, receipts (thumbnails; click to open).
  - Bulk **Check**, and **Reject** (reason).
  - **Top up** (shows the amount and creates the voucher), **Returned**, **Repaid**.
  - **Export to Excel** (SheetJS, as other engine exports). The export follows the month filter, one row per spend line, and shows the number of receipts.
  - Over-limit flags.

Design rules for these screens follow the project's existing engine theme. Numbers are right-aligned in RM.

### 4.8 Permissions

| Who | Can do |
|---|---|
| Any signed-in Conts staff member | Their own requests and spends. "My petty cash" is shown only to float holders |
| Ledger edit | Process requests (create voucher, reject); check / reject spends; record returned / repaid; see the overview and every holder's listing |
| Ledger full | Also set floats, staff bank details, and top-ups. Approving a voucher still needs voucher approve, as today |

## 5. Data (new; names are the builder's choice)

| Table | Contents |
|---|---|
| Payment requests | Header (§4.4) |
| Payment request lines | Lines (§4.4) |
| Request files | The files |
| Petty cash floats | One per person (§4.5) |
| Petty cash spends | Header (§4.5) |
| Spend lines | Lines (§4.5) |
| Spend files | The files |
| Float events | Money paid in (voucher link), Returned, Repaid. The source of the balance |
| Staff bank details | §4.6 |

**Changed tables:**
- `scm.payment_vouchers`: add `payment_request_id` and `petty_cash_float_id`.
- Voucher lines: add `unit_id`.
- A view of Property OS units readable by `scm_engine`, to show and pick units: id, building, unit number.

**Files** go to the engine's existing R2 bucket for voucher files, under a new prefix, using the existing size and type limits.

## 6. Open questions for chew

- None that blocks this version.
- The Goods kind waits on chew and management (§2).
- The PO link for Supply chain goods will be asked when Goods is designed.

## 7. Out of scope here, noted

- This branch's `migrations-pg/0162_project_limit.sql` clashes with main's 0162. It must be renumbered before this work's migrations are numbered. This is already on the follow-up list.
- The expense category list (SOP §2) does not exist yet. Lines use accounts marked staff-visible until it does.
