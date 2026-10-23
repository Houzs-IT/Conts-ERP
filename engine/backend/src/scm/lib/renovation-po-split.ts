/* SO -> PO for a renovation contract: one click, lines grouped by their bound supplier and category group (one PO
   never mixes categories; owner, 14 Oct 2026, mig 0116 enforces it), every PO line keeps so_item_id.

   Written directly rather than through convertSosToPosCore: that path prices
   from supplier-material bindings, folds sofa / mattress buckets and requires
   a warehouse, none of which a renovation line has. A renovation line already
   carries its supplier and cost (pre-filled from the SKU binding, overridable).

   Which lines need a PO:
   - priced contract lines (ITEM / CHILD) still live (not cancelled, not omitted);
   - not the system rows (RENO-*);
   - supply-by-owner: the goods are the owner's, so no goods PO; a WORKS line
     (install labour, or a site-trade service such as aircon install) still gets
     its PO (owner default 7);
   - a line with no supplier and no cost is internal work and needs none;
   - a line with a cost but no supplier BLOCKS the raise until one is picked;
   - quantity already on a live PO line is not ordered twice. */

import { mintDocNo, refuse, todayKl, yymmOf, type RenoDb } from './renovation-db';
import { readContractHead, RENO_LIVE_STATUSES } from './renovation-so';
import type { RenoActor } from './renovation-quotation';
import { categoryGroupOf, siteGroupOf } from '../shared/renovation-catalog';
import { lineCostSen, poInstalmentAmounts, parseMeasureMilli } from '../shared/renovation-money';

export interface SplitLine {
  lineId: string;
  soItemId: string;
  itemCode: string;
  description: string;
  description2: string | null;
  uom: string;
  qty: number;
  unitCostSen: number;
  amountSen: number;
  supplierId: string | null;
  reason?: string;
}

export interface SplitGroup {
  /* One PO per supplier AND category group (owner, 14 Oct 2026: a renovation PO never mixes categories). */
  categoryGroup: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  lines: SplitLine[];
  totalSen: number;
}

export interface SplitPreview {
  groups: SplitGroup[];
  blocked: SplitLine[];
  skipped: SplitLine[];
  alreadyOrdered: SplitLine[];
}

interface CandidateRow {
  line_id: string; so_item_id: string; kind: 'ITEM' | 'CHILD'; item_code: string; description: string; qty: number; measure: string | null;
  measure_uom: string | null; uom: string | null; unit_cost_sen: number; supply_by_owner: boolean; supplier_id: string | null;
  supplier_code: string | null; supplier_name: string | null; category: string | null; sub_category?: string | null; item_description2: string | null; item_uom: string;
  ordered_qty: number;
}

/** Whether a contract line is meant to get a PO at all (the same rules groupForPo applies, before quantity).
    A line with a cost but no supplier still needs one: the split blocks until a supplier is picked. Lines that
    never get one (system rows, owner-supplied goods, in-house work) also never get a proof of delivery. */
/** Customer-supplied items (owner, 22 Oct 2026): the CUS-* placeholder SKUs, linked to supplier CUSTOMER at cost 0.
    The customer buys the item and The Conts only manages it, so nothing is ordered from anyone: no PO, not even a
    zero one. A CUS-* line someone re-priced and pointed at a real supplier is ordered as usual. */
export function isCustomerSupplied(l: { itemCode: string | null; supplierCode?: string | null; unitCostSen: number }): boolean {
  if (l.supplierCode != null) return l.supplierCode === 'CUSTOMER';
  return String(l.itemCode ?? '').startsWith('CUS-') && Number(l.unitCostSen) === 0;
}

/** May the PO "Transfer from Sales Order" picker offer this SO line? (owner, 24 Oct 2026) Not a line whose SKU the
    customer supplies (main supplier CUSTOMER, or a CUS-* placeholder with no supplier), and not a service or site
    works line with no supplier to buy it from. A line with a real supplier is offered as before. */
export function poPickerOffers(l: { itemCode: string | null; itemGroup: string | null; mainSupplierCode: string | null }): boolean {
  const code = String(l.itemCode ?? '').toUpperCase();
  if (l.mainSupplierCode === 'CUSTOMER') return false;
  if (l.mainSupplierCode) return true;
  if (code.startsWith('CUS-') || code.startsWith('RENO-') || code.startsWith('SVC-')) return false;
  const group = categoryGroupOf(l.itemGroup);
  if (group === 'WORKS' || group === 'SERVICE') return false;
  return !String(l.itemGroup ?? '').toUpperCase().includes('SERVICE');
}

/** Where a VO line goes (owner, 24 Oct 2026): the client buys it (Client PO), we buy it (PO), or it is our own works /
    service with no supplier to buy it from. Same rule as poPickerOffers. */
export function voGoesTo(l: { itemCode: string | null; itemGroup: string | null; mainSupplierCode: string | null }): 'po' | 'client' | 'works' {
  if (l.mainSupplierCode === 'CUSTOMER' || (!l.mainSupplierCode && String(l.itemCode ?? '').toUpperCase().startsWith('CUS-'))) return 'client';
  return poPickerOffers(l) ? 'po' : 'works';
}

export function needsPurchaseOrder(l: { itemCode: string | null; supplyByOwner: boolean; category: string | null; subCategory?: string | null; supplierId: string | null; unitCostSen: number; supplierCode?: string | null }): boolean {
  if (String(l.itemCode ?? '').startsWith('RENO-')) return false;
  if (isCustomerSupplied(l)) return false;
  if (l.supplyByOwner && siteGroupOf(categoryGroupOf(l.category), l.subCategory) !== 'WORKS') return false;
  if (!l.supplierId && Number(l.unitCostSen) === 0) return false;
  return true;
}

/** Pure grouping, exported for tests. */
export function groupForPo(rows: CandidateRow[]): SplitPreview {
  const out: SplitPreview = { groups: [], blocked: [], skipped: [], alreadyOrdered: [] };
  const groups = new Map<string, SplitGroup>();
  for (const r of rows) {
    const measureMilli = r.measure === null ? null : parseMeasureMilli(String(Number(r.measure)));
    const measured = measureMilli !== null;
    const orderQty = measured ? 1 : Number(r.qty);
    const amountSen = lineCostSen({ kind: r.kind, qty: orderQty, measureMilli, unitCostSen: Number(r.unit_cost_sen) });
    const line: SplitLine = {
      lineId: r.line_id, soItemId: r.so_item_id, itemCode: r.item_code, description: r.description, description2: r.item_description2,
      uom: r.item_uom, qty: orderQty, unitCostSen: measured ? amountSen : Number(r.unit_cost_sen), amountSen, supplierId: r.supplier_id,
    };
    if (r.item_code.startsWith('RENO-')) continue;
    if (Number(r.ordered_qty) >= orderQty && orderQty > 0) { out.alreadyOrdered.push(line); continue; }
    if (Number(r.ordered_qty) > 0) {
      line.qty = orderQty - Number(r.ordered_qty);
      line.amountSen = line.qty * line.unitCostSen;
    }
    const group = categoryGroupOf(r.category);
    if (r.supply_by_owner && siteGroupOf(group, r.sub_category) !== 'WORKS') { out.skipped.push({ ...line, reason: 'Supplied by the owner' }); continue; }
    if (isCustomerSupplied({ itemCode: r.item_code, supplierCode: r.supplier_id ? r.supplier_code : null, unitCostSen: Number(r.unit_cost_sen) })) {
      out.skipped.push({ ...line, reason: 'Customer-supplied: the customer orders it, no purchase order' }); continue;
    }
    if (!r.supplier_id) {
      if (Number(r.unit_cost_sen) === 0) out.skipped.push({ ...line, reason: 'No supplier and no cost: done in house' });
      else out.blocked.push({ ...line, reason: 'Has a cost but no supplier' });
      continue;
    }
    if (line.qty <= 0) continue;
    const key = `${r.supplier_id}|${group ?? ''}`;
    const g = groups.get(key) ?? { categoryGroup: group ?? '', supplierId: r.supplier_id, supplierCode: r.supplier_code ?? '', supplierName: r.supplier_name ?? '', lines: [], totalSen: 0 };
    g.lines.push(line);
    g.totalSen += line.amountSen;
    groups.set(key, g);
  }
  out.groups = [...groups.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.categoryGroup.localeCompare(b.categoryGroup));
  return out;
}

async function candidates(db: RenoDb, docNo: string, companyId: number): Promise<CandidateRow[]> {
  return db.q<CandidateRow>(
    `select l.id as line_id, l.so_item_id, l.kind, i.item_code, i.description, l.qty, l.measure::text as measure, l.measure_uom, l.uom,
            l.unit_cost_sen, l.supply_by_owner, l.supplier_id, sup.code as supplier_code, sup.name as supplier_name,
            (select p.category::text from scm.mfg_products p where p.code = i.item_code and p.company_id = $2 order by (p.status = 'ACTIVE') desc limit 1) as category,
            (select p.sub_category from scm.mfg_products p where p.code = i.item_code and p.company_id = $2 order by (p.status = 'ACTIVE') desc limit 1) as sub_category,
            i.description2 as item_description2, i.uom as item_uom,
            coalesce((select sum(pi.qty) from scm.purchase_order_items pi join scm.purchase_orders po on po.id = pi.purchase_order_id
                       where pi.so_item_id = l.so_item_id and po.status::text <> 'CANCELLED'), 0)::int as ordered_qty
       from scm.reno_doc_lines l
       join scm.reno_doc_sections s on s.id = l.section_id
       join scm.mfg_sales_order_items i on i.id = l.so_item_id
       left join scm.suppliers sup on sup.id = l.supplier_id
      where s.so_doc_no = $1 and l.kind in ('ITEM', 'CHILD') and l.omitted_by_vo_id is null and not i.cancelled
      order by s.sort_order, l.sort_order`,
    [docNo, companyId],
  );
}

export async function previewPoSplit(db: RenoDb, docNo: string, companyId: number): Promise<SplitPreview> {
  await readContractHead(db, docNo, companyId);
  return groupForPo(await candidates(db, docNo, companyId));
}

export async function raisePos(
  db: RenoDb,
  actor: RenoActor,
  docNo: string,
  body: { supplierIds?: string[] | null; poDate?: string | null; expectedAt?: string | null },
): Promise<{ created: Array<{ id: string; poNumber: string; supplierId: string; categoryGroup: string; lineCount: number; totalSen: number }> }> {
  const head = await readContractHead(db, docNo, actor.companyId, true);
  if (!(RENO_LIVE_STATUSES as readonly string[]).includes(head.status)) throw refuse(409, 'contract_not_live', `A ${head.status} contract cannot raise purchase orders.`);
  const preview = groupForPo(await candidates(db, docNo, actor.companyId));
  if (preview.blocked.length) {
    throw refuse(409, 'lines_without_supplier', `${preview.blocked.length} line(s) have a cost but no supplier. Pick a supplier on each before raising POs.`,
      { lines: preview.blocked.map((l) => l.description).slice(0, 20) });
  }
  const pick = body.supplierIds?.length ? new Set(body.supplierIds) : null;
  const groups = preview.groups.filter((g) => !pick || pick.has(g.supplierId));
  if (groups.length === 0) throw refuse(409, 'nothing_to_order', 'Every line that needs a purchase order already has one.');
  const poDate = body.poDate || todayKl();
  const [tpl] = await db.q<{ id: string }>(`select id from scm.reno_term_templates where kind = 'PO' and company_id = $1 and is_default and active`, [actor.companyId]);
  const tplLines = tpl
    ? await db.q<{ seq: number; label: string; pct_bp: number; payable_on: string }>(`select seq, label, pct_bp, payable_on from scm.reno_term_template_lines where template_id = $1 order by seq`, [tpl.id])
    : [];
  const created: Array<{ id: string; poNumber: string; supplierId: string; categoryGroup: string; lineCount: number; totalSen: number }> = [];
  for (const g of groups) {
    const poNumber = await mintDocNo(db, 'purchase_orders', 'po_number', `${actor.docPrefix}PO-${yymmOf(poDate)}`);
    const [po] = await db.q<{ id: string }>(
      `insert into scm.purchase_orders (po_number, supplier_id, status, po_date, expected_at, subtotal_sen, tax_sen, total_sen, notes, submitted_at, created_by, company_id)
       values ($1, $2, 'SUBMITTED', $3::date, $4::date, $5, 0, $5, $6, now(), $7, $8) returning id`,
      [poNumber, g.supplierId, poDate, body.expectedAt ?? null, g.totalSen, `Renovation contract ${docNo}`, actor.staffId, actor.companyId],
    );
    await db.q(
      `insert into scm.purchase_order_items (purchase_order_id, material_kind, item_code, material_name, qty, unit_price_sen, line_total_sen,
          item_group, description, description2, uom, unit_cost_sen, so_item_id, line_no, company_id)
       select $2, 'mfg_product', x.item_code, x.description, x.qty, x.unit_cost_sen, x.amount_sen, 'RENOVATION', x.description, x.description2,
              x.uom, x.unit_cost_sen, x.so_item_id, x.line_no, $3
         from jsonb_to_recordset($1::text::jsonb) as x(item_code text, description text, qty int, unit_cost_sen int, amount_sen int,
              description2 text, uom text, so_item_id uuid, line_no int)`,
      [JSON.stringify(g.lines.map((l, i) => ({ item_code: l.itemCode, description: l.description, qty: l.qty, unit_cost_sen: l.unitCostSen,
        amount_sen: l.amountSen, description2: l.description2, uom: l.uom, so_item_id: l.soItemId, line_no: i + 1 }))), po.id, actor.companyId],
    );
    await db.q(
      `update scm.mfg_sales_order_items i set po_qty_picked = coalesce((select sum(pi.qty) from scm.purchase_order_items pi
          join scm.purchase_orders p on p.id = pi.purchase_order_id where pi.so_item_id = i.id and p.status::text <> 'CANCELLED'), 0)
        where i.id::text = any(string_to_array($1, ','))`,
      [g.lines.map((l) => l.soItemId).join(',')],
    );
    if (tplLines.length) {
      const amounts = poInstalmentAmounts(tplLines.map((t) => Number(t.pct_bp)), g.totalSen);
      await db.q(
        `insert into scm.reno_po_instalments (company_id, purchase_order_id, seq, label, pct_bp, amount_sen, payable_on)
         select $2, $3, x.seq, x.label, x.pct_bp, x.amount_sen, x.payable_on
           from jsonb_to_recordset($1::text::jsonb) as x(seq int, label text, pct_bp int, amount_sen int, payable_on text)`,
        [JSON.stringify(tplLines.map((t, i) => ({ seq: Number(t.seq), label: t.label, pct_bp: Number(t.pct_bp), amount_sen: amounts[i], payable_on: t.payable_on }))), actor.companyId, po.id],
      );
    }
    await db.q(
      `insert into scm.entity_audit_log (company_id, entity_type, entity_id, entity_doc_no, action, actor_name_snapshot, note, source)
       values ($1, 'purchase_order', $2, $3, 'CREATE', $4, $5, 'renovation')`,
      [actor.companyId, po.id, poNumber, actor.name, `Raised from renovation contract ${docNo}`],
    );
    created.push({ id: po.id, poNumber, supplierId: g.supplierId, categoryGroup: g.categoryGroup, lineCount: g.lines.length, totalSen: g.totalSen });
  }
  await db.q(
    `insert into scm.mfg_so_audit_log (so_doc_no, company_id, action, actor_name_snapshot, source, note) values ($1, $2, 'PO_SPLIT', $3, 'renovation', $4)`,
    [docNo, actor.companyId, actor.name, `Raised ${created.map((c) => c.poNumber).join(', ')}`],
  );
  return { created };
}
