// ----------------------------------------------------------------------------
// /api/scm/renovation — renovation sales documents (Conts, phase 2, 2026-10-09).
//
// Quotations (revisions, package templates, convert), the renovation sales
// order (contract), SO -> PO split, progress billing, variation orders, PO
// payment schedules, payment-term templates and brand letterheads.
//
// Reads need Sales Orders view (area guard in scm/index.ts). Writes need one of
// scm.renovation.quote | vo.apply | bill | terms | po_split. Every multi-row
// write is one PostgreSQL transaction (lib/renovation-db.ts); revenue and
// credit-note journals post after commit and never fail the bill.
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import { hasHouzsPerm } from '../lib/houzs-perms';
import { activeCompanyId, companyDocPrefix } from '../lib/companyScope';
import type { Env, Variables } from '../env';
import { inRenoTx, renoDbOf, RenoError, sqlFor, type RenoDb } from '../lib/renovation-db';
import {
  createQuotation, createTemplate, getQuotation, getTemplate, listQuotations, listTemplates, newRevision, saveRevision, saveTemplate,
  setQuotationStatus, type QuotationStatus, type RenoActor,
} from '../lib/renovation-quotation';
import { convertQuotationToSo, patchContract, readContract, setContractStatus, type RenoSoStatus } from '../lib/renovation-so';
import { previewPoSplit, raisePos } from '../lib/renovation-po-split';
import { billingView, billInstalment } from '../lib/renovation-billing';
import { applyVo, createVo, listPoFlags, readVo, resolvePoFlag, saveVo, setVoStatus } from '../lib/renovation-vo';
import { applyDefaultPoSchedule, readPoSchedule, recordPoPayment, releasePoInstalment, savePoSchedule } from '../lib/renovation-po-schedule';
import { listBrandProfiles, listTermTemplates, saveBrandProfile, saveTermTemplate } from '../lib/renovation-terms';
import { normaliseHeader, normaliseInstalments, normalisePoSchedule, normaliseSections, PRINT_FORMATS } from '../lib/renovation-validate';
import { onRenovationSoLinesChanged } from '../lib/renovation-hooks';
import { postSiRevenue } from '../lib/post-si-revenue';
import { CREDIT_NOTE_HEADER, postCreditNote } from '../../acc/credit-notes';
import { categoryGroupOf } from '../shared/renovation-catalog';

type C = Context<{ Bindings: Env; Variables: Variables }>;

export const renovation = new Hono<{ Bindings: Env; Variables: Variables }>();
renovation.use('*', supabaseAuth);

const PERM = {
  quote: 'scm.renovation.quote',
  voApply: 'scm.renovation.vo.apply',
  bill: 'scm.renovation.bill',
  terms: 'scm.renovation.terms',
  poSplit: 'scm.renovation.po_split',
} as const;

function actorOf(c: C): RenoActor {
  const hu = c.get('houzsUser');
  return {
    name: hu?.name ?? hu?.email ?? null,
    staffId: c.get('user').id,
    companyId: activeCompanyId(c) ?? 1,
    docPrefix: companyDocPrefix(c),
  };
}

const param = (c: C, name: string): string => {
  const v = c.req.param(name);
  if (!v) throw new RenoError(400, 'missing_param', `Missing ${name}.`);
  return v;
};

const json = async (c: C): Promise<Record<string, any>> => {
  try { return (await c.req.json()) ?? {}; } catch { throw new RenoError(400, 'invalid_json', 'The request body is not valid JSON.'); }
};

function need<T>(r: { ok: true; value: T } | { ok: false; problems: string[] }): T {
  if (!r.ok) throw new RenoError(422, 'invalid_document', r.problems.slice(0, 8).join(' '), { problems: r.problems });
  return r.value;
}

const intParam = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new RenoError(400, 'invalid_body', `${name} must be a whole number.`);
  return n;
};

/** Runs a handler with a DB connection; turns RenoError into JSON. */
function handle(perm: string | null, fn: (c: C, ctx: { sqlRead: RenoDb; tx: <T>(f: (db: RenoDb) => Promise<T>) => Promise<T> }) => Promise<Response>) {
  return async (c: C) => {
    if (perm && !hasHouzsPerm(c, perm)) return c.json({ error: 'forbidden', message: `You need the "${perm}" permission for this.` }, 403);
    const sql = sqlFor(c.env);
    if (!sql) return c.json({ error: 'database_unavailable', message: 'The database connection is not configured.' }, 503);
    try {
      return await fn(c, { sqlRead: renoDbOf(sql), tx: (f) => inRenoTx(sql, (db) => f(db)) });
    } catch (err) {
      if (err instanceof RenoError) return c.json({ error: err.code, message: err.message, ...(err.detail ?? {}) }, err.status);
      console.error('[renovation] request failed:', err);
      return c.json({ error: 'renovation_failed', message: 'Something went wrong; nothing was saved. Please try again.' }, 500);
    }
  };
}

/* ── Quotations ─────────────────────────────────────────────────────────── */

renovation.get('/quotations', handle(null, async (c, { sqlRead }) => {
  const projectId = c.req.query('projectId');
  const rows = await listQuotations(sqlRead, actorOf(c).companyId, {
    projectId: projectId ? intParam(projectId, 'projectId') : null,
    status: c.req.query('status') || null,
    q: c.req.query('q') || null,
  });
  return c.json({ quotations: rows });
}));

renovation.post('/quotations', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const header = need(normaliseHeader(b.header));
  const sections = b.sections !== undefined ? need(normaliseSections(b.sections)) : undefined;
  const instalments = b.instalments !== undefined ? need(normaliseInstalments(b.instalments)) : undefined;
  const out = await tx((db) => createQuotation(db, actorOf(c), {
    projectId: b.projectId == null || b.projectId === '' ? null : intParam(b.projectId, 'projectId'), brandId: b.brandId ?? header.brandId ?? null, templateId: b.templateId ?? null, header, sections, instalments,
  }));
  return c.json(out, 201);
}));

renovation.get('/quotations/:id', handle(null, async (c, { sqlRead }) => {
  const rev = c.req.query('rev');
  return c.json(await getQuotation(sqlRead, param(c, 'id'), actorOf(c).companyId, rev ? intParam(rev, 'rev') : undefined));
}));

renovation.put('/quotations/:id', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const body = {
    version: intParam(b.version, 'version'),
    header: b.header !== undefined ? need(normaliseHeader(b.header)) : undefined,
    sections: b.sections !== undefined ? need(normaliseSections(b.sections)) : undefined,
    instalments: b.instalments !== undefined ? need(normaliseInstalments(b.instalments)) : undefined,
  };
  return c.json(await tx((db) => saveRevision(db, actorOf(c), param(c, 'id'), body)));
}));

renovation.post('/quotations/:id/revisions', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => newRevision(db, actorOf(c), param(c, 'id'), intParam(b.version, 'version'))), 201);
}));

renovation.post('/quotations/:id/status', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const status = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']).safeParse(b.status);
  if (!status.success) throw new RenoError(400, 'invalid_status', 'Unknown quotation status.');
  return c.json(await tx((db) => setQuotationStatus(db, actorOf(c), param(c, 'id'), status.data as QuotationStatus, intParam(b.version, 'version'))));
}));

renovation.post('/quotations/:id/convert', handle(PERM.quote, async (c, { tx, sqlRead }) => {
  const b = await json(c);
  const out = await tx((db) => convertQuotationToSo(db, actorOf(c), param(c, 'id'), { version: intParam(b.version, 'version'), soDate: b.soDate ?? null }));
  await onRenovationSoLinesChanged(out.docNo, sqlRead);
  return c.json(out, 201);
}));

renovation.post('/quotations/:id/save-as-template', handle(PERM.quote, async (c, { tx, sqlRead }) => {
  const b = await json(c);
  const q = await getQuotation(sqlRead, param(c, 'id'), actorOf(c).companyId, b.revNo ? intParam(b.revNo, 'revNo') : undefined);
  return c.json(await tx((db) => createTemplate(db, actorOf(c), { name: String(b.name ?? ''), description: b.description, fromRevisionId: q.revision.id })), 201);
}));

/* ── Package templates ──────────────────────────────────────────────────── */

renovation.get('/templates', handle(null, async (c, { sqlRead }) =>
  c.json({ templates: await listTemplates(sqlRead, actorOf(c).companyId, c.req.query('all') === '1') })));

renovation.get('/templates/:id', handle(null, async (c, { sqlRead }) => c.json(await getTemplate(sqlRead, param(c, 'id'), actorOf(c).companyId))));

const templateFields = (b: Record<string, any>) => ({
  name: b.name, brandId: b.brandId, description: b.description, printFormat: b.printFormat && (PRINT_FORMATS as readonly string[]).includes(b.printFormat) ? b.printFormat : undefined,
  termTemplateId: b.termTemplateId, docDiscountSen: b.docDiscountSen, docDiscountLabel: b.docDiscountLabel, promoLines: b.promoLines, active: b.active,
  sections: b.sections !== undefined ? need(normaliseSections(b.sections)) : undefined,
  instalments: b.instalments !== undefined ? need(normaliseInstalments(b.instalments)) : undefined,
});

renovation.post('/templates', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => createTemplate(db, actorOf(c), templateFields(b))), 201);
}));

renovation.put('/templates/:id', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  await tx((db) => saveTemplate(db, actorOf(c), param(c, 'id'), templateFields(b)));
  return c.json({ ok: true });
}));

/* ── Payment terms and letterheads ──────────────────────────────────────── */

renovation.get('/terms', handle(null, async (c, { sqlRead }) => {
  const kind = c.req.query('kind');
  return c.json({ templates: await listTermTemplates(sqlRead, actorOf(c).companyId, kind === 'PO' || kind === 'CUSTOMER' ? kind : null) });
}));

renovation.post('/terms', handle(PERM.terms, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => saveTermTemplate(db, actorOf(c), null, b)), 201);
}));

renovation.put('/terms/:id', handle(PERM.terms, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => saveTermTemplate(db, actorOf(c), param(c, 'id'), b)));
}));

renovation.get('/brands', handle(null, async (c, { sqlRead }) => c.json({ brands: await listBrandProfiles(sqlRead, actorOf(c).companyId) })));

renovation.put('/brands/:brandId', handle(PERM.terms, async (c, { tx }) => {
  const b = await json(c);
  await tx((db) => saveBrandProfile(db, actorOf(c), intParam(param(c, 'brandId'), 'brandId'), b));
  return c.json({ ok: true });
}));

/* ── Lookups for the editors ────────────────────────────────────────────── */

renovation.get('/lookups/products', handle(null, async (c, { sqlRead }) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await sqlRead.q(
    `select p.code, p.name, p.category::text as category, to_jsonb(p) ->> 'sub_category' as sub_category, to_jsonb(p) ->> 'uom' as uom,
            p.cost_price_sen, coalesce(p.sell_price_sen, p.base_price_sen, p.price1_sen, 0) as sell_price_sen,
            b.supplier_id, s.name as supplier_name, b.unit_price_sen as binding_cost_sen
       from scm.mfg_products p
       left join lateral (select supplier_id, unit_price_sen from scm.supplier_material_bindings smb
                           where smb.item_code = p.code and smb.company_id = p.company_id
                           order by smb.is_main_supplier desc, smb.is_cost_anchor desc, smb.created_at limit 1) b on true
       left join scm.suppliers s on s.id = b.supplier_id
      where p.company_id = $1 and p.status = 'ACTIVE' and p.code not like 'RENO-%'
        and ($2 = '' or p.code ilike '%' || $2 || '%' or p.name ilike '%' || $2 || '%')
      order by (p.code ilike 'RN-%') desc, p.code
      limit 50`,
    [actorOf(c).companyId, q],
  );
  return c.json({
    products: rows.map((r) => ({
      code: r.code, name: r.name, category: r.category, group: categoryGroupOf(r.category), subCategory: r.sub_category, uom: r.uom,
      costSen: Number(r.binding_cost_sen ?? r.cost_price_sen ?? 0), sellPriceSen: Number(r.sell_price_sen ?? 0),
      supplierId: r.supplier_id, supplierName: r.supplier_name,
    })),
  });
}));

renovation.get('/lookups/projects', handle(null, async (c, { sqlRead }) => {
  const q = (c.req.query('q') ?? '').trim();
  const rows = await sqlRead.q(
    `select p.id, p.code, p.name, p.stage, p.status,
            (select o.doc_no from scm.mfg_sales_orders o where o.project_id = p.id and o.so_kind = 'RENOVATION' and o.status <> 'CANCELLED' limit 1) as contract_doc_no
       from public.projects p
      where p.archived_at is null and p.company_id = $2 and p.project_kind = 'renovation'
        and ($1 = '' or p.name ilike '%' || $1 || '%' or coalesce(p.code, '') ilike '%' || $1 || '%')
      order by p.id desc limit 50`,
    [q, actorOf(c).companyId],
  );
  return c.json({ projects: rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, stage: r.stage, status: r.status, contractDocNo: r.contract_doc_no })) });
}));

/* ── Renovation sales order (contract) ──────────────────────────────────── */

renovation.get('/sales-orders/:docNo', handle(null, async (c, { sqlRead }) => {
  const docNo = param(c, 'docNo');
  const companyId = actorOf(c).companyId;
  const contract = await readContract(sqlRead, docNo, companyId);
  return c.json({ ...contract, billing: await billingView(sqlRead, docNo, companyId) });
}));

renovation.patch('/sales-orders/:docNo', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const header = b.header !== undefined ? need(normaliseHeader(b.header)) : undefined;
  return c.json(await tx((db) => patchContract(db, actorOf(c), param(c, 'docNo'), {
    version: intParam(b.version, 'version'), header, sections: Array.isArray(b.sections) ? b.sections : undefined, lines: Array.isArray(b.lines) ? b.lines : undefined,
  })));
}));

renovation.post('/sales-orders/:docNo/status', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const s = z.enum(['RENO_CONFIRMED', 'RENO_IN_PROGRESS', 'RENO_COMPLETED', 'CLOSED', 'CANCELLED']).safeParse(b.status);
  if (!s.success) throw new RenoError(400, 'invalid_status', 'Unknown contract status.');
  return c.json(await tx((db) => setContractStatus(db, actorOf(c), param(c, 'docNo'), s.data as RenoSoStatus, typeof b.note === 'string' ? b.note : undefined)));
}));

renovation.get('/sales-orders/:docNo/po-split', handle(null, async (c, { sqlRead }) =>
  c.json(await previewPoSplit(sqlRead, param(c, 'docNo'), actorOf(c).companyId))));

renovation.post('/sales-orders/:docNo/po-split', handle(PERM.poSplit, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => raisePos(db, actorOf(c), param(c, 'docNo'), {
    supplierIds: Array.isArray(b.supplierIds) ? b.supplierIds.map(String) : null, poDate: b.poDate ?? null, expectedAt: b.expectedAt ?? null,
  })), 201);
}));

renovation.get('/sales-orders/:docNo/billing', handle(null, async (c, { sqlRead }) =>
  c.json(await billingView(sqlRead, param(c, 'docNo'), actorOf(c).companyId))));

renovation.post('/sales-orders/:docNo/instalments/:id/bill', handle(PERM.bill, async (c, { tx }) => {
  const b = await json(c);
  const actor = actorOf(c);
  const result = await tx((db) => billInstalment(db, actor, param(c, 'docNo'), param(c, 'id'), {
    invoiceDate: b.invoiceDate ?? null, expectedAmountSen: intParam(b.expectedAmountSen, 'expectedAmountSen'), confirmCreditNote: b.confirmCreditNote === true,
  }));
  // After commit: book the journal. A failure leaves the document unposted (the engine's own
  // confirm / resync paths post it later) and is reported, never thrown.
  let posting: { status: string; reason?: string } = { status: 'not_needed' };
  try {
    const sb = c.get('supabase');
    if (result.kind === 'INVOICE' && result.invoiceNumber) {
      const r = await postSiRevenue(sb, result.invoiceNumber);
      posting = { status: r.status, reason: 'reason' in r ? r.reason : undefined };
    } else if (result.kind === 'CREDIT_NOTE' && result.creditNoteId) {
      const { data: note, error } = await sb.from('acc_credit_notes').select(CREDIT_NOTE_HEADER).eq('id', result.creditNoteId).single();
      if (error || !note) posting = { status: 'load_failed', reason: error?.message };
      else {
        const r = await postCreditNote(sb, { companyId: actor.companyId, note: note as never, actor: actor.name });
        posting = { status: r.ok ? r.status : r.status, reason: r.ok ? undefined : r.reason };
      }
    }
  } catch (err) {
    posting = { status: 'post_failed', reason: err instanceof Error ? err.message : String(err) };
  }
  return c.json({ ...result, posting }, 201);
}));

/* ── Variation orders ───────────────────────────────────────────────────── */

renovation.post('/sales-orders/:docNo/variation-orders', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => createVo(db, actorOf(c), param(c, 'docNo'), { title: typeof b.title === 'string' ? b.title : '' })), 201);
}));

renovation.get('/variation-orders/:id', handle(null, async (c, { sqlRead }) => c.json(await readVo(sqlRead, param(c, 'id'), actorOf(c).companyId))));

renovation.put('/variation-orders/:id', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => saveVo(db, actorOf(c), param(c, 'id'), {
    version: intParam(b.version, 'version'), title: typeof b.title === 'string' ? b.title : undefined, docDate: b.docDate ?? undefined,
    sections: b.sections !== undefined ? need(normaliseSections(b.sections, 'vo')) : undefined,
  })));
}));

renovation.post('/variation-orders/:id/status', handle(PERM.quote, async (c, { tx }) => {
  const b = await json(c);
  const s = z.enum(['DRAFT', 'SENT', 'CANCELLED']).safeParse(b.status);
  if (!s.success) throw new RenoError(400, 'invalid_status', 'Use the approve action to approve a variation order.');
  return c.json(await tx((db) => setVoStatus(db, actorOf(c), param(c, 'id'), s.data, intParam(b.version, 'version'))));
}));

renovation.post('/variation-orders/:id/approve', handle(PERM.voApply, async (c, { tx, sqlRead }) => {
  const b = await json(c);
  const out = await tx((db) => applyVo(db, actorOf(c), param(c, 'id'), {
    version: intParam(b.version, 'version'), signedName: typeof b.signedName === 'string' ? b.signedName : null, signedAt: b.signedAt ?? null,
  }));
  await onRenovationSoLinesChanged(out.soDocNo, sqlRead);
  return c.json(out);
}));

renovation.get('/sales-orders/:docNo/po-flags', handle(null, async (c, { sqlRead }) => c.json({ flags: await listPoFlags(sqlRead, param(c, 'docNo')) })));

renovation.post('/po-flags/:id/resolve', handle(PERM.poSplit, async (c, { tx }) => {
  await tx((db) => resolvePoFlag(db, actorOf(c), param(c, 'id')));
  return c.json({ ok: true });
}));

/* ── PO payment schedule ────────────────────────────────────────────────── */

renovation.get('/purchase-orders/:poId/schedule', handle(null, async (c, { sqlRead }) =>
  c.json(await readPoSchedule(sqlRead, param(c, 'poId'), actorOf(c).companyId))));

renovation.put('/purchase-orders/:poId/schedule', handle(PERM.poSplit, async (c, { tx }) => {
  const b = await json(c);
  const rows = need(normalisePoSchedule(b.instalments));
  await tx((db) => savePoSchedule(db, actorOf(c), param(c, 'poId'), rows));
  return c.json({ ok: true });
}));

renovation.post('/purchase-orders/:poId/schedule/default', handle(PERM.poSplit, async (c, { tx }) => {
  await tx((db) => applyDefaultPoSchedule(db, actorOf(c), param(c, 'poId')));
  return c.json({ ok: true }, 201);
}));

renovation.post('/po-instalments/:id/release', handle(PERM.bill, async (c, { tx }) => {
  const b = await json(c);
  await tx((db) => releasePoInstalment(db, actorOf(c), param(c, 'id'), String(b.note ?? '')));
  return c.json({ ok: true });
}));

renovation.post('/po-instalments/:id/payments', handle(PERM.bill, async (c, { tx }) => {
  const b = await json(c);
  return c.json(await tx((db) => recordPoPayment(db, actorOf(c), param(c, 'id'), {
    amountSen: intParam(b.amountSen, 'amountSen'), paidOn: b.paidOn ?? null, paymentVoucherId: b.paymentVoucherId ?? null, note: typeof b.note === 'string' ? b.note : '',
  })), 201);
}));
