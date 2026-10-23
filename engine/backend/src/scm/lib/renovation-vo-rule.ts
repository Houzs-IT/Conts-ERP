// renovation-vo-rule — Conts: every change to a confirmed sales order is a VO.
//
// Owner, 24 Oct 2026 (docs: Conts-ERP-worktrees/BRIEF-beta-oct24.md section 1): a sales
// order amendment is called a VO, and once a sales order is confirmed EVERY line, price
// or quantity change must be recorded as one (VO-01, VO-02, ...), with no approval step.
//
// Houzs's rule is narrower: a line edit only has to become an amendment once the order's
// processing date has passed (soProcessingLocked) or, for 2990 orders, once a PO exists
// (so-po-lock.ts). Conts's sales orders have no processing date on the form and are not
// 2990's, so neither lock ever fired and a confirmed order was edited in place with no
// record. This file is the Conts switch; turning CONFIRMED_SO_CHANGES_BY_VO off gives back
// Houzs's behaviour unchanged.
//
// What it changes, and only this:
//   - the line write routes (add / edit / delete / price override / TBC fill-in and swap)
//     refuse a confirmed order with a message pointing at "New VO";
//   - the amendment door (POST /mfg-sales-orders/:docNo/amendments) opens for it;
//   - the SO detail payload says so (vo_locked), so the edit screen records a VO;
//   - a VO applies the moment it is raised (no approver), as ONE document even when it
//     mixes product lines and delivery changes (Houzs splits those per approving desk).
// Header fields that the engine lets an operator change directly stay direct.

import type { AmendmentLane, LaneSplit } from '../shared/amendment-lane';

/** Conts runs this copy of the engine; Houzs's rule is the `false` side. */
export const CONFIRMED_SO_CHANGES_BY_VO = true;

/** True when a confirmed (not Draft, not Cancelled) sales order may only change through a VO. */
export function soVoLocked(header: { status?: string | null } | null | undefined): boolean {
  if (!CONFIRMED_SO_CHANGES_BY_VO || !header) return false;
  const status = String(header.status ?? '').toUpperCase();
  if (!status) return false;
  return status !== 'DRAFT' && status !== 'CANCELLED';
}

export const SO_VO_LOCKED_RESPONSE = {
  error: 'so_locked_vo',
  reason: 'This sales order is confirmed, so its lines can only change through a VO. Press "New VO" (or Edit on the order) to record the change.',
  message: 'This sales order is confirmed, so its lines can only change through a VO. Press "New VO" to record the change.',
} as const;

/** Under the rule a VO needs no second person: each half applies as soon as it is raised. */
export function voAppliesOnRaise(): boolean {
  return CONFIRMED_SO_CHANGES_BY_VO;
}

const LANE_ORDER: AmendmentLane[] = ['LINES', 'PRICE', 'DELIVERY'];

/**
 * One VO per submission. Houzs splits a request per approving desk (product lines to
 * Purchasing, delivery to Logistics); with no approver there is nothing to split for, and
 * a split would show the client one change as two VOs. Everything moves into the first lane
 * present (LINES before PRICE before DELIVERY), so a product change keeps the PO follow-up
 * that the LINES lane carries.
 */
export function mergeLanesForVo<L>(split: LaneSplit<L>): LaneSplit<L> {
  if (!CONFIRMED_SO_CHANGES_BY_VO || split.lanes.length <= 1) return split;
  const target = LANE_ORDER.find((l) => split.lanes.includes(l)) ?? split.lanes[0];
  const merged = { headerChanges: {} as Record<string, string | null>, headerKeys: [] as string[], lines: [] as L[] };
  for (const lane of LANE_ORDER) {
    if (!split.lanes.includes(lane)) continue;
    const half = split.perLane[lane];
    Object.assign(merged.headerChanges, half.headerChanges);
    merged.headerKeys.push(...half.headerKeys);
    merged.lines.push(...half.lines);
  }
  const empty = () => ({ headerChanges: {} as Record<string, string | null>, headerKeys: [] as string[], lines: [] as L[] });
  const perLane: LaneSplit<L>['perLane'] = { LINES: empty(), PRICE: empty(), DELIVERY: empty() };
  perLane[target] = merged;
  return { lanes: [target], perLane };
}
