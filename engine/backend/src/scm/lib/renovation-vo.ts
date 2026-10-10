/* Variation orders on a renovation contract: VO-<SO no>-NN, add lines and
   omit lines, printed for the customer's signature.

   Approving one applies it in the same transaction:
   - the SO's current state is frozen into so_revisions (as snapshotSo does) and
     an so_amendments row (amendment_no = VO no, status SENT, resolution
     RENOVATION_VO) with one so_amendment_lines row per change, so the engine's
     amendment history shows it like any other revision;
   - add lines become new SO rows and a contract section tagged with the VO;
   - a fully omitted line cancels its SO row (omitted_by_vo_id on the contract
     line); a partly omitted one has its quantity reduced and repriced;
   - every live PO line that bought omitted work gets a reno_po_line_flags row
     (CANCEL or AMEND to the new quantity) for procurement;
   - the header rolls up again; the next unbilled instalment then catches up the
     difference, a net negative ending as a credit note (renovation-billing.ts).

   Applying never reprices other lines (applySoAmendment would reprice the whole
   order with furniture pricing, which is why it is not used here). */

import { auditSo, refuse, todayKl, type RenoDb } from './renovation-db';
import { insertSections, readSections, toMoneyLine, type DocLineOut } from './renovation-doc-lines';
import { insertSoItems, mirrorRowsFor, readContractHead, recomputeSoHeader, RENO_LIVE_STATUSES } from './renovation-so';
import type { RenoActor } from './renovation-quotation';
import type { NormSection } from './renovation-validate';
import { lineAmounts, lineCostSen, soMirrorRow } from '../shared/renovation-money';
import { fmtSen } from '../shared/format';

export type VoStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'CANCELLED';

export function voNoFor(soDocNo: string, seq: number): string {
  return `VO-${soDocNo}-${String(seq).padStart(2, '0')}`;
}

async function lockVo(db: RenoDb, id: string, companyId: number) {
  const [v] = await db.q(
    `select id, vo_no, so_doc_no, seq, status, title, doc_date::text as doc_date, net_sen, version, signed_name, signed_at::text as signed_at,
            approved_at::text as approved_at, amendment_id
       from scm.reno_variation_orders where id = $1 and company_id = $2 for update`,
    [id, companyId],
  );
  if (!v) throw refuse(404, 'vo_not_found', 'That variation order does not exist.');
  return v as { id: string; vo_no: string; so_doc_no: string; seq: number; status: VoStatus; title: string; doc_date: string; net_sen: number; version: number; signed_name: string | null; signed_at: string | null; approved_at: string | null; amendment_id: string | null };
}

export async function createVo(db: RenoDb, actor: RenoActor, soDocNo: string, body: { title?: string }): Promise<{ id: string; voNo: string }> {
  const head = await readContractHead(db, soDocNo, actor.companyId, true);
  if (!(RENO_LIVE_STATUSES as readonly string[]).includes(head.status)) throw refuse(409, 'contract_not_live', `A ${head.status} contract cannot take a variation order.`);
  const [m] = await db.q<{ n: number }>(`select coalesce(max(seq), 0)::int as n from scm.reno_variation_orders where so_doc_no = $1`, [soDocNo]);
  const seq = Number(m.n) + 1;
  const voNo = voNoFor(soDocNo, seq);
  const [v] = await db.q<{ id: string }>(
    `insert into scm.reno_variation_orders (company_id, vo_no, so_doc_no, seq, title, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
    [actor.companyId, voNo, soDocNo, seq, body.title ?? '', actor.name],
  );
  await auditSo(db, { companyId: actor.companyId, docNo: soDocNo, action: 'VO_CREATE', actorName: actor.name, note: voNo });
  return { id: v.id, voNo };
}

interface OmitTarget extends DocLineOut { sectionHeading: string }

async function contractTargets(db: RenoDb, soDocNo: string): Promise<Map<string, OmitTarget>> {
  const sections = await readSections(db, { kind: 'so', id: soDocNo });
  const out = new Map<string, OmitTarget>();
  for (const s of sections) {
    for (const l of s.lines) {
      if ((l.kind === 'ITEM' || l.kind === 'CHILD') && !l.omittedByVoId && !l.soItemCancelled && s.lumpSumSen === null) {
        out.set(l.id, { ...l, sectionHeading: s.heading });
      }
    }
  }
  return out;
}

/** Signed amount of an omit line: minus the part of the target it removes. */
export function omitAmountSen(target: Pick<DocLineOut, 'kind' | 'qty' | 'measureMilli' | 'measureUom' | 'uom' | 'unitPriceSen' | 'discountBp' | 'amountOverrideSen' | 'isFoc'>, omitQty: number | null): number {
  const full = lineAmounts(toMoneyLine(target)).netSen;
  if (omitQty === null || omitQty >= target.qty || target.measureMilli !== null) return -full;
  const rest = lineAmounts(toMoneyLine({ ...target, qty: target.qty - omitQty, amountOverrideSen: null })).netSen;
  return -(full - rest);
}

export async function readVo(db: RenoDb, id: string, companyId: number) {
  const [v] = await db.q(
    `select id, vo_no, so_doc_no, seq, status, title, doc_date::text as doc_date, net_sen, version, signed_name, signed_at::text as signed_at,
            approved_at::text as approved_at, approved_by, amendment_id
       from scm.reno_variation_orders where id = $1 and company_id = $2`,
    [id, companyId],
  );
  if (!v) throw refuse(404, 'vo_not_found', 'That variation order does not exist.');
  const sections = await readSections(db, { kind: 'vo', id });
  const targets = v.status === 'APPROVED' ? new Map<string, OmitTarget>() : await contractTargets(db, v.so_doc_no);
  let addSen = 0;
  let omitSen = 0;
  for (const s of sections) {
    for (const l of s.lines) {
      if (l.voChange === 'OMIT') {
        const t = l.omitTargetLineId ? targets.get(l.omitTargetLineId) : undefined;
        const amt = t ? omitAmountSen(t, l.omitQty) : -l.netSen;
        l.netSen = amt;
        omitSen += amt;
      } else {
        addSen += l.netSen;
      }
    }
  }
  return {
    id: v.id, voNo: v.vo_no, soDocNo: v.so_doc_no, seq: Number(v.seq), status: v.status as VoStatus, title: v.title, docDate: v.doc_date,
    version: Number(v.version), signedName: v.signed_name, signedAt: v.signed_at, approvedAt: v.approved_at, approvedBy: v.approved_by,
    amendmentId: v.amendment_id, sections, totals: { addSen, omitSen, netSen: v.status === 'APPROVED' ? Number(v.net_sen) : addSen + omitSen },
  };
}

/** Replace a draft VO's lines. OMIT lines are filled from the contract line they name. */
export async function saveVo(db: RenoDb, actor: RenoActor, id: string, body: { version: number; title?: string; docDate?: string; sections?: NormSection[] }): Promise<{ version: number; netSen: number }> {
  const v = await lockVo(db, id, actor.companyId);
  if (v.version !== body.version) throw refuse(409, 'stale_version', 'Someone else saved this variation order first. Reload to see their changes.', { version: v.version });
  if (v.status !== 'DRAFT') throw refuse(409, 'not_editable', 'Only a draft variation order can be edited.');
  let net = 0;
  if (body.sections) {
    const targets = await contractTargets(db, v.so_doc_no);
    const seen = new Set<string>();
    for (const s of body.sections) {
      for (const l of s.lines) {
        if (l.voChange !== 'OMIT') { net += lineAmounts(toMoneyLine(l)).netSen; continue; }
        const t = l.omitTargetLineId ? targets.get(l.omitTargetLineId) : undefined;
        if (!t) throw refuse(422, 'omit_target_invalid', `"${l.description || 'An omit line'}" names a line that is not live on the contract (or sits in a lump-sum section).`);
        if (seen.has(t.id)) throw refuse(422, 'omit_twice', `"${t.description}" is omitted twice in this variation order.`);
        seen.add(t.id);
        if (l.omitQty !== null && t.measureMilli !== null) throw refuse(422, 'omit_measured_partial', `"${t.description}" is measured: omit it whole or add a negative line.`);
        if (l.omitQty !== null && l.omitQty > t.qty) throw refuse(422, 'omit_too_many', `"${t.description}" has only ${t.qty} on the contract.`);
        Object.assign(l, {
          kind: t.kind === 'CHILD' ? 'ITEM' : t.kind, parentId: null, itemCode: t.itemCode, description: l.description || t.description, room: t.room,
          qty: l.omitQty ?? t.qty, measureMilli: t.measureMilli, measureUom: t.measureUom, uom: t.uom, unitPriceSen: t.unitPriceSen,
          discountBp: t.discountBp, amountOverrideSen: l.omitQty === null ? t.amountOverrideSen : null, isFoc: t.isFoc, supplierId: t.supplierId,
          unitCostSen: t.unitCostSen, stageCode: t.stageCode,
        });
        net += omitAmountSen(t, l.omitQty);
      }
    }
    await db.q(`delete from scm.reno_doc_sections where vo_id = $1`, [id]);
    await insertSections(db, { kind: 'vo', id }, body.sections, actor.companyId);
  } else {
    net = (await readVo(db, id, actor.companyId)).totals.netSen;
  }
  const [r] = await db.q<{ version: number }>(
    `update scm.reno_variation_orders set title = coalesce($2, title), doc_date = coalesce($3::date, doc_date), net_sen = $4,
        version = version + 1, updated_at = now() where id = $1 returning version`,
    [id, body.title ?? null, body.docDate ?? null, net],
  );
  return { version: Number(r.version), netSen: net };
}

export async function setVoStatus(db: RenoDb, actor: RenoActor, id: string, to: 'DRAFT' | 'SENT' | 'CANCELLED', version: number): Promise<{ status: VoStatus; version: number }> {
  const v = await lockVo(db, id, actor.companyId);
  if (v.version !== version) throw refuse(409, 'stale_version', 'Someone else saved this variation order first. Reload to see their changes.', { version: v.version });
  const ok = (v.status === 'DRAFT' && (to === 'SENT' || to === 'CANCELLED')) || (v.status === 'SENT' && (to === 'DRAFT' || to === 'CANCELLED'));
  if (!ok) throw refuse(409, 'bad_transition', `A ${v.status.toLowerCase()} variation order cannot become ${to.toLowerCase()}.`);
  const [r] = await db.q<{ version: number }>(
    `update scm.reno_variation_orders set status = $2, cancelled_at = case when $2 = 'CANCELLED' then now() else null end, version = version + 1, updated_at = now()
      where id = $1 returning version`,
    [id, to],
  );
  await auditSo(db, { companyId: actor.companyId, docNo: v.so_doc_no, action: 'VO_STATUS', actorName: actor.name, note: `${v.vo_no}: ${v.status} -> ${to}` });
  return { status: to, version: Number(r.version) };
}

export async function applyVo(
  db: RenoDb,
  actor: RenoActor,
  id: string,
  body: { version: number; signedName?: string | null; signedAt?: string | null },
): Promise<{ soDocNo: string; netSen: number; revisedContractSen: number; flags: number }> {
  const v0 = await lockVo(db, id, actor.companyId);
  const head = await readContractHead(db, v0.so_doc_no, actor.companyId, true);
  const v = await lockVo(db, id, actor.companyId);
  if (v.version !== body.version) throw refuse(409, 'stale_version', 'Someone else saved this variation order first. Reload to see their changes.', { version: v.version });
  if (v.status !== 'DRAFT' && v.status !== 'SENT') throw refuse(409, 'bad_transition', `A ${v.status.toLowerCase()} variation order cannot be approved.`);
  if (!(RENO_LIVE_STATUSES as readonly string[]).includes(head.status)) throw refuse(409, 'contract_not_live', `A ${head.status} contract cannot take a variation order.`);
  const soDocNo = v.so_doc_no;
  const voSections = await readSections(db, { kind: 'vo', id });
  const targets = await contractTargets(db, soDocNo);
  const addSections: NormSection[] = [];
  const omits: Array<{ target: OmitTarget; omitQty: number | null; amountSen: number }> = [];
  for (const s of voSections) {
    const adds = s.lines.filter((l) => l.voChange !== 'OMIT');
    for (const l of s.lines.filter((x) => x.voChange === 'OMIT')) {
      const t = l.omitTargetLineId ? targets.get(l.omitTargetLineId) : undefined;
      if (!t) throw refuse(409, 'omit_target_gone', `"${l.description}" is no longer live on the contract. Edit the variation order and approve again.`);
      omits.push({ target: t, omitQty: l.omitQty, amountSen: omitAmountSen(t, l.omitQty) });
    }
    if (adds.length) {
      const idMap = new Map(adds.map((l) => [l.id, crypto.randomUUID()]));
      addSections.push({
        id: crypto.randomUUID(), heading: s.heading, bandColor: s.bandColor, sortOrder: s.sortOrder, lumpSumSen: null, pageBreakBefore: s.pageBreakBefore,
        lines: adds.map((l) => ({ ...l, id: idMap.get(l.id)!, parentId: l.parentId ? (idMap.get(l.parentId) ?? null) : null, voChange: 'ADD', omitTargetLineId: null, omitQty: null })),
      });
    }
  }
  const addLines = addSections.flatMap((s) => s.lines.filter((l) => l.kind === 'ITEM' || l.kind === 'CHILD'));
  if (addLines.length === 0 && omits.length === 0) throw refuse(422, 'empty_vo', 'This variation order adds and omits nothing.');
  const noSku = addLines.filter((l) => !l.itemCode);
  if (noSku.length) throw refuse(422, 'lines_without_sku', `${noSku.length} added line(s) have no product picked.`, { lines: noSku.map((l) => l.description) });
  if (addLines.length) {
    const codes = [...new Set(addLines.map((l) => l.itemCode!))];
    const known = await db.q<{ code: string }>(`select distinct code from scm.mfg_products where company_id = $1 and code = any(string_to_array($2, chr(31)))`, [actor.companyId, codes.join('\u001f')]);
    const missing = codes.filter((c) => !known.some((k) => k.code === c));
    if (missing.length) throw refuse(422, 'unknown_products', `Products not in the catalog: ${missing.join(', ')}.`, { codes: missing });
  }

  // 1. Freeze the order as it stands, at its current revision (snapshotSo's shape).
  await db.q(
    `insert into scm.so_revisions (so_doc_no, revision, snapshot, created_by, company_id)
     select o.doc_no, o.revision, jsonb_build_object(
              'header', to_jsonb(o),
              'lines', coalesce((select jsonb_agg(to_jsonb(i) order by i.line_no) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no), '[]'::jsonb),
              'poLinks', coalesce((select jsonb_object_agg(x.so_item_id, x.ids) from (
                  select pi.so_item_id::text as so_item_id, jsonb_agg(pi.id) as ids from scm.purchase_order_items pi
                    join scm.mfg_sales_order_items i on i.id = pi.so_item_id where i.doc_no = o.doc_no group by pi.so_item_id) x), '{}'::jsonb)),
            $2, o.company_id
       from scm.mfg_sales_orders o where o.doc_no = $1
     on conflict do nothing`,
    [soDocNo, actor.staffId],
  );
  const [amd] = await db.q<{ id: string }>(
    `insert into scm.so_amendments (so_doc_no, amendment_no, status, reason, requested_by, so_approved_by, so_approved_at, sent_at, resolution, company_id)
     values ($1, $2, 'SENT', $3, $4, $4, now(), now(), 'RENOVATION_VO', $5) returning id`,
    [soDocNo, v.vo_no, v.title || `Variation order ${v.vo_no}`, actor.staffId, actor.companyId],
  );
  await db.q(`update scm.so_revisions set amendment_id = $3 where so_doc_no = $1 and revision = $2 and amendment_id is null`, [soDocNo, head.revision, amd.id]);

  // 2. Added lines.
  const [mx] = await db.q<{ n: number }>(`select coalesce(max(line_no), 0)::int as n from scm.mfg_sales_order_items where doc_no = $1`, [soDocNo]);
  const rows = mirrorRowsFor(addSections, () => undefined, Number(mx.n) + 1);
  await insertSoItems(db, soDocNo, rows, { companyId: actor.companyId, debtorName: head.debtorName, lineDate: todayKl() });
  const [so] = await db.q<{ n: number }>(`select coalesce(max(sort_order), 0)::int as n from scm.reno_doc_sections where so_doc_no = $1`, [soDocNo]);
  await insertSections(db, { kind: 'so', id: soDocNo }, addSections, actor.companyId, { voId: id, sortOffset: Number(so.n) });
  for (const r of rows) {
    await db.q(
      `insert into scm.so_amendment_lines (amendment_id, sales_order_item_id, change_type, new_item_code, new_qty, new_unit_price_sen, new_discount_sen, company_id)
       values ($1, $2, 'ADD', $3, $4, $5, $6, $7)`,
      [amd.id, r.id, r.item_code, r.qty, r.unit_price_sen, r.discount_sen, actor.companyId],
    );
  }

  // 3. Omitted lines, and the PO lines that bought them.
  let flags = 0;
  for (const o of omits) {
    const t = o.target;
    const full = o.omitQty === null || o.omitQty >= t.qty || t.measureMilli !== null;
    const [old] = await db.q(`select to_jsonb(i) as snap, i.qty from scm.mfg_sales_order_items i where i.id = $1 for update`, [t.soItemId]);
    if (full) {
      await db.q(`update scm.mfg_sales_order_items set cancelled = true where id = $1`, [t.soItemId]);
      await db.q(`update scm.reno_doc_lines set omitted_by_vo_id = $2, updated_at = now() where id = $1`, [t.id, id]);
      await db.q(
        `insert into scm.so_amendment_lines (amendment_id, sales_order_item_id, change_type, old_snapshot, company_id) values ($1, $2, 'REMOVE', $3::text::jsonb, $4)`,
        [amd.id, t.soItemId, JSON.stringify(old?.snap ?? null), actor.companyId],
      );
    } else {
      const newQty = t.qty - o.omitQty!;
      const reduced = { ...t, qty: newQty, amountOverrideSen: null };
      const m = soMirrorRow(toMoneyLine(reduced));
      const cost = lineCostSen(reduced);
      await db.q(
        `update scm.mfg_sales_order_items set qty = $2, unit_price_sen = $3, discount_sen = $4, total_sen = $5::int, total_inc_sen = $5::int, balance_sen = $5::int,
            line_cost_sen = $6::int, line_margin_sen = $5::int - $6::int where id = $1`,
        [t.soItemId, m.qty, m.unit_price_sen, m.discount_sen, m.total_sen, cost],
      );
      await db.q(`update scm.reno_doc_lines set qty = $2, amount_override_sen = null, updated_at = now() where id = $1`, [t.id, newQty]);
      await db.q(
        `insert into scm.so_amendment_lines (amendment_id, sales_order_item_id, change_type, new_qty, new_unit_price_sen, new_discount_sen, old_snapshot, company_id)
         values ($1, $2, 'MODIFY', $3, $4, $5, $6::text::jsonb, $7)`,
        [amd.id, t.soItemId, m.qty, m.unit_price_sen, m.discount_sen, JSON.stringify(old?.snap ?? null), actor.companyId],
      );
    }
    const poLines = await db.q<{ id: string; qty: number }>(
      `select pi.id, pi.qty from scm.purchase_order_items pi join scm.purchase_orders po on po.id = pi.purchase_order_id
        where pi.so_item_id = $1 and po.status::text <> 'CANCELLED'`,
      [t.soItemId],
    );
    for (const pl of poLines) {
      await db.q(
        `insert into scm.reno_po_line_flags (company_id, purchase_order_item_id, so_item_id, vo_id, action, new_qty, note)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [actor.companyId, pl.id, t.soItemId, id, full ? 'CANCEL' : 'AMEND', full ? 0 : t.qty - o.omitQty!,
          `${v.vo_no} omits ${full ? 'all of' : `${o.omitQty} of`} "${t.description}"`],
      );
      flags += 1;
    }
  }

  // 4. Roll up, stamp the revision, close the VO.
  const before = await db.q<{ total: number }>(`select local_total_sen as total from scm.mfg_sales_orders where doc_no = $1`, [soDocNo]);
  const revised = await recomputeSoHeader(db, soDocNo);
  const net = revised - Number(before[0]?.total ?? 0);
  await db.q(`update scm.mfg_sales_orders set revision = revision + 1 where doc_no = $1`, [soDocNo]);
  await db.q(`update scm.reno_so_contracts set last_amended = $2::date, version = version + 1, updated_at = now() where so_doc_no = $1`, [soDocNo, todayKl()]);
  await db.q(
    `update scm.reno_variation_orders set status = 'APPROVED', net_sen = $2, amendment_id = $3, signed_name = coalesce($4, signed_name),
        signed_at = coalesce($5::timestamptz, signed_at, now()), approved_at = now(), approved_by = $6, version = version + 1, updated_at = now()
      where id = $1`,
    [id, net, amd.id, body.signedName ?? null, body.signedAt ?? null, actor.name],
  );
  await auditSo(db, {
    companyId: actor.companyId, docNo: soDocNo, action: 'VO_APPLY', actorName: actor.name,
    note: `${v.vo_no} approved: ${rows.length} line(s) added, ${omits.length} omitted, net ${fmtSen(net)}${flags ? `, ${flags} PO line(s) flagged` : ''}`,
  });
  return { soDocNo, netSen: net, revisedContractSen: revised, flags };
}

export async function listPoFlags(db: RenoDb, soDocNo: string) {
  const rows = await db.q(
    `select f.id, f.action, f.new_qty, f.status, f.note, f.created_at::text as created_at, f.resolved_at::text as resolved_at, v.vo_no,
            po.po_number, po.id as purchase_order_id, pi.item_code, pi.qty
       from scm.reno_po_line_flags f
       join scm.reno_variation_orders v on v.id = f.vo_id
       join scm.purchase_order_items pi on pi.id = f.purchase_order_item_id
       join scm.purchase_orders po on po.id = pi.purchase_order_id
      where v.so_doc_no = $1 order by f.created_at`,
    [soDocNo],
  );
  return rows.map((r) => ({ id: r.id, action: r.action, newQty: r.new_qty === null ? null : Number(r.new_qty), status: r.status, note: r.note,
    createdAt: r.created_at, resolvedAt: r.resolved_at, voNo: r.vo_no, poNumber: r.po_number, purchaseOrderId: r.purchase_order_id, itemCode: r.item_code, qty: Number(r.qty) }));
}

export async function resolvePoFlag(db: RenoDb, actor: RenoActor, flagId: string): Promise<void> {
  const [r] = await db.q(
    `update scm.reno_po_line_flags set status = 'RESOLVED', resolved_at = now(), resolved_by = $3 where id = $1 and company_id = $2 and status = 'OPEN' returning id`,
    [flagId, actor.companyId, actor.name],
  );
  if (!r) throw refuse(404, 'flag_not_found', 'That flag is not open.');
}
