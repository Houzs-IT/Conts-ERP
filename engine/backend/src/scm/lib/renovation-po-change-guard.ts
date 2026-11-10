/* A VO's change to an issued PO waits for approval (owner, 24 Oct 2026). Until then the PO still reads the old quantity, so a
   receipt or Complete would take in what the customer no longer ordered. Only a VO's amendment stops them: an ordinary SO
   amendment's follow-up keeps its own flow. A failed read refuses: a receipt can wait, stock taken in wrongly cannot. */

export const VO_CHANGE_WAITING = 'po_change_waiting';

const refusal = (message: string) => ({ error: VO_CHANGE_WAITING, message });

/** The refusal when a VO's PO change is still waiting on any of these PO lines, else null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- called from routes with differently typed clients
export async function voChangeWaiting(sb: any, poItemIds: ReadonlyArray<string | null | undefined>): Promise<{ error: string; message: string } | null> {
  const ids = [...new Set(poItemIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return null;
  const unread = refusal('The PO could not be checked for a waiting change. Try again.');
  const { data: lines, error: lineErr } = await sb.from('po_amendment_lines').select('amendment_id').in('purchase_order_item_id', ids);
  if (lineErr) return unread;
  const amendmentIds = [...new Set(((lines ?? []) as Array<{ amendment_id: string }>).map((l) => l.amendment_id))];
  if (amendmentIds.length === 0) return null;
  const { data: open, error: openErr } = await sb.from('po_amendments').select('po_number, source_so_amendment_id')
    .in('id', amendmentIds).eq('status', 'REQUESTED').not('source_so_amendment_id', 'is', null);
  if (openErr) return unread;
  const waiting = (open ?? []) as Array<{ po_number: string; source_so_amendment_id: string }>;
  if (waiting.length === 0) return null;
  const { data: vos, error: voErr } = await sb.from('so_amendments').select('id')
    .in('id', waiting.map((a) => a.source_so_amendment_id)).eq('resolution', 'RENOVATION_VO');
  if (voErr) return unread;
  const fromVo = new Set(((vos ?? []) as Array<{ id: string }>).map((v) => v.id));
  const held = waiting.find((a) => fromVo.has(a.source_so_amendment_id));
  return held ? refusal(`Approve the PO change first: a VO changed ${held.po_number} and its amendment is still waiting.`) : null;
}
