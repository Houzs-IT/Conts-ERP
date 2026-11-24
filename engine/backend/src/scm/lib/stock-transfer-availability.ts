// ----------------------------------------------------------------------------
// Stock-transfer availability: a transfer may only move what the SOURCE
// warehouse itself holds in that (item, variant) bucket.
//
// Stock is pooled across warehouses when a sales order asks "is it in stock?",
// but a transfer physically takes units out of one warehouse, so the pool does
// not apply here. Until 20 Nov 2026 the create path did not check at all: a
// transfer of 99 out of a bucket holding 5 posted, and the FIFO consumer just
// recorded the 94 it could not find as an uncosted shortfall.
//
// Two layers, same rule:
//   - this module, read before anything is written, so a refused transfer
//     leaves no header, no doc number and no movement behind;
//   - scm.fn_stock_transfer_apply (migration 0353), which re-checks under the
//     source lots' row locks inside the transfer's own transaction, so two
//     transfers draining one bucket at the same moment cannot both pass.
// ----------------------------------------------------------------------------

export type TransferShortage = {
  itemCode: string;
  productName: string | null;
  variantKey: string;
  requested: number;
  available: number;
};

export type TransferLineLike = {
  item_code: string;
  product_name?: string | null;
  variant_key?: string | null;
  qty: number;
};

const bucketKey = (itemCode: string, variantKey: string | null | undefined) => `${itemCode}::${variantKey ?? ''}`;

/** Total qty per (item, variant) bucket; repeated lines of one bucket add up. */
export function requestedByBucket(lines: TransferLineLike[]): Map<string, { itemCode: string; productName: string | null; variantKey: string; qty: number }> {
  const out = new Map<string, { itemCode: string; productName: string | null; variantKey: string; qty: number }>();
  for (const l of lines) {
    const k = bucketKey(l.item_code, l.variant_key);
    const cur = out.get(k);
    if (cur) cur.qty += Number(l.qty);
    else out.set(k, { itemCode: l.item_code, productName: l.product_name ?? null, variantKey: l.variant_key ?? '', qty: Number(l.qty) });
  }
  return out;
}

/**
 * Buckets that ask for more than the source holds. `openByBucket` is today's
 * open qty at the source; `creditByBucket` is what an edit's reversal will put
 * back first (the old lines of the same transfer), empty for a new transfer.
 */
export function findTransferShortages(
  lines: TransferLineLike[],
  openByBucket: Map<string, number>,
  creditByBucket: Map<string, number> = new Map(),
): TransferShortage[] {
  const shortages: TransferShortage[] = [];
  for (const [k, want] of requestedByBucket(lines)) {
    const available = (openByBucket.get(k) ?? 0) + (creditByBucket.get(k) ?? 0);
    if (want.qty > available) {
      shortages.push({ itemCode: want.itemCode, productName: want.productName, variantKey: want.variantKey, requested: want.qty, available });
    }
  }
  return shortages;
}

/** "Only 5 of SOFA-01 in WH-A; this transfer asks for 99." */
export function shortageSentence(s: TransferShortage, warehouseLabel: string): string {
  const what = s.variantKey ? `${s.itemCode} (${s.variantKey})` : s.itemCode;
  const have = s.available <= 0 ? `No ${what} is left` : `Only ${s.available} of ${what}`;
  return `${have} in ${warehouseLabel}; this transfer asks for ${s.requested}.`;
}

/**
 * The 409 body. Always `insufficient_stock`. One shortage: its sentence is the
 * `message` the browser shows. Several: a `problems[]` list as well, which the
 * browser renders one line each (authed-fetch.ts parseSaveProblems), so a long
 * list is never cut to the generic "clashes" line by its 200-character filter.
 */
export function insufficientStockBody(shortages: TransferShortage[], warehouseLabel: string) {
  const sentences = shortages.map((s) => shortageSentence(s, warehouseLabel));
  if (sentences.length === 1) {
    return { error: 'insufficient_stock', message: sentences[0]!, shortages };
  }
  return {
    error: 'insufficient_stock',
    message: `${shortages.length} lines ask for more than ${warehouseLabel} holds.`,
    problems: shortages.map((s, i) => ({ code: 'insufficient_stock', message: sentences[i]!, line: s.itemCode })),
    shortages,
  };
}

/**
 * The database's own refusal (migration 0353, SQLSTATE P0414), raised when a
 * second transfer emptied the bucket between the read above and the write.
 * Its DETAIL is JSON {item_code, variant_key, available, requested}.
 */
export function shortageFromPgError(err: { code?: unknown; details?: unknown } | null | undefined): TransferShortage | null {
  if (!err || String(err.code ?? '') !== 'P0414') return null;
  try {
    const d = JSON.parse(String(err.details ?? '')) as { item_code?: unknown; variant_key?: unknown; available?: unknown; requested?: unknown };
    return {
      itemCode: String(d.item_code ?? ''),
      productName: null,
      variantKey: String(d.variant_key ?? ''),
      requested: Number(d.requested ?? 0),
      available: Number(d.available ?? 0),
    };
  } catch {
    return null;
  }
}

export { bucketKey as transferBucketKey };
