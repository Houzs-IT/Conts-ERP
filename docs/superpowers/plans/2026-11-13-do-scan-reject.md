# DO scan: reject at site, with a reason

Status: plan, not built. Part of renovation feedback 2 (owner, 13 Nov 2026).

## Problem

The driver scans the QR on a delivery order and gets one button at a time:
Confirm loading, Confirm Loaded, Confirm Departure, Confirm Delivered
(`engine/backend/src/scm/shared/do-scan-ladder.ts`). When the customer or site
refuses the goods there is no button for it and nowhere to say why. The driver
either presses Delivered (wrong) or walks away (the office never hears).

Constraints found in the code:

- The ladder is forward only by owner ruling (25 to 26 Aug): one button, the
  next step, never a way back. A reject must not become a backwards step.
- `scm.do_status` has eight labels and no Rejected. Adding one touches every
  reader of the status (bug 0530 took the DO page down over one bad label).
- The scan page is public, no login. The paper is the credential. Anything the
  page can write, a stranger holding the paper can write.
- Every scan write goes through the office's own handler via a synthetic
  context (`advanceThroughOfficeWriter` in `routes/publicDoScan.ts`). No second
  write path.
- Delivery Return already does stock back, reason, and SO line reopen
  (`scm/routes/delivery-returns.ts`, `POST /from-do`). It only accepts DOs that
  count as delivered: goods on the lorry never left (`doReturnableRemaining`,
  basis `'delivered'`).
- A DO already has a hold marker beside its status: `on_hold`, `hold_reason`,
  `held_at`, `held_by` (engine migration 0324, `scm/lib/document-hold.ts`).
  The office writer is `makeHoldHandler` behind `PATCH .../:id/hold`. A held DO
  gets no scan button and the office status change is refused until released.

## Usage (what people see)

Driver at the site, DO is In transit, scans the paper:

```
DO-2611-014 · Tan Wei Ming · Kuala Lumpur
In transit

[ Confirm Delivered ]                 primary, full width
  This records that the driver reported...

[ Customer won't accept ]             secondary, full width
```

Tap Customer won't accept:

```
Why won't they accept it?
( ) Damaged
( ) Wrong item or size
( ) Nobody at site
( ) Site not ready
( ) Customer cancelled
( ) Other
Note (optional, required for Other)  [_______________]

[ Record rejection ]    [ Back ]
```

After: "Recorded. This delivery order is on hold and the office has been told
why. Bring the goods back to the warehouse." Scanning it again shows the
existing on-hold sentence.

Office, Delivery Orders list and detail: the DO shows the On hold pill with
"Rejected at site: Damaged. Corner of cabinet cracked." From there:

- Redeliver: Take off hold, the driver scans again later. Nothing else changes.
- Goods come back: Take off hold, set Delivered, then Delivery Returns > From DO
  with the reason. All three already exist (phase 2 folds them into one button).

## Shape

Phase 1, the scan (no migration):

1. `do-scan-ladder.ts` owns the one reason list:
   `DO_SCAN_REJECT_REASONS` (code, label) and `doScanRejectAllowed(status,
   onHold)`: true only at `in_transit` and not held. The ladder itself is
   untouched; reject is a second action beside step 3, not a rung.
2. `GET /api/public/do-scan/:token` adds `reject: { reasons } | null` to the
   summary, so the page never holds its own copy of the list (same pattern as
   the Delivered note travelling with the rung).
3. `POST /api/public/do-scan/:token/reject` `{ reasonCode, note }`:
   resolve token (company from the row, never the request), rate limit as
   advance does, check `doScanRejectAllowed`, validate the code against the
   list, note trimmed to 300, required when code is `other`. Then write the
   hold through `makeHoldHandler`'s DO config via the synthetic-context bridge,
   with `reason = "Rejected at site: <label>. <note>"`. Idempotent: already
   held answers the on-hold sentence, not an error.
4. The bridge: `advanceThroughOfficeWriter` becomes
   `callOfficeWriter(handler, resolved, body)`; advance and reject both use it.
   One identity block (`SCM_SYSTEM_STAFF_ID`, no `houzsUser`), one place.
5. `PublicDoScan.tsx`: secondary button under Confirm Delivered when
   `reject` is present; tapping swaps the card for the reason form (radio list,
   note, Record rejection / Back). Packing-list and basket pages get nothing:
   a whole lorry run is never rejected at one door.

Phase 2, the office (separate PR, after the owner sees phase 1):

6. On a DO held with a site rejection, the detail page offers "Goods came back".
   One server action: release hold, DELIVERED through
   `patchDeliveryOrderStatusHandler`, then `convertDoLinesToReturn` for every
   line with the rejection as the return's reason. Stock comes back and the SO
   line reopens (`reopenSoFromReturn`). Returned qty is already taken off what
   can be invoiced (remaining = delivered − invoiced − returned).

Interface depth: the public page learns two things (a reason list, one POST).
Stock, SO, invoicing and the status enum stay behind the office writers it
already calls.

## Synthesis decision

Base: candidate A (reject is a hold with a reason). Adapted from B: the office
side ends in a real Delivery Return, so stock and SO follow the existing
ledger. Rejected C.

- A, hold marker. Public page can only pause a DO and say why. No stock, no
  enum, no migration. Office decides what happens next.
- B, scan does Delivered plus Delivery Return in one go. Moves stock and
  reopens the SO from a no-login page; two writes with no transaction between
  them; a leaked paper can book stock back. Lost on the public-page rule.
- C, new `REJECTED` status. Enum migration, every status reader, scan ladder
  gains a branch the owner ruled out. Lost on blast radius.

## Tradeoffs accepted

- We accept that "rejected" is text inside `hold_reason`, not its own column, in
  exchange for no migration in phase 1. Phase 2 needs to recognise it; if that
  turns into string matching, add `site_rejected_at` + `site_reject_code`
  columns then.
- We accept that a returned DO reads Delivered with a linked return, in
  exchange for no new status. The return carries the why.
- We accept a reject on the whole DO only. Partial ("one cabinet damaged") goes
  in the note; the office picks lines on the return.
- We accept no photo on the scan page. It is public; uploads from a no-login
  page are a bigger door. Revisit when renovators scan signed in.

## Alternatives considered

B and C above. Also: a free-text box with no list. Lost because the office
cannot count or filter rejections by cause, and a driver on a phone types less
with a list.

## Files

| | File | Change |
|---|---|---|
| ✏️ | `engine/backend/src/scm/shared/do-scan-ladder.ts` | reason list, `doScanRejectAllowed` |
| ✏️ | `engine/backend/src/routes/publicDoScan.ts` | `reject` on GET, `POST /:token/reject`, shared office-writer bridge |
| ✏️ | `engine/frontend/src/pages/PublicDoScan.tsx` | secondary button, reason sheet |
| 🆕 | `engine/backend/tests/publicDoScanReject.test.ts` | allowed only in transit, held is idempotent, bad code refused, company scope per statement |
| ✏️ | `engine/backend/tests/doScanLadder.test.ts` | reason list and gate |
| ✏️ | `engine/frontend/src/pages/PublicDoScan.test.tsx` | button shows only with `reject`; reason form; Other needs a note |

Phase 2 files are listed in its own plan.

## Phone layout

The scan page is phone only (max-w-md). Content order: DO number and customer,
status, primary action, its note, then Customer won't accept as an outline
button below the note so a thumb does not hit it by accident. Reason form
replaces the card in place (no modal): radio rows 48px tall, note is a
`textarea` at 16px, Record rejection is full width and stays above the keyboard.
Test at 360px and 390px on staging.

## Rollback

Phase 1 has no migration. Revert the PR. DOs already held by a rejection stay
held with their reason; the office takes them off hold as usual.

## Open questions and risks

1. Owner: is a site reject "delivered then returned" (this plan) or does he
   want the DO itself to read Rejected?
2. Owner: are the six reasons right? Renovation sites may need "Wrong unit" or
   "No lift access".
3. Owner: should anyone with the paper be able to reject, or only a signed-in
   renovator once feedback 2's renovator screens exist?
4. Who in the office is told? Phase 1 shows it on the DO list. A notification
   to the SO's salesperson or the project PIC is extra; say if wanted.
5. Risk: a stranger with the paper can put a DO on hold. Same exposure as
   pressing Delivered today, smaller effect (nothing moves). Revoke the QR
   (`qr_revoked_at`) covers a leaked paper.
6. Not checked: whether the office DO list shows `hold_reason` today or only
   the pill.

## Next implementation step

Add `DO_SCAN_REJECT_REASONS` and `doScanRejectAllowed` to
`do-scan-ladder.ts` with their tests, then the POST route through the shared
office-writer bridge.
