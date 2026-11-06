// ----------------------------------------------------------------------------
// po-grouping.ts — how selected SO lines become POs, from the one global toggle
// on the MRP page and the From-SO picker.
//
// Owner, 4 Nov 2026: "上了 MRP 之后，by right 要支持 combine PO，或者按 per SO 来开".
//
//   COMBINED  one PO per supplier: lines of several SOs to one supplier merge.
//   PER-SO    one PO per SO for that supplier.
//
// This replaces Houzs's per-category rule (sofa, bedframe and mattress each
// answering the toggle differently): under it a Conts buyer pressing Combined
// got one PO per SO for every bedframe and one per delivery week for every
// mattress, and pressing Per SO split one SO into a PO per category.
//
// Every key starts (warehouse, supplier). The warehouse is load-bearing: it
// keeps each PO single-warehouse, which the GRN relies on to land stock where
// the SO line asked for it. The supplier is the physical "one PO = one supplier"
// constraint, so Per SO still gives an SO with two suppliers two POs.
// ----------------------------------------------------------------------------

/** The caller's global toggle. */
export type PoMode = 'combined' | 'per-so';

export interface GroupKeyInput {
  warehouseId: string | null;
  supplierId: string;
  soDocNo: string;
}

/** The bucket key for one line. Same key = same PO (within one convert batch). */
export function groupKeyFor(input: GroupKeyInput, toggle: PoMode): string {
  const base = `${input.warehouseId ?? 'null'}::${input.supplierId}`;
  return toggle === 'per-so' ? `${base}::so:${input.soDocNo}` : base;
}
