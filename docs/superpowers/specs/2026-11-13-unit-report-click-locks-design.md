# Unit report click-to-lock — design

Date: 13 Nov 2026. Owner: chew (finance). Builds on the owner statement close locks, parts 1–3, all live
(`docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md`; #892/0302, #897/0303, #911/0308, #934/0321).
Mockup: Claude Design canvas "Unit report locks" (https://claude.ai/artifact/HPoearT5SWXW2RgNzEWved), sample numbers.
chew, after the canvas: "可以，写设计文件", then "写完直接做" (build straight after writing; no separate approval of this
document). Her standing rule: no test step by her; release once checks, the review and CI pass ("直接上线").

## Why

Today a month is closed on its own page, Owners › Statement close: three steps (Income, Deductions, O2), each a list
of units to tick and lock, and a fourth step that sends you to the Unit report to make each owner final. After reading
the how-to (13 Nov) chew found it scattered: the checking happens on Airbnb reconciliation, Utility bills and the Unit
report, but the locking happens somewhere else, one step at a time ("我觉得整体很多地方都要分开去按"). She wants to lock
where the numbers are: on the Unit report, by clicking the amount she has just checked, and on the work pages right
after the work ("上传后确定完那边一次性锁"). She also wants deductions split, so utilities, cleaning, other deductions
and misc are each locked on their own ("这个我想要分开", "这个也分开可以吗"), and Final to be one of the locks on the
same page ("可以把final 这个给锁也做在这边吗").

Success: closing October is done on the Unit report (Monthly) with clicks on amounts and column buttons, the work pages
show and change the same locks, and every figure the report shows for a locked amount never changes again.

## Words

- A **lock category** (her "大锁", big lock, as a category): Revenue, Cleaning, Utilities, Add. ded., Misc, O2.
- A **small lock** ("小锁"): one category of one unit for one month.
- **Lock all / Unlock all**: every unit of the month in one category at once. A category is closed for the month when
  all its units are locked (chew: "对").
- **Final**: an owner's statement made final. It is a lock too, on the same page.

## Goals

1. Six lock categories per unit and month, from October 2026 (`LOCK_FROM`), replacing today's three steps:
   - **Revenue**: today's income lock, renamed on screen only (the stored stage stays `income`).
   - **Cleaning**: the owner's cleaning charges (`classifyCost` → `cleaning_basic`, `cleaning_deep`).
   - **Utilities**: electricity, water, internet and Indah Water together (`electricity`, `water`, `internet`, `sewerage`).
     The four columns lock and unlock together.
   - **Add. ded.**: every other cost charged to the owner (`classifyCost` → `additional`: repairs, the Deductions page's
     additional deductions, anything else).
   - **Misc**: the month's miscellaneous charge (RM 100 × occupancy on contracts that have it).
   - **O2**: today's O2 lock.
   Today's single deductions lock is split into Cleaning, Utilities, Add. ded. and Misc; each keeps only its own part.
2. Each lock behaves like today's locks: what it keeps never changes; a later change to that part (a reservation, a late
   bill, a cost edited, a new owner adjustment) goes to the next open month, worked out through the contract, with the
   company's share in the same month (choice A). A new cost dated in a month whose category is locked goes on the next
   month whose same category is neither locked nor final, as a late bill. Removing something a lock keeps is refused
   until that category is unlocked, as today.
3. **Unit report › Monthly is where a month is closed.** In the report's own layout (sections INCOME, DEDUCTIONS, PROFIT,
   OWNER, CLOSE with lines between them, chew: "每个section 直接要有线条像原本的这样"):
   - Clicking a lockable amount locks it; clicking it again unlocks it. No dialog, no reason ("小锁我觉得unlock 不要
     reason，毕竟我有大锁"; "点了amount,在点lock 会一直需要按"). History still records who and when.
   - A header row ("Whole column") under the column names has **Lock all** and **Unlock all** for each category, one
     click each ("我想要也可以一键unlock"). Utilities has one pair over its four columns.
   - Locked amounts are teal (青色), the lock icon on the left of the cell and the amount on the right. A lockable
     amount not yet locked shows a faint open lock. Pointing at an amount shows what is in it (reservations and nights,
     the bills, the cleans, the misc occupancy, the owner adjustments).
   - The Final column (CLOSE section, on each owner's first row) is a lock cell: **Make final** when every unit of the
     owner has all its categories locked; once final, a teal cell "Final · who · date"; clicking it unlocks the final,
     which asks why (it moves money: today's Unlock final rules, unchanged). Its Whole column pair: **Lock all** makes
     every ready owner final and names who still waits; **Unlock all** unlocks every final of the month with one reason.
   - While an owner is final, their amounts cannot be unlocked by a click; the click says to unlock the final first.
4. **Not lockable only while something is unconfirmed**: Revenue of a unit with Airbnb reservations still to confirm on
   Airbnb reconciliation (amber, warning icon; the click says why; Lock all skips it and names it). Nothing else blocks:
   a blank or zero amount can be locked ("别因为空白或没数额就不让锁", "这个别写死，因为可能真的迟来"); the existing
   hints (check-outs with no cleaning charged, a contract ended with bills, a held debt, a repeat of last month's O2)
   show when pointing at the amount, never block. The server enforces the unconfirmed rule, not only the screen.
5. **The work pages keep their own lock controls, the same locks both ways** ("两边是互通的"):
   - Airbnb reconciliation, which moves under the Unit report as a tab (Monthly | Airbnb reconciliation | Yearly | YGRR;
     "把Airbnb reconciliation 来出来放unit report"): a Revenue lock bar for the month (how many units are locked, which
     are waiting for confirmation, Lock all revenue, Unlock all).
   - Utility bills: a Utilities lock bar for the month.
   - Deductions (Owners › Deductions, where additional deductions and O2 are entered): an O2 lock bar and an Add. ded.
     lock bar.
   A lock taken on a work page shows on the Unit report at once, and the other way round: there is one lock store.
6. Owners › Statement close leaves the menu; its address opens the Unit report for the same month.
7. Make final needs every listed category locked for every unit of the owner (today's rule with six categories). Which
   categories list a unit: Revenue, Cleaning, Utilities, Add. ded. and Misc list every unit on a share (long-term lets
   included) with something in the month, as today's income and deductions steps do; O2 lists every unit on the
   statement, as today. Fixed rent and master lease stay off the first five, as today.

## Non-goals

- No change to how any figure is worked out: owner share, guarantees, misc rate, agent split, payouts.
- Statements stay one per owner per month ("照现在这样就好，不用分开 final"); payouts unchanged.
- No change to months before October 2026, and none to Unlock final's money rules (part 3).
- The agent % fill (migration 0322) and the utility payment request departments are separate work.

## Anti-goals (a failure even if it runs)

- A locked amount that changes, or a late change that is lost or counted twice.
- The two places disagreeing: a lock shown on one page and not on the other.
- A click that unlocks a final owner's amounts, or a final unlocked without a reason.
- Revenue locked while reservations are still to confirm.
- A slow page: the Unit report must not get noticeably slower to open than today.

## Decided (by chew)

- Six categories as above; Utilities' four columns are one lock; Misc and Add. ded. each their own.
- Click the amount to lock and click again to unlock; small unlocks take no reason.
- Lock all and Unlock all per column, one click each.
- Teal for locked, lock icon on the left.
- The report's sections and lines stay as they are.
- Final is on the same page as a lock; Make final there; Unlock final asks why.
- Unconfirmed blocks; blank or zero does not.
- Work-page locks stay and are the same locks.
- Airbnb reconciliation sits under the Unit report.

## Calls made by me (Claude), to be read with the review

- **Stored stages**: `income` keeps its name (Revenue on screen); `deductions` is retired and replaced by `cleaning`,
  `utilities`, `additional` and `misc`; `o2` stays. A migration converts any stored `deductions` lock into the four, each
  keeping its part of the frozen costs (by `classifyCost`) and the frozen misc. Production had no locks on 13 Nov.
- **Who can lock and unlock**: the existing per-person powers, unchanged in Users and roles: Lock income → Revenue;
  Lock deductions → Cleaning, Utilities, Add. ded. and Misc; Lock O2 → O2; Unlock a step → every unlock, small or whole
  column (now without a reason); Make final and Unlock final as today. A person without the power sees the locks but the
  click explains it is not theirs to change.
- **Late update split**: each lock carries the change in its own part. The late update works a unit-month out with the
  locked categories turned back to live one at a time, in the order Revenue, Cleaning, Utilities, Add. ded., Misc; each
  lock's share is the difference its step makes to what the owner is due (and to the company's figure). A misc change
  that comes from a reservation now goes with the Misc lock when Misc is locked, and with Revenue when it is not
  (spec call 11's intent, now that misc has its own lock).
- **Make final regenerates first**: clicking Make final (or Lock all in the Final column) generates that owner's
  statement again before finalising it, so nobody has to press Generate after locking. It is refused, as today, on
  unconfirmed bills (stale scanned bills), an owner adjustment that changed, or a category still open.
- **Unlock all finals** runs Unlock final for each final owner of the month with the one reason, and reports the ones
  refused (a transfer under way) by name.
- **Where Cleaning and Misc lock**: only on the Unit report (they have no work page of their own).
- **Lock bars on work pages** show counts and the two buttons, plus the units that cannot be locked yet; per-unit
  clicking stays on the Unit report.
- **Statement close** is removed from the menu and its page code removed; `/owners/close` redirects to
  `/portfolio/owner-report?month=…`. The close page's API (`/api/owner-close`) is replaced by the Unit report's data and
  a lock API that takes a category and many units, for lock and for unlock.
- **Phone**: the Unit report's phone cards show the lock state of each category and the Final state; locking from a
  phone is not offered (money is desk work, as Owner payouts).
- Wording on screens and in notices: "Revenue", "Cleaning", "Utilities", "Add. ded." (in messages: "other deductions"),
  "Misc", "O2".

## Left to the builder

- The API shape (one lock endpoint with `category`, `unitIds` and `action: lock|unlock`, or two), as long as the server
  checks the power, the month (ended, from October 2026), finals and the unconfirmed rule, and returns which units were
  done, already done, refused and why.
- How the Unit report payload carries per-unit lock state, the hover breakdowns and the blocked reason without a second
  slow query.
- The trigger (`expenses_deduct_month()`, migration 0303) rewritten per category; its SQL classification must match
  `classifyCost` exactly.
- Tests: every rule above has an API check, the pure rules unit tests; the existing owner-close checks are moved to the
  new categories.
- FINANCE-SOP §9.1 rewritten in Chinese for the new way, keeping the rules that did not change.
