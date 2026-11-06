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
  for (const [soItemId, got] of received) {
    let left = got - (alreadyDelivered.get(soItemId) ?? 0);
    for (const d of drafts.filter((x) => x.soItemId === soItemId)) {
      if (left <= 0) break;
      left -= d.qty;
      planned.add(d.doId);
    }
    const qty = Math.min(left, remaining(soItemId));
    if (qty > 0) raise.push({ soItemId, qty });
  }
  return { raise, planned: [...planned] };
}
