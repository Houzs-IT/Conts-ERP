/* The warehouse a document prints (owner, 5 Nov 2026): where the goods left from or arrived, with the people to call,
   who are written into the warehouse's address. */
import { authedFetch } from './authed-fetch';
import type { RenoDocInfo } from './renovation-doc-print';

type Warehouse = { id: string; code?: string | null; name?: string | null; location?: string | null };

/** "BLK Belakang Warehouse, 1831-B, Jalan KPB 1 ...", or null when the document names no warehouse. A failed read
    prints the sheet without the line: a delivery must not wait on it. */
export async function warehouseLine(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const res = await authedFetch<{ warehouses?: Warehouse[] }>('/inventory/warehouses?includeInactive=true');
    const wh = (res.warehouses ?? []).find((w) => w.id === id);
    if (!wh) return null;
    return [[wh.code, wh.name].filter(Boolean).join(' '), wh.location].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

/** A delivery to the On-site warehouse goes to the project, so the supplier reads the project's unit. */
export function deliverToAddress(code: string, address: string, reno?: RenoDocInfo | null): string {
  if (code !== 'ONSITE') return address;
  const site = [reno?.info?.building, reno?.info?.unitNo].filter(Boolean).join(' ') || reno?.info?.projectName || '';
  return site ? `${address}: ${site}` : address;
}
