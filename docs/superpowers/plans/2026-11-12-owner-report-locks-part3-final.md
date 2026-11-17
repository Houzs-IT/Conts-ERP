# Owner report locks, part 3 (GP and final) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make final only once every step is locked; Unlock final as its own power, which cancels an unpaid payout or posts a paid statement's difference to the next open month; the Overall owner report shows Locks, Agent, Company and Final; the close page's step 4 counts finished owners.

**Architecture:** The rules stay pure in `functions/_lib/stageLocks.ts` and `src/lib/ownerOverall.ts` (node --test). The database side goes in `functions/_lib/ownerLocks.ts`: `finalReadiness`, worked out from `closeSteps`, and `unlockFinal`. The routes are `statements/finalise.ts`, which is gated, and the new `statements/unlock-final.ts`. One migration adds the payout state `cancelled`. A second migration, a data one, fills `owner_contracts.agent_fee_pct` from the October workbook once chew has seen the list.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), React + Tailwind tokens (`src/`), Postgres schema `pos`, API checks on PGlite (`scripts/api-checks/`), node --test.

**Spec:** `docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md`. Part 3 covers:
- goals 5 (Make final, Unlock final), 7, 8 and 9;
- my calls 5, 6, 8 and 12;
- "Final", "Overall owner report", "Data gap the build must close" and the mockup screen 5.

## Global Constraints

- **Language:**
  - Product text in British English.
  - The vocabulary check applies: say "owner adjustments", not "owner credit".
  - No CJK in `src/`.
- **Migrations:**
  - Run through "Apply migrations to production" (`migrate-production.yml`) with `only=`, dry run first.
  - Production SQL through MCP is insert/update only, with no DROP or DELETE, even in comments.
- **Release** (chew, 12 Nov 2026: "我不想要测试，直接上线让他们使用"):
  - No test steps for chew.
  - Once the checks, the final review and CI pass: migration dry run, apply, merge, check the deploys, report.
  - The agent % list is the one thing chew must see first.
- **Months:** no locks before October 2026 (`LOCK_FROM = '2026-10'`).
  - Make final keeps today's behaviour for earlier months.
  - Unlock final refuses them; they are imported from the owner workbook and paid.
- **Powers:** Make final and Unlock final are given one by one (`ownGrant`). Management always has them.
- **UI:**
  - Use the project's own components and tokens (DataTable, Button, StatusBadge, Toast tones, `useConfirm` with `reason`).
  - Numbers stay right-aligned and tabular.
  - Colour carries meaning only. A lock chip carries its text and an icon, never colour alone.
- **Checks:**
  - Add new routes to `scripts/api-checks/rbac-matrix.expected.json`. The file uses CRLF.
  - Run `tsc -b` on its own.
  - Add new API checks to `.github/workflows/ci.yml` (rbac job).

## Review Focus

1. **A unit joins a step after the owner's other units were locked**, for example an O2 added on a second unit. Make final must name that unit as waiting. Test: Task 3, `a unit that joins O2 after the locks is waiting`.
2. **Unlock final on a sent statement whose payout sits in a payout run waiting for approval.** Approving that run afterwards must not move the cancelled payout. Test: Task 4, `an approved run skips a cancelled payout`.
3. **The same paid statement unlocked twice.** The second unlock posts nothing more. Test: Task 4, `a second unlock of a paid statement posts nothing`.
4. **Payouts after an unlock and a re-send.** The cancelled payout counts in neither outstanding nor paid, and the fresh payout is pending. Test: Task 4, `the payouts list keeps cancelled apart`.
5. **Negative GP on a share unit.** Agent follows the October workbook, decided from the data in Task 1, and Agent + Company still add up to Gain / Loss. Test: Task 2, `agent and company on a negative GP`.

---

### Task 1: Agent % list for chew (data only)

**Files:**
- Create (scratchpad, never committed): `<scratchpad>/agent-pct/build.cjs`
- Create (untracked): `exports/agent-pct-to-confirm-2026-11-12.xlsx`
- Create later (Task 8): `migrations-pg/0322_agent_fee_pct_oct26.sql`

**Interfaces:**
- Produces: a list of `{ unitCode, contractId, ownerPct, managePct, agentPct, systemOperatorPct, status }`. `status` is OK, or names what differs.

- [ ] **Step 1: Read the workbook.** Open `C:\Users\User\Downloads\OWNER REPORT OCT26 V2 (2) (1).xlsx`, sheet 整体报告. Read the unit, OWNER %, MANAGE % and AGENT % columns, plus GP and A PAYOUT for the negative-GP check.
- [ ] **Step 2: Match the units to production (read only).**
  - Match by `unitCode(property_name, unit_number)` with non-alphanumerics and "(A)" stripped, as `sep-tools/lag2.cjs` did.
  - Take each unit's contract in force on 2026-10-31 from `owner_contracts`.
  - Also read `management_fee_pct`, `agent_fee_pct`, `contract_code` and whether the type has an agent share (`contractTypes`).
- [ ] **Step 3: Classify each row.**
  - OK: owner% + manage% + agent% = 100 (±0.01), and the system's `management_fee_pct` = manage% + agent% (±0.01), and the type allows an agent share, and agent% > 0.
  - Anything else is listed for chew, with the reason.
  - Units in the workbook with no match, and share contracts in the system missing from the workbook, are listed apart.
- [ ] **Step 4: Rule on negative GP.**
  - Find the share rows with GP < 0 and compare A PAYOUT with GP × AGENT %.
  - Ledger it: `Ruling: negative GP agent = <GP × % | 0> — <rows seen>`.
- [ ] **Step 5: Write the sheet and send it to chew.**
  - Write `exports/agent-pct-to-confirm-2026-11-12.xlsx` with OK rows first and the rows to check in yellow.
  - Send it with one question and one example ("C-27-01: owner 70%, manage 20%, agent 10% → agent 10% on its contract. 可以照填吗？").
  - Continue with Task 2 while waiting.

### Task 2: Pure rules: waiting, unlock plan, agent and company

**Files:**
- Modify: `functions/_lib/stageLocks.ts`
- Modify: `src/lib/ownerOverall.ts`
- Test: `src/lib/stageLocks.test.mjs`, `src/lib/ownerOverall.test.mjs`

**Interfaces:**
- Produces (stageLocks.ts):
  - `interface FinalUnit { unitId: string; label: string; steps: Stage[]; locked: Stage[] }`
  - `finalWaiting(units: FinalUnit[]): { unitId: string; label: string; stages: Stage[] }[]`: units with a step not locked, stages in Income, Deductions, O2 order.
  - `waitingText(waiting: { label: string; stages: Stage[] }[], ownerUnits: number): string`
  - `type FinalUnlock = { kind: 'draft'; cancelPayout: string | null } | { kind: 'paid' } | { kind: 'refused'; problem: string }`
  - `unlockFinalPlan(statementState: string, payout: { id: string; state: string } | null): FinalUnlock`, where `payout` is the latest payout that is not cancelled.
  - `finalUnlockText(unitLabel: string, label: string): string`
- Produces (ownerOverall.ts):
  - `OverallInput.agentPct: number`
  - `OverallFigures.agent: number` and `OverallFigures.company: number`
  - `'agent'` and `'company'` in `SUMMED`

- [ ] **Step 1: Write the failing tests**

```js
// stageLocks.test.mjs
test('nothing waiting once every listed step is locked', () => {
  assert.deepEqual(finalWaiting([{ unitId: 'a', label: 'S-22-04', steps: ['income', 'deductions', 'o2'], locked: ['o2', 'income', 'deductions'] }]), []);
});
test('a unit is waiting on the steps not locked, in step order', () => {
  assert.deepEqual(finalWaiting([{ unitId: 'b', label: 'B-16-05 (B)', steps: ['income', 'deductions', 'o2'], locked: ['income', 'deductions'] }]),
    [{ unitId: 'b', label: 'B-16-05 (B)', stages: ['o2'] }]);
});
test('waiting text names stages for a one-unit owner, units otherwise', () => {
  assert.equal(waitingText([{ label: 'A-20-05', stages: ['deductions', 'o2'] }], 1), 'Waiting: deductions, O2');
  assert.equal(waitingText([{ label: 'B-16-05 (B)', stages: ['o2'] }], 2), 'Waiting: B-16-05 (B) O2');
  assert.equal(waitingText([{ label: 'X', stages: ['income'] }, { label: 'Y', stages: ['o2'] }, { label: 'Z', stages: ['o2'] }], 5),
    'Waiting: X income, Y O2 and 1 more unit');
});
test('unlock plan follows the payout', () => {
  assert.deepEqual(unlockFinalPlan('finalised', null), { kind: 'draft', cancelPayout: null });
  assert.deepEqual(unlockFinalPlan('sent', { id: 'p', state: 'pending' }), { kind: 'draft', cancelPayout: 'p' });
  assert.deepEqual(unlockFinalPlan('sent', { id: 'p', state: 'failed' }), { kind: 'draft', cancelPayout: 'p' });
  assert.equal(unlockFinalPlan('sent', { id: 'p', state: 'processing' }).kind, 'refused');
  assert.deepEqual(unlockFinalPlan('paid', { id: 'p', state: 'paid' }), { kind: 'paid' });
  assert.equal(unlockFinalPlan('provisional', null).kind, 'refused');
});
// ownerOverall.test.mjs
test('agent is GP x agent % on a share, company the rest of gain / loss', () => {
  const f = overallFigures({ ...PS_ROW, revenue: 300000, cleaning: 0, utilities: 0, additional: 0, misc: 0, ownerPct: 70, agentPct: 10, ltGrr: 0 });
  assert.equal(f.agent, 30000); assert.equal(f.company, f.gainLoss - 30000);
});
test('agent is 0 on LT whatever its agent %', () => { assert.equal(overallFigures({ ...LT_ROW, agentPct: 10 }).agent, 0); });
test('agent and company on a negative GP', () => { /* the Task 1 ruling's value; agent + company === gainLoss */ });
```

- [ ] **Step 2: Run them and see them fail.**
  - Run: `node --test src/lib/stageLocks.test.mjs src/lib/ownerOverall.test.mjs`
  - Expected: FAIL, because finalWaiting, waitingText, unlockFinalPlan and agent are not defined.
- [ ] **Step 3: Implement the rules.**
  - `waitingText` names at most two units, then "and N more unit(s)".
  - Stage names come from `STAGE_NAME` (income, deductions, O2).
  - `unlockFinalPlan`:
    - provisional → refused, "This statement is a draft, so there is nothing to unlock."
    - a payout that is processing → refused, "The payout is being transferred. Unlock the statement once the transfer is paid or has failed."
    - a paid statement, or a paid payout → `paid`.
    - otherwise → `draft`, cancelling a pending or failed payout.
  - `finalUnlockText` → `Change to ${unitLabel} for ${label} after it was paid (statement unlocked)`.
  - `overallFigures`: `agent = contract === 'PS' ? <Task 1 ruling on roundSen(gp * agentPct / 100)> : 0` and `company = gainLoss - agent`.
- [ ] **Step 4: Run them and see them pass.**
  - Run the command from Step 2.
  - Expected: PASS, every test.
- [ ] **Step 5: Commit**: `feat(owner-close): part 3 rules: waiting, unlock final plan, agent and company`.

### Task 3: Make final needs every step locked; the Make final and Unlock final powers

**Files:**
- Modify: `functions/_lib/access.ts`: add the areas `makeFinal` ("Make final") and `unlockFinal` ("Unlock final"), group Units, `ownGrant: true`. Add the route rule for `POST /api/statements/(finalise|unlock-final)`.
- Modify: `functions/_lib/ownerLocks.ts`: add `finalReadiness`.
- Modify: `functions/api/statements/finalise.ts`
- Modify: `src/pages/StatementsPage.tsx`: Mark final only with `makeFinal`; failed reasons are shown as today.
- Create: `scripts/api-checks/owner-close-final.mjs`, the checks of Tasks 3 and 4.
- Modify: `.github/workflows/ci.yml`: add a step after owner-close-late.
- Modify: `scripts/api-checks/rbac-matrix.expected.json` (CRLF)

**Interfaces:**
- Consumes: `finalWaiting`, `waitingText` and `FinalUnit` (Task 2), and `closeSteps` (ownerLocks.ts).
- Produces: `finalReadiness(env: Env, month: string): Promise<Map<string /* ownerId */, FinalUnit[]>>`. It covers every owner with a unit on one of the month's steps. Each unit is labelled `unit_code || unit_number`.

- [ ] **Step 1: Write the failing API checks** in `owner-close-final.mjs`. It has its own owner, building and two units (`ocf-*`), set up as in `owner-close-steps.mjs`:
  - `finalise refuses while a step is open`: lock income and deductions only; finalise; `failed[0].reason` starts with `Waiting:` and names `O2`.
  - `finalise passes once every step is locked`: lock O2 too; generate October again; finalise; `finalised === 1`.
  - `a unit that joins O2 after the locks is waiting`: a second unit gets an October owner adjustment after the others were locked; finalise is refused and names that unit.
  - `September keeps today's finalise`: a September draft with no locks is finalised.
  - `Make final is a power given one by one`: a finance staff user with no `makeFinal` gets 403. Given `makeFinal` 'edit' as a user rule, the same user gets 200.
- [ ] **Step 2: Run them and see them fail.**
  - Run: `DB_URL=… API_BASE=http://localhost:8788 node scripts/api-checks/owner-close-final.mjs`
  - Expected: FAIL. Finalise ignores the locks, and finance passes `session.manage`.
- [ ] **Step 3: Implement.**
  - `finalReadiness` groups `closeSteps(env, month)` (`steps`, `locks`, `dated[].ownerId`, `inputs.units`) by owner.
  - `finalise.ts`:
    - Check `can(session, 'makeFinal', 'edit')`. Without it: 403, "Your access does not include Make final."
    - For each month ≥ `LOCK_FROM` among the provisional statements, call `finalReadiness`.
    - Refuse an owner whose `finalWaiting` is not empty, with the reason `${waitingText(...)}. Lock every step on Owner statement close before marking it final.`
    - Keep the stale and adjusted checks first.
- [ ] **Step 4: Run them and see them pass.**
  - Run the check from Step 2, then `node scripts/api-checks/owner-close.mjs`, `owner-close-steps.mjs`, `owner-close-late.mjs` and `rbac-matrix.mjs` on a fresh database.
  - Expected: all pass. Update the other checks wherever they finalise as finance staff: they must lock first, or act as management.
- [ ] **Step 5: Commit**: `feat(owner-close): Make final only once every step is locked; Make final and Unlock final powers`.

### Task 4: Unlock final, with a Cancelled payout state

**Files:**
- Create: `migrations-pg/0321_owner_final_unlock.sql`. The number is checked against main and production at release.
  - `payouts_state_check` gains `'cancelled'`.
  - Like 0302: `select demo.drop_views();` before, `select demo.sync();` after.
  - Header: APPLY with `only=0321`, dry run first; REVERSAL.
- Modify: `functions/_lib/ownerLocks.ts`: add `unlockFinal`.
- Create: `functions/api/statements/unlock-final.ts`
- Modify: `functions/api/statements/send.ts` and the POST in `functions/api/payouts/index.ts`: `has_payout` ignores cancelled payouts.
- Modify: the PATCH and GET in `functions/api/payouts/index.ts`, and `functions/api/payouts/export.ts`.
  - PATCH refuses a cancelled payout: "That payout was cancelled when its statement was unlocked."
  - GET: `cancelled` is a state of its own, ordered last, outside `outstanding`.
- Modify: `src/pages/PayoutsPage.tsx`: a Cancelled filter and badge, neutral tone.
- Test: `scripts/api-checks/owner-close-final.mjs`, continued.

**Interfaces:**
- Consumes: `unlockFinalPlan` and `finalUnlockText` (Task 2), `finalReadiness` (Task 3), and the existing `planLate`, `openMonthAfter`, `closedMonthsFor`, `companyFigure` and `LATE_INCOME_LOCK`.
- Produces:
  - `unlockFinal(env, who: { userId: string; fullName: string }, statementId: string, reason: string): Promise<{ ok: true; outcome: 'draft'; payoutCancelled: boolean } | { ok: true; outcome: 'paid'; posted: { unitId: string; month: string; amount: number }[] } | { problem: string; status: 404 | 409 | 422 }>`
  - Route `POST /api/statements/unlock-final { statementId, reason }`. Its answer is the result above.
  - It needs `can(session, 'unlockFinal', 'edit')`, else 403. The reason is required, 1–500 characters, else 422.

- [ ] **Step 1: Write the failing API checks** (owner-close-final.mjs, continued):
  - `unlock final on a final statement makes it a draft`.
  - `unlock final on a sent statement cancels its payout`: the payout is `cancelled` and the statement `provisional`.
  - `make final and send again makes a fresh pending payout`: two payouts, one cancelled and one pending.
  - `the payouts list keeps cancelled apart`: GET /api/payouts `counts.cancelled === 1`, and `outstanding` counts only the pending one.
  - `an approved run skips a cancelled payout`: queue a payout run, unlock, approve the run. The answer is "None of these owner payouts is still pending", and the payout stays `cancelled`.
  - `a processing payout refuses unlock`: 409, and the statement stays sent.
  - `a paid statement keeps its payout and posts the difference`:
    - Pay it, raise the contract's owner % by 10, then unlock.
    - One owner adjustment on November for that unit equals the new O1 less the paid one.
    - A `company_late_changes` row holds the opposite.
    - The statement stays `paid`.
  - `a second unlock of a paid statement posts nothing`.
  - `September cannot be unlocked`: 409. `no reason`: 422. `Unlock final is a power given one by one`: 403 without it, 200 with it.
- [ ] **Step 2: Run them and see them fail.**
  - Run the check as in Task 3, Step 2.
  - Expected: FAIL, because the route is missing (404).
- [ ] **Step 3: Implement.**
  - One transaction holds `LATE_INCOME_LOCK`, `SELECT … FOR UPDATE` on the statement, and its latest payout that is not cancelled.
  - It refuses:
    - a month before `LOCK_FROM`;
    - a source other than `generated`;
    - whatever `unlockFinalPlan` refuses.
  - `draft`:
    - `state = 'provisional'`, `finalised_at = NULL`, `sent_at = NULL`;
    - a pending or failed payout becomes `cancelled`;
    - audits: `statement.unlock_final { before, reason, payoutCancelled }` and `payout.cancel`.
  - `paid`:
    - Refuse when `finalReadiness` shows anything waiting for the owner. The text: "Its steps were not all locked when it was made final, so it can't be worked out again. Post the difference as an owner adjustment instead."
    - Recompute the owner's units with `computeMonth(month, inputs, settings, 'dated')`.
    - For each unit, the owner's difference is `payoutBeforeAdjustments` less `statement_units.payout_before_adjustments`. The company's difference is `companyFigure` (new) less `companyFigure` (stored `gross_income`, `deductions`, `payout_before_adjustments`, `top_up`, yearly from `revenue_model`).
    - `planLate` posts each against the rows already posted with reference `final-unlock:<statementId>` for that unit. Owner adjustments: source `stage_lock`, held on a yearly guarantee, description `finalUnlockText`. `company_late_changes`: same reference.
    - The target month is `openMonthAfter(month, closedMonthsFor(unit, 'o2'))`.
    - The statement and its payout stay as they are.
    - Audit: `statement.unlock_final { state: 'paid', reason, posted }`.
- [ ] **Step 4: Run them and see them pass.**
  - Run: the full `owner-close-final.mjs`, `owner-close*.mjs` and `rbac-matrix.mjs`, plus `npx tsc -b` on its own.
  - Expected: all pass.
- [ ] **Step 5: Commit**: `feat(owner-close): Unlock final with a Cancelled payout state (migration 0321)`.

### Task 5: Overall owner report: Locks, Agent, Company and Final

**Files:**
- Modify: `functions/api/portfolio/owner-report.ts`
- Modify: `src/pages/OwnerOverallReportPage.tsx`
- Modify: `src/pages/OwnerOverallDetail.tsx`: the drawer shows Agent and Company under Gain / Loss.
- Test: `scripts/api-checks/owner-close-final.mjs`, which reads the report.

**Interfaces:**
- Consumes: `finalReadiness` (Task 3) and `overallFigures`' `agent` and `company` (Task 2).
- Produces:
  - API rows gain `ownerId`, `agentPct`, `steps: Stage[]` and `locked: Stage[]`.
  - The payload gains `owners: Record<string, { statementId: string | null; state: 'none' | 'draft' | 'final'; waiting: string | null; by: string | null; at: string | null; paid: boolean; transferring: boolean }>`.
  - It also gains `may: { makeFinal: boolean; unlockFinal: boolean }` and `lockFrom: '2026-10'`.
  - `by` and `at` come from the latest `statement.finalise` row in `audit_log`.

- [ ] **Step 1: Write the failing API check.** `the overall report carries locks, agent % and the owner's final state`:
  - the check's unit row has `locked` = all three and `agentPct` as set;
  - its owner has `state: 'final'`, `by`, and `waiting: null`;
  - another owner shows `waiting` beginning with `Waiting:`.
- [ ] **Step 2: Run it and see it fail.**
  - Expected: FAIL, because the fields are undefined.
- [ ] **Step 3: Implement the API.** `finalReadiness` runs in parallel with the report's own loads.
- [ ] **Step 4: Implement the page.**
  - Agent and Company are money columns after Gain / Loss (group `res`, level 1). They are in the totals row, the export and the column chooser. Company uses the `gl` tone, as Gain / Loss does.
  - Locks is three small chips (Income, Ded., O2):
    - locked: a filled chip with a lock icon;
    - not locked: an outline chip;
    - not on that step: "–".
    - The title gives "Income locked" or "Income not locked".
  - Final is per owner:
    - Every row of the owner shows the state: "Make final", "Waiting: …", "Draft not generated" or "Final · who · 15 Nov".
    - Only the owner's first row in the current order shows the button.
  - Make final asks first: "Make the October 2026 statement final for <owner>?". It then posts finalise, toasts, and reloads.
  - Unlock final asks for a reason, as in mockup screen 5:
    - Body: "<owner>. The statement goes back to draft so it can be worked out again."
    - When paid: "Already paid: the paid amount stays, and the difference goes to <next month> as an owner adjustment."
    - When transferring, the button is disabled with the title "The payout is being transferred."
  - The Final column and its buttons appear only from `lockFrom`, and only with `may.*`.
  - On a phone, Locks and Final sit under the unit in the row's card, as the table already does with `phone` columns.
- [ ] **Step 5: Run the checks.**
  - Run: `node --test src/lib/ownerOverall.test.mjs`, the API check, `npx tsc -b` and `npm run check`.
  - Look in the browser on a local copy at 1280 and 375 px, light and dark.
  - Expected: all pass. The totals' Agent + Company equal Gain / Loss.
- [ ] **Step 6: Commit**: `feat(owner-report): Locks, Agent, Company and Final on the Overall owner report`.

### Task 6: Owner statement close, step 4 (GP and final)

**Files:**
- Modify: `functions/api/owner-close/index.ts`: add `final: { final: number; total: number }`. `total` is the owners in `finalReadiness`; `final` is those of them whose statement is final.
- Modify: `src/pages/owners/OwnerReportClosePage.tsx`: step 4 becomes a button.
  - It shows "<final> of <total> owners final", with Done, In progress or Not yet as the other steps do.
  - It opens `/portfolio/owner-report?month=<month>`.
  - Remove "Comes in a later update" and update the file's header comment.

- [ ] **Step 1: Write the failing check.** In owner-close-final.mjs: `the close page counts owners final`, `final.total ≥ 1` and `final.final` grows by one after the check's finalise.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass,** then look at the strip in the browser.
- [ ] **Step 5: Commit**: `feat(owner-close): step 4 counts owners final and opens the Overall owner report`.

### Task 7: SOP and plan record

**Files:**
- Modify: `docs/finance/FINANCE-SOP.md`, the owner statement close section. Record:
  - Make final needs every step locked;
  - Unlock final's three cases;
  - the two new powers given one by one;
  - Agent and Company.
- Modify: this plan. Add "As built" at the end, with every ruling.

- [ ] **Step 1: Write both.** Then run `npm run check`, which includes the vocabulary check. Expected: 17/17.
- [ ] **Step 2: Commit**: `docs(owner-close): part 3 in the SOP and the plan's As built`.

### Task 8: Agent % fill (after chew's OK on Task 1)

**Files:**
- Create: `migrations-pg/0322_agent_fee_pct_oct26.sql`. The number is checked at release.
  - It holds `UPDATE owner_contracts SET agent_fee_pct = x.pct FROM (VALUES …) x(id, pct) WHERE owner_contracts.id = x.id AND owner_contracts.agent_fee_pct IS NULL`.
  - It covers only the rows chew approved.
  - The header names the list and chew's words.

- [ ] **Step 1: Dry run on production.**
  - Expected: only 0321 and 0322 are pending of ours.
- [ ] **Step 2: Apply.** Then check, read only:
  - the number of contracts with `agent_fee_pct` set equals the approved rows;
  - `management_fee_pct` is unchanged.
- [ ] **Step 3: Commit** the migration with the release.

### Release (after the final review and CI)

1. Check the migration numbers against main and production, and renumber if they are taken.
2. Run 0321 (and 0322 once approved): dry run, apply with `only=`, then check read only.
3. Merge main into the branch. Run `tsc -b` alone, `npm run check`, and the owner-close checks.
4. Wait for CI to pass, then merge the PR.
5. Confirm the deploys: Property OS, scheduled jobs and the staging preview.
6. Update memory and report to chew. No test steps.

---

## As built (12 Nov 2026)

**Commits** (branch `feat/owner-close-part3`):
- 6525dc3: Task 2, the rules.
  - `finalWaiting`, `waitingText`, `unlockFinalPlan` and `finalUnlockText` in `stageLocks.ts`.
  - Agent and Company in `ownerOverall.ts`.
- 34742cc: Task 3, Make final needs every step locked.
  - The `makeFinal` and `unlockFinal` powers, and `finalReadiness`.
  - Other checks now set up their final months in the database.
- 9e9eac6: Task 4, Unlock final.
  - Migration **0321**: the payout state `cancelled`.
  - Payouts: a cancelled payout is kept apart, can't be paid, and does not count as "already has a payout".
  - Demo mode refuses Unlock final.
- bcef48e: Task 5, the Unit report (Overall owner report).
  - Agent and Company columns.
  - A Close band with Locks and Final, and the Make final and Unlock final dialogs.
  - Phone cards, the export and the drawer.
  - Unlock final's paid path writes in batches.
- 6c4199a: Task 6, step 4 on Owner statement close.
- Then the SOP commit (Task 7).

**Where it differs from the plan.** Each change is a `Ruling:` line in the ledger.
- **Negative GP.** Agent = max(0, GP × agent %). Neither the September nor the October 2026 workbook has a negative-GP share row to copy, and an agent shares profit, not a loss.
- **Months that can't be made final yet.** Make final is refused for every month from October 2026 without the locks, including a month that hasn't ended. The checks that made October, November or 2027 final only to set up a final month now set that state in the database (airbnb-recon, late-bills, owner-close).
- **Owner adjustments.** A unit whose only October item is an owner adjustment is on all three steps, so Make final also waits for its income and deductions locks. The close page already listed it that way.
- **Waiting text.** It reads as a list: "Waiting: deductions and O2" and "Waiting: F-02 income, deductions and O2; B-16-05 (B) O2; 1 more unit". The mockup's comma form read badly with three steps.
- **Unlock final on a paid statement.**
  - It posts per unit: an owner adjustment with source `stage_lock` and reference `final-unlock:<statement id>`, held on a yearly guarantee, plus the company's share in `company_late_changes`.
  - It is refused when the statement was made final before every step was locked.
- **Buttons.**
  - The Final state shows on every row of an owner. The buttons sit on the owner's first row in the current order.
  - Phone cards show state only, with no buttons.
- **Page name.** Step 4 names the page "Unit report", its on-screen title. The vocabulary check refuses "owner report".
- **Agent % list.** It lists the rows to check first.

**Checks**
- Rules: `node --test src/lib/stageLocks.test.mjs src/lib/ownerOverall.test.mjs`, 34/34.
- API on a local PGlite copy:
  - owner-close-final: 40/40 (new in CI);
  - owner-close: 38/38; owner-close-steps: 41/41; owner-close-late: 31/31;
  - late-bills: 27/27; airbnb-recon: 53/53.
  - demo-mode, role-access and unit-costs fail locally only on the operations-staff test account, which `scripts/ci-api-db.mjs` adds in CI.
- Builds and repo checks: `tsc -b` clean; `npm run check` 17/17.
- Browser, on a local copy with a fixture (one owner made final, one waiting):
  - widths: 1280 px light and dark, and 375 px with no sideways scroll;
  - the Unlock (reason required) and Make final round trip;
  - the drawer's Agent and Company;
  - totals: Agent 705 + Company 1,410 = Gain / Loss 2,115.

**Final review** (Opus, fresh context, 12 Nov). It found 2 Critical and 5 Important issues, all fixed in one pass, each with a check:

- **C1. Make final on an out-of-date draft.** Make final now refuses a draft made before the owner's latest lock or before Unlock final ("Generate the statement again, then mark it final").
- **C2. Cancelled payouts in the bank export.** The export always leaves cancelled payouts out, whether by month or ticked. The payout label says Cancelled.
- **I1. The company's side counted twice.** A paid unlock now posts the owner's difference only. The company views work a final month out with today's contract, so they already follow the correction. Spec call 8 (a frozen split in those views) is not built.
- **I2. The owner portal.** It never shows a cancelled payout.
- **I3. Make final against Unlock a step.** Make final re-checks the locks and updates in one transaction under the late update's lock.
- **I4. Send and Mark paid against Unlock final.** Send and the payout update check the state again in the same statement, so an unlock that lands in between is not overwritten.
  - The I3 and I4 race checks run on Postgres only (CI). PGlite runs one transaction at a time, so they could not be seen failing locally.
- **I5. False success messages.** Mark final and Send on the owner page and the statement page report a refusal instead of a green toast. Mark final shows only with the Make final power.

The pass also fixed two other things:
- `access.test.mjs` was missing the two new areas (found by `npm test`).
- A slip in the I1 edit had removed the late update's company lists; this was caught by the owner-close checks.

**Deferred minors**
- **Step 4** counts owners the Unit report can't act on: the placeholder owner, and units with no contract record. So it may never read Done.
- **A unit moved to another owner.** Unlocking a paid statement after one of its units moved posts that unit's whole payout as a charge on the old owner.
- **The paid-unlock refusal** checks today's locks, not the locks at Final.
- **The paid unlock's history and toast** leave out an adjustment it withdrew.
- **The Unit report** works the month out twice.
- **The negative-GP agent rule** (never below 0) is chew's to confirm.

**Checks after the fix pass**
- owner-close-final: 45/45 locally, 48 with the race checks on CI.
- owner-close: 38/38; owner-close-steps: 41/41; owner-close-late: 31/31; late-bills: 27/27.
- `tsc -b` clean; `npm run check` 17/17.
- `npm test` 419/420: `statementPdf` fails on main too.

**Release**
1. Migration **0321** goes to production: dry run, then `only=0321`.
2. Then merge. Property OS deploys from main.
3. Migration 0322 (agent %) waits for chew's answer on the list `exports/agent-pct-to-confirm-2026-11-12.xlsx`. Until then the Agent column is 0.
