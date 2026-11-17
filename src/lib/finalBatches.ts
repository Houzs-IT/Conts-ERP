/** The finalise route takes at most this many statements a request (functions/api/statements/finalise.ts). */
export const FINALISE_LIMIT = 200;

/** How many owners the Unit report's Final "Lock all" generates and makes final per request: one statement each, so well
 *  under FINALISE_LIMIT, and a generate of that many owners stays quick. */
export const FINAL_BATCH = 100;

/** The owners in batches of at most `size`, in order (chew, 13 Nov 2026: a month may one day have more than 200 ready owners). */
export function finalBatches<T>(ownerIds: T[], size = FINAL_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ownerIds.length; i += size) out.push(ownerIds.slice(i, i + size));
  return out;
}
