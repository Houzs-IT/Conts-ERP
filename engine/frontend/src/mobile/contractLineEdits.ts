/* A renovation contract refuses the SO amendment route: its lines change by POST /renovation/sales-orders/:docNo/line-edits,
   which raises and applies one VO. This turns the phone's line changes into that request, as the desktop's saveContractEdit
   does. Options alone are not a VO: the caller saves those on the line (saveOnly). */
export type PhoneLineChange = {
  salesOrderItemId?: string | null;
  changeType: string;
  newItemCode?: string | null;
  newQty?: number | null;
  newUnitPriceSen?: number | null;
  newVariants?: unknown;
  newRemark?: string;
};
type Snap = { id: string; item_code: string | null; qty: number | null; unit_price_sen: number | null };
export type ContractEdit = { soItemId: string; qty?: number; itemCode?: string; unitPriceSen?: number; remove?: boolean; variants?: Record<string, unknown>; remark?: string };
export type ContractAdd = { room: string; itemCode: string; qty: number; unitPriceSen: number; variants?: Record<string, unknown>; remark?: string };

export function contractLineEdits(lines: readonly PhoneLineChange[], items: readonly Snap[]): { edits: ContractEdit[]; adds: ContractAdd[] } {
  const byId = new Map(items.map((it) => [it.id, it]));
  const edits: ContractEdit[] = [];
  const adds: ContractAdd[] = [];
  for (const l of lines) {
    const variants = (l.newVariants ?? undefined) as Record<string, unknown> | undefined;
    if (l.changeType === 'ADD') {
      /* The phone has no room picker: the server files a line with no room under Additional works. */
      adds.push({ room: '', itemCode: l.newItemCode ?? '', qty: l.newQty ?? 1, unitPriceSen: Math.max(0, Math.round(l.newUnitPriceSen ?? 0)), variants, remark: l.newRemark });
      continue;
    }
    const it = l.salesOrderItemId ? byId.get(l.salesOrderItemId) : undefined;
    if (!it) continue;
    if (l.changeType === 'REMOVE') { edits.push({ soItemId: it.id, remove: true }); continue; }
    const e: ContractEdit = { soItemId: it.id };
    const code = l.newItemCode ?? it.item_code;
    if (code !== it.item_code) Object.assign(e, { itemCode: code, variants, remark: l.newRemark });
    if (l.newQty != null && l.newQty !== it.qty) e.qty = l.newQty;
    if (l.newUnitPriceSen != null && l.newUnitPriceSen !== it.unit_price_sen) e.unitPriceSen = Math.max(0, Math.round(l.newUnitPriceSen));
    if (e.itemCode !== undefined || e.qty !== undefined || e.unitPriceSen !== undefined) edits.push(e);
  }
  return { edits, adds };
}
