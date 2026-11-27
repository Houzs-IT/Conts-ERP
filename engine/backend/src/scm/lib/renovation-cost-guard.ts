/* What we pay for a renovation line (its unit cost and the supplier it is bought from) is not for everyone (owner,
   27 Nov 2026: sales never see costs). Two halves, so a salesperson can quote without ever holding the cost:
     - on the way out, every line's cost and supplier are blanked for someone who may not see product cost;
     - on the way in, a line that person saved takes its cost and supplier from the database: the stored line by its
       id, or for a new line the product's main supplier binding, the same pick the product lookup offers. */
import type { RenoDb } from './renovation-db';
import type { NormSection } from './renovation-validate';

const LINE_KINDS = new Set(['ITEM', 'CHILD', 'DETAIL', 'TEXT']);

function isLine(v: Record<string, unknown>): boolean {
  return typeof v.kind === 'string' && LINE_KINDS.has(v.kind) && 'unitCostSen' in v;
}

/** A copy with every document line's unitCostSen at 0 and supplierId at null, at any depth. */
export function stripLineCosts<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => stripLineCosts(v)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripLineCosts(v);
  if (isLine(out)) {
    out.unitCostSen = 0;
    out.supplierId = null;
  }
  return out as T;
}

interface Kept { unitCostSen: number; supplierId: string | null }

/** A line of the document as it stood before this save, for matching lines the editor sent under new ids. */
export interface PreviousLine { itemCode: string | null; unitCostSen: number; supplierId: string | null }

/** The previous document's lines, in order, from any answer that carries sections (a quotation, VO or template read). */
export function previousLines(doc: unknown): PreviousLine[] {
  const out: PreviousLine[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (isLine(o)) {
      out.push({ itemCode: typeof o.itemCode === 'string' ? o.itemCode : null, unitCostSen: Number(o.unitCostSen ?? 0), supplierId: typeof o.supplierId === 'string' ? o.supplierId : null });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(doc);
  return out;
}

/** The sections with each line's cost and supplier taken from the database instead of the caller: the stored line by
    id; else the previous document's next unused line with the same product (the editor may send new ids); else the
    product's main supplier binding. */
export async function keepLineCosts(db: RenoDb, sections: NormSection[], companyId: number, previous: PreviousLine[] = []): Promise<NormSection[]> {
  const lines = sections.flatMap((s) => s.lines);
  const ids = lines.map((l) => l.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const stored = new Map<string, Kept>();
  if (ids.length > 0) {
    const rows = await db.q<{ id: string; unit_cost_sen: number | string; supplier_id: string | null }>(
      `select id::text as id, unit_cost_sen, supplier_id::text as supplier_id from scm.reno_doc_lines
        where company_id = $1 and id::text = any(string_to_array($2, ','))`,
      [companyId, ids.join(',')],
    );
    for (const r of rows) stored.set(r.id, { unitCostSen: Number(r.unit_cost_sen), supplierId: r.supplier_id });
  }
  const codes = [...new Set(lines.filter((l) => !(l.id && stored.has(l.id)) && l.itemCode).map((l) => l.itemCode as string))];
  const bound = new Map<string, Kept>();
  if (codes.length > 0) {
    const rows = await db.q<{ code: string; supplier_id: string | null; cost_sen: number | string | null }>(
      `select p.code, b.supplier_id::text as supplier_id, coalesce(b.unit_price_sen, p.cost_price_sen, 0) as cost_sen
         from scm.mfg_products p
         left join lateral (select supplier_id, unit_price_sen from scm.supplier_material_bindings smb
                             where smb.item_code = p.code and smb.company_id = p.company_id
                             order by smb.is_main_supplier desc, smb.is_cost_anchor desc, smb.created_at limit 1) b on true
        where p.company_id = $1 and p.code = any(string_to_array($2, chr(31)))`,
      [companyId, codes.join(String.fromCharCode(31))],
    );
    for (const r of rows) if (!bound.has(r.code)) bound.set(r.code, { unitCostSen: Number(r.cost_sen ?? 0), supplierId: r.supplier_id });
  }
  const unused = previous.map((p) => ({ ...p, used: false }));
  const byProduct = (code: string | null): Kept | undefined => {
    if (!code) return undefined;
    const hit = unused.find((p) => !p.used && p.itemCode === code);
    if (!hit) return undefined;
    hit.used = true;
    return { unitCostSen: hit.unitCostSen, supplierId: hit.supplierId };
  };
  return sections.map((s) => ({
    ...s,
    lines: s.lines.map((l) => {
      const kept = (l.id ? stored.get(l.id) : undefined) ?? byProduct(l.itemCode) ?? (l.itemCode ? bound.get(l.itemCode) : undefined) ?? { unitCostSen: 0, supplierId: null };
      return { ...l, unitCostSen: kept.unitCostSen, supplierId: kept.supplierId };
    }),
  }));
}
