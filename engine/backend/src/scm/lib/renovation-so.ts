/* The renovation sales order (the contract of one project).

   - convertQuotationToSo: the accepted revision becomes the SO in one step: one
     mfg_sales_order_items row per priced line (renovation-money's soMirrorRow),
     a RENO-ADJUST row per lump-sum section, a negative RENO-DISCOUNT row for
     the document discount; the structure, instalments and print header are
     copied onto the SO; the quotation locks.
   - readContract: everything the contract screen and the prints need.
   - recomputeSoHeader: the header roll-up after lines change.
   - patchContract: cosmetic edits only (prices change through a VO).
   - setContractStatus: Confirmed -> In progress -> Completed -> Closed, or Cancelled. */

import { auditEntity, auditSo, mintDocNo, refuse, todayKl, yymmOf, type RenoDb } from './renovation-db';
import { cloneSections, insertInstalments, insertSections, readInstalments, readSections, totalsOf, toMoneyLine } from './renovation-doc-lines';
import { lockQuotation, readRevision, type RenoActor } from './renovation-quotation';
import type { DocHeaderInput, NormSection, PrintFormat } from './renovation-validate';
import { lineCostSen, soMirrorRow } from '../shared/renovation-money';
import { isStageKey } from '../shared/renovation-stages';

export const RENO_LIVE_STATUSES = ['RENO_CONFIRMED', 'RENO_IN_PROGRESS', 'RENO_COMPLETED'] as const;
export type RenoSoStatus = (typeof RENO_LIVE_STATUSES)[number] | 'CLOSED' | 'CANCELLED';

const NEXT: Record<RenoSoStatus, RenoSoStatus[]> = {
  RENO_CONFIRMED: ['RENO_IN_PROGRESS', 'CANCELLED'],
  RENO_IN_PROGRESS: ['RENO_COMPLETED', 'RENO_CONFIRMED'],
  RENO_COMPLETED: ['CLOSED', 'RENO_IN_PROGRESS'],
  CLOSED: [],
  CANCELLED: [],
};

export function contractTransitionAllowed(from: string, to: string): boolean {
  return (NEXT as Record<string, string[]>)[from]?.includes(to) ?? false;
}

interface SoItemInsert {
  id: string; line_no: number; item_code: string; description: string; description2: string | null; uom: string; location: string;
  qty: number; unit_price_sen: number; discount_sen: number; total_sen: number; unit_cost_sen: number; line_cost_sen: number;
}

/** SO item rows for a structure (also used by VO apply for added lines).
    Assigns soItemId onto each priced line and each lump-sum section. */
export function mirrorRowsFor(sections: NormSection[], productName: (code: string) => string | undefined, startLineNo: number): SoItemInsert[] {
  const rows: SoItemInsert[] = [];
  let lineNo = startLineNo;
  for (const s of sections) {
    const inLumpSum = s.lumpSumSen !== null && s.lumpSumSen !== undefined;
    if (inLumpSum) {
      const id = crypto.randomUUID();
      s.soItemId = id;
      rows.push({
        id, line_no: lineNo++, item_code: 'RENO-ADJUST', description: s.heading || 'Lump sum', description2: null, uom: 'LOT', location: '',
        qty: 1, unit_price_sen: s.lumpSumSen!, discount_sen: 0, total_sen: s.lumpSumSen!, unit_cost_sen: 0, line_cost_sen: 0,
      });
    }
    for (const l of s.lines) {
      if (l.kind !== 'ITEM' && l.kind !== 'CHILD') continue;
      const id = crypto.randomUUID();
      l.soItemId = id;
      const m = soMirrorRow(toMoneyLine(l), { inLumpSum });
      const cost = lineCostSen(l);
      rows.push({
        id, line_no: lineNo++, item_code: l.itemCode!, description: l.description || productName(l.itemCode!) || l.itemCode!,
        description2: m.description2, uom: m.uom, location: l.room, qty: m.qty, unit_price_sen: m.unit_price_sen,
        discount_sen: m.discount_sen, total_sen: m.total_sen, unit_cost_sen: m.qty > 0 ? Math.round(cost / m.qty) : cost, line_cost_sen: cost,
      });
    }
  }
  return rows;
}

export async function insertSoItems(db: RenoDb, docNo: string, rows: SoItemInsert[], p: { companyId: number; debtorName: string; lineDate: string }): Promise<void> {
  if (rows.length === 0) return;
  await db.q(
    `insert into scm.mfg_sales_order_items (id, doc_no, line_date, debtor_name, item_group, item_code, description, description2, uom, location,
        qty, unit_price_sen, discount_sen, total_sen, total_inc_sen, balance_sen, unit_cost_sen, line_cost_sen, line_margin_sen, line_no, company_id)
     select x.id, $2, $3::date, $4, 'RENOVATION', x.item_code, x.description, x.description2, x.uom, x.location,
        x.qty, x.unit_price_sen, x.discount_sen, x.total_sen, x.total_sen, x.total_sen, x.unit_cost_sen, x.line_cost_sen, x.total_sen - x.line_cost_sen,
        x.line_no, $5
       from jsonb_to_recordset($1::text::jsonb) as x(id uuid, line_no int, item_code text, description text, description2 text, uom text,
        location text, qty int, unit_price_sen int, discount_sen int, total_sen int, unit_cost_sen int, line_cost_sen int)`,
    [JSON.stringify(rows), docNo, p.lineDate, p.debtorName, p.companyId],
  );
}

/** Header roll-up from the live (not cancelled) lines. Returns the revised contract sum. */
export async function recomputeSoHeader(db: RenoDb, docNo: string): Promise<number> {
  const [r] = await db.q<{ total: number }>(
    `with s as (
       select coalesce(sum(total_sen), 0)::int as total, coalesce(sum(line_cost_sen), 0)::int as cost, count(*)::int as n
         from scm.mfg_sales_order_items where doc_no = $1 and not cancelled)
     update scm.mfg_sales_orders o set
        local_total_sen = s.total, subtotal_sen = s.total, total_revenue_sen = s.total, others_sen = s.total,
        total_cost_sen = s.cost, others_cost_sen = s.cost, total_margin_sen = s.total - s.cost, line_count = s.n,
        balance_sen = s.total - o.paid_sen, version = o.version + 1, updated_at = now()
       from s where o.doc_no = $1
     returning s.total`,
    [docNo],
  );
  return Number(r?.total ?? 0);
}

async function productNames(db: RenoDb, companyId: number, codes: string[]): Promise<Map<string, { name: string; category: string; status: string }>> {
  const out = new Map<string, { name: string; category: string; status: string }>();
  if (codes.length === 0) return out;
  const rows = await db.q<{ code: string; name: string; category: string; status: string }>(
    `select distinct on (code) code, name, category::text as category, status::text as status from scm.mfg_products
      where company_id = $1 and code = any(string_to_array($2, chr(31))) order by code, (status = 'ACTIVE') desc`,
    [companyId, codes.join('\u001f')],
  );
  for (const r of rows) out.set(r.code, { name: r.name, category: r.category, status: r.status });
  return out;
}

export async function liveContractOfProject(db: RenoDb, projectId: number): Promise<string | null> {
  const [r] = await db.q<{ doc_no: string }>(
    `select doc_no from scm.mfg_sales_orders where project_id = $1 and so_kind = 'RENOVATION' and status <> 'CANCELLED' limit 1`,
    [projectId],
  );
  return r?.doc_no ?? null;
}

export async function convertQuotationToSo(
  db: RenoDb,
  actor: RenoActor,
  quotationId: string,
  body: { version: number; soDate?: string | null },
): Promise<{ docNo: string; contractSen: number }> {
  const q = await lockQuotation(db, quotationId, actor.companyId);
  if (q.version !== body.version) throw refuse(409, 'stale_version', 'Someone else saved this quotation first. Reload to see their changes.', { version: q.version });
  if (q.convertedSoDocNo) throw refuse(409, 'already_converted', `This quotation is already sales order ${q.convertedSoDocNo}.`, { docNo: q.convertedSoDocNo });
  if (q.status !== 'ACCEPTED' || q.acceptedRev === null) throw refuse(409, 'not_accepted', 'Mark the quotation accepted before converting it.');
  const existing = q.projectId != null ? await liveContractOfProject(db, q.projectId) : null;
  if (existing) throw refuse(409, 'project_has_contract', `This project already has sales order ${existing}.`, { docNo: existing });

  const [revRow] = await db.q<{ id: string }>(`select id from scm.reno_quotation_revisions where quotation_id = $1 and rev_no = $2`, [quotationId, q.acceptedRev]);
  const rev = await readRevision(db, revRow.id);
  if (rev.instalments.length === 0) throw refuse(422, 'no_payment_terms', 'Add the payment terms before converting.');

  const priced = rev.sections.flatMap((s) => s.lines.filter((l) => l.kind === 'ITEM' || l.kind === 'CHILD'));
  const noSku = priced.filter((l) => !l.itemCode);
  if (noSku.length) {
    throw refuse(422, 'lines_without_sku', `${noSku.length} priced line(s) have no product picked. Every priced line needs one (use the generic RN- product for free text).`,
      { lines: noSku.map((l) => l.description).slice(0, 20) });
  }
  const products = await productNames(db, actor.companyId, [...new Set(priced.map((l) => l.itemCode!))]);
  const unknown = [...new Set(priced.map((l) => l.itemCode!).filter((c) => !products.has(c)))];
  if (unknown.length) throw refuse(422, 'unknown_products', `Products not in the catalog: ${unknown.join(', ')}.`, { codes: unknown });

  const soDate = body.soDate || todayKl();
  const docNo = await mintDocNo(db, 'mfg_sales_orders', 'doc_no', `${actor.docPrefix}SO-${yymmOf(soDate)}`);
  const sections = cloneSections(rev.sections);
  const rows = mirrorRowsFor(sections, (c) => products.get(c)?.name, 1);
  const h = rev.header;
  let discountItemId: string | null = null;
  if (h.docDiscountSen > 0) {
    discountItemId = crypto.randomUUID();
    rows.push({
      id: discountItemId, line_no: rows.length + 1, item_code: 'RENO-DISCOUNT', description: h.docDiscountLabel || 'Discount', description2: null,
      uom: 'LOT', location: '', qty: 1, unit_price_sen: -h.docDiscountSen, discount_sen: 0, total_sen: -h.docDiscountSen, unit_cost_sen: 0, line_cost_sen: 0,
    });
  }
  const contractSen = rows.reduce((s, r) => s + r.total_sen, 0);
  if (contractSen !== rev.totals.finalSen) throw new Error(`convert ${q.quoteNo}: mirrored rows sum ${contractSen} but the quotation totals ${rev.totals.finalSen}`);

  const [brand] = q.brandId ? await db.q<{ name: string }>(`select name from public.project_brands where id = $1`, [q.brandId]) : [];
  const debtorName = h.customerName || h.attention || 'Customer';
  await db.q(
    `insert into scm.mfg_sales_orders (doc_no, so_date, so_kind, status, debtor_name, project_id, branding, ref, phone, email,
        address1, address2, note, created_by, company_id)
     values ($1, $2::date, 'RENOVATION', 'RENO_CONFIRMED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [docNo, soDate, debtorName, q.projectId, brand?.name ?? null, rev.docNo, h.customerPhone || null, h.customerEmail || null,
      h.building || null, h.unitNo || null, `Renovation contract from quotation ${rev.docNo}`, actor.staffId, actor.companyId],
  );
  await insertSoItems(db, docNo, rows, { companyId: actor.companyId, debtorName, lineDate: soDate });
  const revised = await recomputeSoHeader(db, docNo);
  await insertSections(db, { kind: 'so', id: docNo }, sections, actor.companyId);
  await insertInstalments(db, { kind: 'so', id: docNo }, rev.instalments.map(({ id: _id, ...r }) => r), actor.companyId);
  await db.q(
    `insert into scm.reno_so_contracts (so_doc_no, company_id, project_id, quotation_id, quotation_revision_id, quote_doc_no, brand_id, print_format,
        attention, customer_name, building, unit_no, prepared_by, doc_date, last_amended, intro, terms_note, doc_discount_sen, doc_discount_label,
        promo_lines, discount_so_item_id, original_contract_sen, term_template_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::date, $15::date, $16, $17, $18, $19, $20::text::jsonb, $21, $22, $23, $24)`,
    [docNo, actor.companyId, q.projectId, quotationId, rev.id, rev.docNo, q.brandId, h.printFormat, h.attention, debtorName, h.building, h.unitNo,
      h.preparedBy, soDate, h.lastAmended, h.intro, h.termsNote, h.docDiscountSen, h.docDiscountLabel, JSON.stringify(h.promoLines), discountItemId,
      revised, h.termTemplateId, actor.name],
  );
  await db.q(`update scm.reno_quotation_revisions set frozen_at = coalesce(frozen_at, now()) where id = $1`, [rev.id]);
  await db.q(
    `update scm.reno_quotations set converted_so_doc_no = $2, locked_at = now(), version = version + 1, updated_at = now() where id = $1`,
    [quotationId, docNo],
  );
  await db.q(
    `insert into scm.mfg_so_status_changes (doc_no, from_status, to_status, changed_by, notes, company_id) values ($1, null, 'RENO_CONFIRMED', $2, $3, $4)`,
    [docNo, actor.staffId, `Converted from quotation ${rev.docNo}`, actor.companyId],
  );
  await auditSo(db, { companyId: actor.companyId, docNo, action: 'CREATE', actorName: actor.name, status: 'RENO_CONFIRMED', note: `Renovation contract from quotation ${rev.docNo}` });
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation', entityId: quotationId, docNo: rev.docNo, action: 'CONVERT', actorName: actor.name, note: docNo });
  return { docNo, contractSen: revised };
}

export interface ContractHeader {
  printFormat: PrintFormat; attention: string; customerName: string; building: string; unitNo: string; preparedBy: string; docDate: string;
  lastAmended: string | null; intro: string | null; termsNote: string; docDiscountSen: number; docDiscountLabel: string;
  promoLines: Array<{ text: string; color?: string | null }>; brandId: number | null; quoteDocNo: string | null; quotationId: string | null;
  originalContractSen: number; termTemplateId: string | null; version: number;
}

export async function readContractHead(db: RenoDb, docNo: string, companyId: number, forUpdate = false) {
  const [so] = await db.q(
    `select o.doc_no, o.status::text as status, o.so_kind, o.so_date::text as so_date, o.debtor_name, o.debtor_code, o.project_id, o.local_total_sen,
            o.paid_sen, o.balance_sen, o.version, o.revision, o.company_id, o.branding,
            c.print_format, c.attention, c.customer_name, c.building, c.unit_no, c.prepared_by, c.doc_date::text as doc_date,
            c.last_amended::text as last_amended, c.intro, c.terms_note, c.doc_discount_sen, c.doc_discount_label, c.promo_lines, c.brand_id,
            c.quote_doc_no, c.quotation_id, c.original_contract_sen, c.term_template_id, c.version as contract_version, c.discount_so_item_id
       from scm.mfg_sales_orders o
       left join scm.reno_so_contracts c on c.so_doc_no = o.doc_no
      where o.doc_no = $1 and o.company_id = $2
      ${forUpdate ? 'for update of o' : ''}`,
    [docNo, companyId],
  );
  if (!so) throw refuse(404, 'so_not_found', `Sales order ${docNo} does not exist.`);
  if (so.so_kind !== 'RENOVATION' || so.contract_version === null) throw refuse(409, 'not_renovation', `${docNo} is not a renovation contract.`);
  const header: ContractHeader = {
    printFormat: so.print_format, attention: so.attention, customerName: so.customer_name, building: so.building, unitNo: so.unit_no,
    preparedBy: so.prepared_by, docDate: so.doc_date, lastAmended: so.last_amended, intro: so.intro, termsNote: so.terms_note,
    docDiscountSen: Number(so.doc_discount_sen), docDiscountLabel: so.doc_discount_label,
    promoLines: Array.isArray(so.promo_lines) ? so.promo_lines : [], brandId: so.brand_id === null ? null : Number(so.brand_id),
    quoteDocNo: so.quote_doc_no, quotationId: so.quotation_id, originalContractSen: Number(so.original_contract_sen),
    termTemplateId: so.term_template_id, version: Number(so.contract_version),
  };
  return {
    docNo: so.doc_no as string, status: so.status as RenoSoStatus, soDate: so.so_date as string, debtorName: so.debtor_name as string,
    debtorCode: so.debtor_code as string | null, projectId: so.project_id === null ? null : Number(so.project_id),
    paidSen: Number(so.paid_sen), soVersion: Number(so.version), revision: Number(so.revision), branding: so.branding as string | null,
    discountSoItemId: so.discount_so_item_id as string | null, header,
  };
}

export async function revisedContractSen(db: RenoDb, docNo: string): Promise<number> {
  const [r] = await db.q<{ total: number }>(`select coalesce(sum(total_sen), 0)::int as total from scm.mfg_sales_order_items where doc_no = $1 and not cancelled`, [docNo]);
  return Number(r?.total ?? 0);
}

export async function readContract(db: RenoDb, docNo: string, companyId: number) {
  const head = await readContractHead(db, docNo, companyId);
  const sections = await readSections(db, { kind: 'so', id: docNo });
  const instalments = await readInstalments(db, { kind: 'so', id: docNo });
  const vos = await db.q(
    `select id, vo_no, seq, status, title, doc_date::text as doc_date, net_sen, approved_at::text as approved_at from scm.reno_variation_orders
      where so_doc_no = $1 order by seq`,
    [docNo],
  );
  const [flags] = await db.q<{ n: number }>(
    `select count(*)::int as n from scm.reno_po_line_flags f join scm.reno_variation_orders v on v.id = f.vo_id where v.so_doc_no = $1 and f.status = 'OPEN'`,
    [docNo],
  );
  const revised = await revisedContractSen(db, docNo);
  return {
    ...head,
    sections,
    instalments,
    variationOrders: vos.map((v) => ({ id: v.id, voNo: v.vo_no, seq: Number(v.seq), status: v.status, title: v.title, docDate: v.doc_date, netSen: Number(v.net_sen), approvedAt: v.approved_at })),
    openPoFlags: Number(flags?.n ?? 0),
    totals: {
      ...totalsOf(sections, head.header.docDiscountSen),
      originalContractSen: head.header.originalContractSen,
      revisedContractSen: revised,
      voTotalSen: revised - head.header.originalContractSen,
    },
  };
}

export async function patchContract(
  db: RenoDb,
  actor: RenoActor,
  docNo: string,
  body: {
    version: number;
    header?: DocHeaderInput;
    sections?: Array<{ id: string; heading?: string; bandColor?: string | null; pageBreakBefore?: boolean }>;
    /* supplierId / unitCostSen are internal (who we buy from, at what cost): editable until the line is on a live PO. */
    lines?: Array<{ id: string; description?: string; room?: string; highlight?: 'NONE' | 'GREY' | 'PINK'; pageBreakBefore?: boolean; stageCode?: string | null; supplierId?: string | null; unitCostSen?: number }>;
  },
): Promise<{ version: number }> {
  const head = await readContractHead(db, docNo, actor.companyId, true);
  if (head.header.version !== body.version) throw refuse(409, 'stale_version', 'Someone else saved this contract first. Reload to see their changes.', { version: head.header.version });
  if (head.status === 'CANCELLED' || head.status === 'CLOSED') throw refuse(409, 'contract_closed', `A ${head.status.toLowerCase()} contract cannot be edited.`);
  const h = body.header ?? {};
  const forbidden = (['docDiscountSen', 'termTemplateId'] as const).filter((k) => h[k] !== undefined);
  if (forbidden.length) throw refuse(409, 'price_fields_locked', 'Prices, discounts and payment terms of a contract change through a variation order.');
  await db.q(
    `update scm.reno_so_contracts set
        print_format = coalesce($2, print_format), attention = coalesce($3, attention), customer_name = coalesce($4, customer_name),
        building = coalesce($5, building), unit_no = coalesce($6, unit_no), prepared_by = coalesce($7, prepared_by),
        last_amended = case when $8::boolean then $9::date else last_amended end, intro = case when $10::boolean then $11 else intro end,
        terms_note = coalesce($12, terms_note), doc_discount_label = coalesce($13, doc_discount_label),
        promo_lines = coalesce($14::text::jsonb, promo_lines), brand_id = case when $15::boolean then $16 else brand_id end,
        version = version + 1, updated_at = now()
      where so_doc_no = $1`,
    [docNo, h.printFormat ?? null, h.attention ?? null, h.customerName ?? null, h.building ?? null, h.unitNo ?? null, h.preparedBy ?? null,
      h.lastAmended !== undefined, h.lastAmended ?? null, h.intro !== undefined, h.intro ?? null, h.termsNote ?? null, h.docDiscountLabel ?? null,
      h.promoLines ? JSON.stringify(h.promoLines) : null, h.brandId !== undefined, h.brandId ?? null],
  );
  for (const s of body.sections ?? []) {
    await db.q(
      `update scm.reno_doc_sections set heading = coalesce($3, heading), band_color = case when $4::boolean then $5 else band_color end,
          page_break_before = coalesce($6, page_break_before)
        where id = $1 and so_doc_no = $2`,
      [s.id, docNo, s.heading ?? null, s.bandColor !== undefined, s.bandColor ?? null, s.pageBreakBefore ?? null],
    );
  }
  for (const l of body.lines ?? []) {
    if (l.stageCode && !isStageKey(l.stageCode)) throw refuse(400, 'bad_stage', `Unknown stage ${l.stageCode}.`);
    const [row] = await db.q<{ so_item_id: string | null }>(
      `update scm.reno_doc_lines l set description = coalesce($3, l.description), room = coalesce($4, l.room), highlight = coalesce($5, l.highlight),
          page_break_before = coalesce($6, l.page_break_before), stage_code = case when $7::boolean then $8 else l.stage_code end, updated_at = now()
         from scm.reno_doc_sections s
        where l.id = $1 and s.id = l.section_id and s.so_doc_no = $2
        returning l.so_item_id`,
      [l.id, docNo, l.description ?? null, l.room ?? null, l.highlight ?? null, l.pageBreakBefore ?? null, l.stageCode !== undefined, l.stageCode ?? null],
    );
    if (!row) throw refuse(404, 'line_not_found', 'A line in this edit is not on the contract.');
    if (l.supplierId !== undefined || l.unitCostSen !== undefined) {
      if (l.unitCostSen !== undefined && (!Number.isInteger(l.unitCostSen) || l.unitCostSen < 0)) throw refuse(400, 'bad_cost', 'Cost must be a whole number of sen, 0 or more.');
      if (row.so_item_id) {
        const [po] = await db.q<{ n: number }>(
          `select count(*)::int as n from scm.purchase_order_items pi join scm.purchase_orders p on p.id = pi.purchase_order_id
            where pi.so_item_id = $1 and p.status::text <> 'CANCELLED'`,
          [row.so_item_id],
        );
        if (Number(po.n) > 0) throw refuse(409, 'line_on_po', 'This line is already on a purchase order; change the supplier or cost on the PO.');
      }
      const [upd] = await db.q<{ unit_cost_sen: number; qty: number; measure: string | null; kind: string }>(
        `update scm.reno_doc_lines set supplier_id = case when $2::boolean then $3::uuid else supplier_id end,
            unit_cost_sen = coalesce($4, unit_cost_sen), updated_at = now()
          where id = $1 returning unit_cost_sen, qty, measure::text as measure, kind`,
        [l.id, l.supplierId !== undefined, l.supplierId ?? null, l.unitCostSen ?? null],
      );
      if (row.so_item_id && l.unitCostSen !== undefined) {
        const cost = lineCostSen({ kind: upd.kind as 'ITEM', qty: Number(upd.qty), measureMilli: upd.measure === null ? null : Math.round(Number(upd.measure) * 1000), unitCostSen: Number(upd.unit_cost_sen) });
        await db.q(
          `update scm.mfg_sales_order_items set line_cost_sen = $2, unit_cost_sen = case when qty > 0 then round($2::numeric / qty)::int else $2 end,
              line_margin_sen = total_sen - $2 where id = $1`,
          [row.so_item_id, cost],
        );
        await recomputeSoHeader(db, docNo);
      }
    }
    if (row.so_item_id && (l.description !== undefined || l.room !== undefined)) {
      await db.q(`update scm.mfg_sales_order_items set description = coalesce($2, description), location = coalesce($3, location) where id = $1`,
        [row.so_item_id, l.description ?? null, l.room ?? null]);
    }
  }
  if (h.customerName) await db.q(`update scm.mfg_sales_orders set debtor_name = $2, updated_at = now() where doc_no = $1`, [docNo, h.customerName]);
  const [v] = await db.q<{ version: number }>(`select version from scm.reno_so_contracts where so_doc_no = $1`, [docNo]);
  await auditSo(db, { companyId: actor.companyId, docNo, action: 'UPDATE', actorName: actor.name, note: 'Renovation contract header / layout edited' });
  return { version: Number(v.version) };
}

export async function setContractStatus(db: RenoDb, actor: RenoActor, docNo: string, to: RenoSoStatus, note?: string): Promise<{ status: RenoSoStatus }> {
  const head = await readContractHead(db, docNo, actor.companyId, true);
  if (!contractTransitionAllowed(head.status, to)) throw refuse(409, 'bad_transition', `A contract that is ${head.status} cannot become ${to}.`);
  if (to === 'CANCELLED') {
    const [b] = await db.q<{ n: number }>(`select count(*)::int as n from scm.reno_instalment_bills where so_doc_no = $1`, [docNo]);
    if (Number(b.n) > 0) throw refuse(409, 'has_bills', 'This contract has been billed; issue credit notes instead of cancelling it.');
    const [p] = await db.q<{ n: number }>(
      `select count(*)::int as n from scm.purchase_order_items pi join scm.purchase_orders po on po.id = pi.purchase_order_id
         join scm.mfg_sales_order_items si on si.id = pi.so_item_id
        where si.doc_no = $1 and po.status::text <> 'CANCELLED'`,
      [docNo],
    );
    if (Number(p.n) > 0) throw refuse(409, 'has_purchase_orders', 'Cancel the purchase orders raised from this contract first.');
  }
  await db.q(`update scm.mfg_sales_orders set status = $2::scm.mfg_so_status, version = version + 1, updated_at = now() where doc_no = $1`, [docNo, to]);
  await db.q(
    `insert into scm.mfg_so_status_changes (doc_no, from_status, to_status, changed_by, notes, company_id) values ($1, $2, $3, $4, $5, $6)`,
    [docNo, head.status, to, actor.staffId, note ?? null, actor.companyId],
  );
  await auditSo(db, { companyId: actor.companyId, docNo, action: 'UPDATE_STATUS', actorName: actor.name, status: to, changes: [{ field: 'status', from: head.status, to }], note });
  return { status: to };
}
