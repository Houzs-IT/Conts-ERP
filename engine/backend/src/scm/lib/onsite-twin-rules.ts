/* What an on-site twin still has to do, worked out from what it has already done, so a repeat finds nothing: a delivery
   is confirmed, then marked Delivered, and the twin is asked both times; a press can also be retried. */

type Qtys = ReadonlyMap<string, number>;

export function addUp<T>(rows: readonly T[], key: (r: T) => string | null | undefined, qty: (r: T) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) out.set(k, (out.get(k) ?? 0) + qty(r));
  }
  return out;
}

/** A site receipt's proof of delivery: the photos of the goods, not the supplier's delivery order. */
export const podKeysOfSitePhotos = (photos: ReadonlyArray<{ r2_key: string; kind: string }>): string[] =>
  photos.filter((p) => p.kind !== 'supplier_do').map((p) => p.r2_key);

/** Receive a delivery's lines from their POs, less what receipts tied to this delivery already took. */
export function receiptPicks(
  lines: ReadonlyArray<{ so_item_id: string; qty: number }>,
  poLines: ReadonlyArray<{ id: string; so_item_id: string; qty: number; received_qty: number | null }>,
  alreadyReceived: Qtys,
): Array<{ poItemId: string; qty: number }> {
  const covered = new Map(alreadyReceived);
  const picks: Array<{ poItemId: string; qty: number }> = [];
  for (const l of lines) {
    const had = covered.get(l.so_item_id) ?? 0;
    const taken = Math.min(had, Number(l.qty));
    covered.set(l.so_item_id, had - taken);
    let need = Number(l.qty) - taken;
    for (const p of poLines.filter((x) => x.so_item_id === l.so_item_id)) {
      const open = Number(p.qty) - Number(p.received_qty ?? 0) - picks.filter((x) => x.poItemId === p.id).reduce((t, x) => t + x.qty, 0);
      const qty = Math.min(need, open);
      if (qty > 0) { picks.push({ poItemId: p.id, qty }); need -= qty; }
    }
  }
  return picks;
}

/** What a posted receipt must still deliver. A draft delivery order is the plan for these goods: it is tied to the
    receipt and left for staff to confirm with their photos, and only what no draft covers is raised. */
export function deliveriesToRaise(
  received: Qtys,
  alreadyDelivered: Qtys,
  drafts: ReadonlyArray<{ doId: string; soItemId: string; qty: number }>,
  remaining: (soItemId: string) => number,
): { raise: Array<{ soItemId: string; qty: number }>; planned: string[] } {
  const raise: Array<{ soItemId: string; qty: number }> = [];
  const planned = new Set<string>();
  const leftOf = new Map<string, number>();
  for (const [soItemId, got] of received) {
    let left = got - (alreadyDelivered.get(soItemId) ?? 0);
    for (const d of drafts.filter((x) => x.soItemId === soItemId)) {
      if (left <= 0) break;
      left -= d.qty;
      planned.add(d.doId);
    }
    leftOf.set(soItemId, left);
  }
  /* The planned drafts will deliver too, so what is left on the SO line is less them (a draft is not counted in
     `remaining`): without this, a receipt bigger than the line raised a DO the database cap (0270) refuses. */
  for (const [soItemId, left] of leftOf) {
    const draftQty = drafts.filter((d) => d.soItemId === soItemId && planned.has(d.doId)).reduce((t, d) => t + d.qty, 0);
    const qty = Math.min(left, remaining(soItemId) - draftQty);
    if (qty > 0) raise.push({ soItemId, qty });
  }
  return { raise, planned: [...planned] };
}

type HandlerAnswer = { status: number; json?: Record<string, unknown> };

/** Marks a DO the twin just raised as Delivered. A site receipt's DO was raised as a draft for this receipt only, so one
    that cannot be delivered (the database cap, migration 0270, refused it) is withdrawn rather than left behind as a
    stray draft: cancelled, not deleted, so its AutoCount entry and audit trail close the usual way, and untied from the
    receipt. The problem is reported either way. */
export async function deliverOrWithdraw(
  io: { deliver: () => Promise<HandlerAnswer>; withdraw: () => Promise<HandlerAnswer>; untie: () => PromiseLike<unknown> },
  siteReceipt: boolean,
): Promise<{ problem: string | null; withdrawn: boolean }> {
  const done = await io.deliver();
  if (done.status < 300) return { problem: null, withdrawn: false };
  const j = done.json ?? {};
  const problem = String(j.message ?? j.reason ?? j.error ?? 'The delivery order was raised but not marked delivered.');
  if (!siteReceipt) return { problem, withdrawn: false };
  const off = await io.withdraw();
  if (off.status >= 300) return { problem: `${problem} The draft delivery order could not be cancelled; cancel it by hand.`, withdrawn: false };
  await io.untie();
  return { problem: `${problem} The draft delivery order raised for it was cancelled.`, withdrawn: true };
}
