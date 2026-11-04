/* Proceed PO, split into requests the free Workers plan can answer: a request may make 50 outside calls, the shared
   reads of a convert cost about 20 and each PO about 8, so three POs is what one request safely carries. A large Per SO
   run would otherwise stop half way through, leaving some POs created and the rest not.

   Picks that land on one PO stay in one request, so splitting never splits a PO. The key mirrors the server's
   (lib/po-grouping.ts) less the warehouse, which at worst keeps one request a little fuller. */
export const MAX_POS_PER_REQUEST = 3;

export type PoPick = { soItemId: string; qty: number; supplierId: string | null };

export function poRequestBatches<P extends PoPick>(
  picks: readonly P[],
  soDocOf: (soItemId: string) => string | undefined,
  mode: 'combined' | 'per-so',
  maxPos: number = MAX_POS_PER_REQUEST,
): P[][] {
  const byPo = new Map<string, P[]>();
  for (const p of picks) {
    const k = mode === 'per-so' ? `${p.supplierId ?? ''}|${soDocOf(p.soItemId) ?? ''}` : p.supplierId ?? '';
    const arr = byPo.get(k);
    if (arr) arr.push(p); else byPo.set(k, [p]);
  }
  const pos = [...byPo.values()];
  const batches: P[][] = [];
  for (let i = 0; i < pos.length; i += maxPos) batches.push(pos.slice(i, i + maxPos).flat());
  return batches;
}
