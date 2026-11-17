# Owner report stage locks — design

Date: 11 Nov 2026. Asked for by chew, finance owner of The Conts (conversation of 11 Nov 2026).
Mockup: `exports/lock-flow-mockup-2026-11-11.html` (six screens, sample figures). chew on the mockup: "整体都差不多了".

## Why

Each month chew checks the owner report in stages: income first, then deductions, then owner adjustments (O2), and only then the gross profit per unit and the company's profit after paying the owner. Today nothing holds a stage still once it is checked: a booking corrected in the Airbnb reconciliation, a utility bill entered late, or an O2 added afterwards changes figures she has already checked, and the only freeze is making an owner's statement final.

chew: "就是我确定income 对了就lock, 然后可能deduction 对完了lock, O2 检查完了就lock， 然后就有我的gross profit per unit 了， 就是分阶段lock".

Success: for any month, chew can see unit by unit which stages are checked and locked, by whom and when. Locked figures never change. Nothing that arrives late is lost. The company's profit per unit (after the owner, split between the company and the agent) is final when all three stages are locked.

## Goals

1. Three locks per unit per month: **Income**, **Deductions**, **O2**.
2. Lock by ticking units, then pressing Lock. Unticked units stay unlocked. chew: "应该是我要锁的我tick 了锁".
3. Units can be locked at different times. chew: "可以留部分单位".
4. Every lock and unlock records who did it and when. Every unlock also records a written reason.
5. chew gives each power to the colleagues who do that part, person by person. chew: "lock 的功能我会自己assign 去相关做的同事去lock", and "final 解锁权限我也能assign". The powers are:
   - Lock income
   - Lock deductions
   - Lock O2
   - Unlock a step
   - Make final
   - Unlock final
6. A late change never alters a locked figure. It goes to the next open month on its own, and the person making it is told so on screen.
7. An owner's statement can be made final only when every unit of that owner has all three locks for the month.
8. A final statement can be unlocked by whoever holds that power, with a reason. chew: "final还是要能解锁，但可能权限在我这里".
9. The Overall owner report shows each unit's locks. It also splits Gain / Loss into **Agent** and **Company** columns. chew: "要分开".
10. The Airbnb reconciliation page shows how many units' income is locked for the month, with a link to the locks page.

## Non-goals

- How income, deductions, O2, the split and the guarantee are worked out does not change. Locks freeze the result; they do not change the method.
- The ledger month-end lock (FINANCE-SOP §9) and the bank-month lock are separate and untouched.
- No locks for months before October 2026. September is imported and paid from the owner workbook; earlier months are frozen already.

## Anti-goals (would be a failure even if it "works")

- A lock that throws late data away. Examples: a bill entered after the lock disappears, or a booking correction is silently ignored.
- A lock that blocks daily work. Staff must still be able to extend a booking, record a bill or add an O2; it simply lands in the next open month.
- An unlock with no trace.
- Locked figures that drift when statements are generated again.

## Decided with chew

| Point | chew's words |
|---|---|
| Stages Income, Deductions, O2, then GP per unit | "income 对了就lock … deduction 对完了lock, O2 检查完了就lock" |
| Some units can be left unlocked and locked later | "可以留部分单位" |
| Lock only what is ticked | "应该是我要锁的我tick 了锁" |
| chew assigns lock powers to colleagues | "lock 的功能我会自己assign 去相关做的同事去lock" |
| Final can be unlocked; chew holds that power | "final还是要能解锁，但可能权限在我这里" |
| chew can also give the final-unlock power to others | "final 解锁权限我也能assign" |
| Gain / Loss split into company and agent | "要分开" |
| The six screens as mocked up | "整体都差不多了" |
| Unlock final depends on how far the payout has gone: not paid yet → back to draft and the payout follows the new figure; transfer in progress → refused until it ends; already paid → the paid amount stays and the difference goes to next month's O2 | "可以" (11 Nov, to the plain-words version) |

## My calls (shown to chew in chat and the mockup, not yet confirmed one by one)

These are the designer's decisions. chew may overrule any of them.

1. **Late changes go to the next open month.** The system already does this after a statement is final, and the locks reuse it:
   - A bill rolls to the next month's deductions. `utilityDeduction` in `functions/_lib/expenses.ts` already does this.
   - An Airbnb correction becomes an owner adjustment on the next open month. `functions/api/airbnb-recon/decisions.ts` already does this for final months.
   - An O2 is dated into the next month.
2. **"Next open month" for a unit and stage** is the first month after the change's own month in which, for that unit, that stage is not locked and the owner's statement is not final.
3. **Stages can be locked in any order.** Final needs all three.
4. **A unit that still has something to look at gets a warning when locked, not a block.** Examples: an Airbnb booking still to confirm, or a "needs a look" flag. The confirm dialog names those units. chew was asked and has not answered; if she says "block", the dialog refuses instead.
5. **Unlocking a final statement that is not yet paid** puts it back to draft (provisional) so it can be generated again. "Not yet paid" means Final, or Sent with the payout still Pending or Failed. Unlocking cancels that payout, which needs a new Cancelled state for payouts. When the statement is made final and sent again, a fresh payout is made. While the payout is Processing, unlock is refused. chew agreed to this on 11 Nov; see the table above.
6. **Unlocking a final statement that is already paid** leaves the paid amount as it is. The statement is worked out again, and the difference to what was paid becomes an owner adjustment in the next open month.
7. **Unlock a step** is one power covering all three stages. Unlock final is a separate power.
8. **Contract terms are not part of the stage locks; Final freezes them.**
   - The three locks freeze the inputs to GP: income, deductions and O2. Once all three are locked, GP per unit is final.
   - The split worked out from the contract (owner %, agent %, guarantee, fixed rent, misc flag) follows the contract as it stands until the owner's statement is made final. A contract corrected between the locks and Final reaches the month, and the Overall owner report shows the new split.
   - Final freezes the split, as a final statement does today. After Final, a contract change reaches the month only through Unlock final.
   - Exception: for a long-term let, income is the tenant's rent, which comes from the contract. The income lock freezes that rent like any other income.
   - So the agent % fill must land before Make final, not before the stage locks.
9. **Unlocking a step brings the month back to today's data.**
    - Late differences that were moved to a later month because of that lock come back to the unlocked month, and their adjustments are withdrawn. The exception is when the later month is already locked or final.
    - In that case the difference stays where it is, and the unlocked month is worked out without it, so nothing is counted twice or lost.
    - Every posted difference keeps a reference to the lock and the change it came from. Locking again freezes the month afresh.
10. **The owner's share of a late income change is the change in what the owner is due.**
    - Work out that unit and month again with the corrected income, guarantee or minimum included, and post the difference to the owner's payout. Do not apply a flat owner % to the change.
    - For yearly-guarantee units, create the adjustment as held for a person to check, because the year-end top-up depends on it.
11. **The deductions lock also freezes the miscellaneous charge** at its value when locked. If a later income change alters occupancy, and with it the misc charge of a deductions-locked month, the misc difference is included in that income change's next-month adjustment. Stages stay lockable in any order.
12. **Agent and Company columns.**
   - Agent = GP × the contract's agent % on share contracts (PS), even when a guarantee top-up applies. This is how the owner workbook's A PAYOUT works: checked on all 78 share rows of the October 2026 workbook.
   - Agent = 0 on fixed-rent (LT / GRR) units.
   - Company = Gain / Loss − Agent, so the two columns always add up to Gain / Loss. Under a guarantee top-up, Company carries the top-up.
   - The workbook's own M PAYOUT column (GP × manage %) is not shown: under a top-up it does not add up to the company's result.

## Data gap the build must close

`owner_contracts.agent_fee_pct` is empty on every one of the 136 contracts in force on production (checked 11 Nov 2026), and `management_fee_pct` holds the operator's whole share. The October 2026 owner workbook (`OWNER REPORT OCT26 V2`, sheet 整体报告, columns MANAGE% and AGENT%) has the agent % for the 78 share units.

Before the Agent column means anything, the agent % has to be filled in on the contracts. Take the workbook's figures, after chew has seen the list. Use insert/update only, through a migration or an approved script.

Rows where owner% + manage% + agent% ≠ 100% (4 of 78) are listed for chew rather than guessed.

## How it behaves

### Stage 1 — Income

- What it covers: the unit's income for the month as the statement engine works it out (`ownerStatement.ts`). That is hospitality income by night from the host payout, long-term rent, and fixed rent where the contract has one.
- Locking freezes those figures for the unit and month, per booking part. Generating statements again uses the frozen figures for locked units.
- After the lock, a change that would alter the frozen month leaves the frozen figure alone. Examples: an Airbnb reconciliation confirm, a manual edit of a booking's amount or dates, a cancellation coming in from HostPlatform or Channex. Instead, the owner's share of the difference becomes an owner adjustment in the next open month. The Airbnb reconciliation already does this for a final month (source `airbnb_recon`). Under the locks, the owner's share is worked out as in my call 10, not as the flat % that `ownerShareOfChange` applies today.
- The Airbnb reconciliation page shows a banner: "October income is locked for 92 of 114 units", with a link to the locks page.

### Stage 2 — Deductions

- What it covers: the unit's owner-charged costs whose deduction month is the locked month. These are cleaning, utilities, additional deductions and miscellaneous charges.
- A new or edited cost for a locked unit-month goes to the next open month instead. Screens that add or edit costs show this as a notice, for example: "October deductions are locked for S-22-04. This bill goes to November." Those screens include:
  - Utility bills: manual entry and Scan bills → Record;
  - expense entry;
  - cleaning charges and the clean-charges catch-up;
  - approvals that write expenses.
- Deleting a cost on a locked unit-month is refused, with a message saying which month is locked and who can unlock it.
- Miscellaneous charges are worked out from occupancy, so they follow the income lock's frozen occupancy.

### Stage 3 — O2

- What it covers: the owner adjustments that the month's statement takes for the unit, as `adjustmentsFor` picks them. An adjustment with no unit goes on the owner's first unit.
- After the lock, a new adjustment is dated into the next open month. Editing, releasing (held → open) or settling an adjustment that sits in a locked month is refused, with the same message.

### Final

- **Make final** is offered for an owner only when all the owner's units have all three locks. Today's `POST /api/statements/finalise` refuses otherwise.
- **Unlock final** asks for a reason. It follows my calls 5 and 6.

### Locks page — "Owner report close" (new, under Owners)

Screens 2–4 of the mockup:
- one month per page;
- a four-step strip (Income / Deductions / O2 / GP and final) with "X of Y units locked";
- per stage, a unit table with a tick box, the stage's figures, a "Check" chip (for example "1 booking to confirm", "Contract ended: whole bill on owner", "Held debt not released") and the status (Not locked / Locked · who · when, with Unlock for permission holders);
- filters for All / Not locked / Needs a look / Locked;
- a primary "Lock income (n)" button and a confirm dialog.

The Check chips are hints. Which flags to show first is left to the builder; start with the ones in the mockup.

### Overall owner report

Screen 5 of the mockup adds:
- a Locks column (Income / Ded. / O2 chips);
- the Agent and Company columns;
- the total row the page already has;
- a Final column per owner (Make final / Waiting: … / Final · who · when, with Unlock).

### Permissions

Screen 6 of the mockup. New access areas in `functions/_lib/access.ts`, set per person as the Permissions page already allows (department, position and user rules, migration 0145). Management is always Full.

## Constraints

- **Stack:** Property OS — Cloudflare Pages Functions in `functions/`, React in `src/`, Postgres schema `pos`.
- **Migrations:** run through `migrate-production.yml` (dry run first) with chew's OK. Production SQL through MCP is insert/update only, with no DROP or DELETE, even in comments.
- **New tables:** grant to `pos_app`, and add a demo view in `demo_pos` if the demo needs it.
- **Text:** product text in English (British). The vocabulary check applies (say "owner adjustments", not "owner credit"). No CJK in `src/`.
- **Tests:**
  - API checks in `scripts/api-checks/` run in CI.
  - Add the new routes to `rbac-matrix.expected.json`. The file uses CRLF.
  - Run `tsc -b` on its own.
- **UI:** use the project's own components and tokens (DataTable, Button, Toast tones success/warning/critical/info/neutral). Load the dashboard-design guidance for the new page.

## Left to the builder

- The data model. Suggestion: one row per unit, month and stage, holding who and when, plus the frozen figures as JSON for income. Unlocks go to `audit_log` with the reason.
- How generation reads frozen figures, and how late differences are found and posted. They must be posted exactly once, with a reference back to the change.
- Page structure and component reuse, as long as the screens behave as in the mockup.
- The exact set of "needs a look" checks.

## Open questions for chew

None left. A builder check on 11 Nov 2026 raised five questions:
- Four are settled above as my calls 8–11.
- The fifth (below) was chew's, and she agreed to the proposal on 11 Nov ("可以").

1. **Unlock final when the payout is under way.** After Final, a statement can move on as follows:
   - Sent: the owner is emailed, and a payout row is created as Pending, or Failed when there are no bank details.
   - Processing: the transfer is being made.
   - Paid.

   Proposed answer:
   - Final, or Sent with the payout still Pending or Failed: unlock puts the statement back to draft and cancels the payout. This needs a new Cancelled state for payouts. When the statement is made final again, it is sent again, which makes a fresh payout.
   - Processing: unlock is refused until the transfer is Paid or Failed.
   - Paid: my call 6 applies.

   Decided: chew, 11 Nov 2026, "可以".
