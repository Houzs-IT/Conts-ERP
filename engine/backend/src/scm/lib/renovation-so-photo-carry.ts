/* A sales order line's photo follows to the PO lines already raised from it (owner, 7 Nov 2026): raising a PO copies the
   line's photos once, so a Built-in line's photo added afterwards never reached the carpenter's PO. Photos only, so no
   amendment: a photo changes no amount and no line. The same key is listed, nothing is copied, and a CANCELLED PO is left
   alone. Never fails the save on the sales order: a miss is logged and the Beta line still shows the photo.

   The PO line's own trigger (migration 0211) rewrites its production line's photos from the PO line, which would drop what
   was added on the production order (pro-items/), so those are put back. */

export const addedKeys = (have: readonly string[] | null | undefined, key: string): string[] =>
  (have ?? []).includes(key) ? [...(have ?? [])] : [...(have ?? []), key];

export const withoutKey = (have: readonly string[] | null | undefined, key: string): string[] => (have ?? []).filter((k) => k !== key);

const ownKeys = (have: readonly string[] | null | undefined): string[] => (have ?? []).filter((k) => k.startsWith("pro-items/"));

type PoLine = { id: string; photo_urls: string[] | null; purchase_orders: { status: string } | null };
type OrderLine = { id: string; source_po_item_id: string; photo_urls: string[] | null };

export async function carrySoPhoto(sb: any, soItemId: string, change: { add: string } | { remove: string }): Promise<void> {
  try {
    const { data, error } = await sb.from('purchase_order_items').select('id, photo_urls, purchase_orders!inner (status)').eq('so_item_id', soItemId);
    if (error) throw new Error(error.message);
    const next = (l: PoLine) => ('add' in change ? addedKeys(l.photo_urls, change.add) : withoutKey(l.photo_urls, change.remove));
    const lines = ((data ?? []) as PoLine[]).filter((l) => l.purchase_orders?.status !== 'CANCELLED' && next(l).length !== (l.photo_urls ?? []).length);
    if (lines.length === 0) return;
    const { data: orderRows } = await sb.from('production_order_items').select('id, source_po_item_id, photo_urls').in('source_po_item_id', lines.map((l) => l.id));
    for (const l of lines) {
      const photos = next(l);
      const { error: upErr } = await sb.from('purchase_order_items').update({ photo_urls: photos }).eq('id', l.id);
      if (upErr) throw new Error(upErr.message);
      for (const o of ((orderRows ?? []) as OrderLine[]).filter((x) => x.source_po_item_id === l.id && ownKeys(x.photo_urls).length > 0)) {
        await sb.from('production_order_items').update({ photo_urls: [...photos, ...ownKeys(o.photo_urls)] }).eq('id', o.id);
      }
    }
  } catch (e) {
    console.error('[so-photo-carry] the photo did not reach the PO line', soItemId, e);
  }
}
