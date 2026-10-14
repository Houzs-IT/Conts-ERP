/* Renovation quotations: create (blank or from a package template), revise
   (R2, R3 ... older revisions frozen), status, list, and package templates.
   Conversion to the sales order lives in renovation-so.ts. */

import { auditEntity, mintDocNo, refuse, todayKl, yymmOf, type RenoDb } from './renovation-db';
import {
  cloneSections, deleteStructure, insertInstalments, insertSections, readInstalments, readSections, readSectionsMany, totalsOf, type DocSectionOut,
} from './renovation-doc-lines';
import type { DocHeaderInput, NormInstalment, NormSection, PrintFormat } from './renovation-validate';
import {
  EMPTY_QUOTE_PROPERTY, fillBlanksFromProject, quotePropertyReady, readProjectParty, readRevisionProperty, writeRevisionProperty, type QuoteProperty,
} from './renovation-doc-flow';

export interface RenoActor {
  name: string | null;
  /** scm.staff id stamped on engine documents (created_by). */
  staffId: string;
  companyId: number;
  /** The company's document prefix, e.g. "HC-" (companyDocPrefix). */
  docPrefix: string;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

const NEXT_STATUS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ['SENT', 'REJECTED', 'EXPIRED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'DRAFT'],
  ACCEPTED: ['SENT'],
  REJECTED: [],
  EXPIRED: [],
};

export function quotationTransitionAllowed(from: QuotationStatus, to: QuotationStatus): boolean {
  return NEXT_STATUS[from]?.includes(to) ?? false;
}

export function revisionDocNo(quoteNo: string, revNo: number): string {
  return revNo <= 1 ? quoteNo : `${quoteNo}-R${revNo}`;
}

/* The customer + property block (siteAddress, propertyType, layoutLabel, bedrooms, bathrooms, builtUpSqft) is
   read and written by renovation-doc-flow.ts once migration 0116 is in. */
export interface RevisionHeader extends QuoteProperty {
  printFormat: PrintFormat;
  attention: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  building: string;
  unitNo: string;
  preparedBy: string;
  docDate: string;
  lastAmended: string | null;
  validUntil: string | null;
  intro: string | null;
  termsNote: string;
  termTemplateId: string | null;
  docDiscountSen: number;
  docDiscountLabel: string;
  promoLines: Array<{ text: string; color?: string | null }>;
}

const REV_COLS = `id, quotation_id, rev_no, doc_no, print_format, attention, customer_name, customer_phone, customer_email, building, unit_no,
  prepared_by, doc_date::text as doc_date, last_amended::text as last_amended, valid_until::text as valid_until, intro, terms_note,
  term_template_id, doc_discount_sen, doc_discount_label, promo_lines, frozen_at::text as frozen_at`;

interface RevRow {
  id: string; quotation_id: string; rev_no: number; doc_no: string; print_format: PrintFormat; attention: string; customer_name: string;
  customer_phone: string; customer_email: string; building: string; unit_no: string; prepared_by: string; doc_date: string;
  last_amended: string | null; valid_until: string | null; intro: string | null; terms_note: string; term_template_id: string | null;
  doc_discount_sen: number; doc_discount_label: string; promo_lines: unknown; frozen_at: string | null;
}

function headerOf(r: RevRow): RevisionHeader {
  return {
    printFormat: r.print_format,
    attention: r.attention,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    building: r.building,
    unitNo: r.unit_no,
    preparedBy: r.prepared_by,
    docDate: r.doc_date,
    lastAmended: r.last_amended,
    validUntil: r.valid_until,
    intro: r.intro,
    termsNote: r.terms_note,
    termTemplateId: r.term_template_id,
    docDiscountSen: Number(r.doc_discount_sen),
    docDiscountLabel: r.doc_discount_label,
    promoLines: Array.isArray(r.promo_lines) ? (r.promo_lines as RevisionHeader['promoLines']) : [],
    ...EMPTY_QUOTE_PROPERTY,
  };
}

export function mergeHeader(base: Partial<RevisionHeader>, patch: DocHeaderInput | undefined): RevisionHeader {
  const h: RevisionHeader = {
    printFormat: 'AMOUNT', attention: '', customerName: '', customerPhone: '', customerEmail: '', building: '', unitNo: '',
    preparedBy: '', docDate: todayKl(), lastAmended: null, validUntil: null, intro: null, termsNote: '', termTemplateId: null,
    docDiscountSen: 0, docDiscountLabel: '', promoLines: [], ...EMPTY_QUOTE_PROPERTY,
    ...base,
  };
  if (!patch) return h;
  for (const k of Object.keys(patch) as Array<keyof DocHeaderInput>) {
    if (k === 'brandId') continue;
    const v = patch[k];
    if (v !== undefined) (h as unknown as Record<string, unknown>)[k] = v;
  }
  return h;
}

/** Instalments copied from a customer payment-term template (or the default one). */
export async function instalmentsFromTerms(db: RenoDb, companyId: number, termTemplateId: string | null): Promise<{ templateId: string | null; rows: NormInstalment[] }> {
  const tpl = termTemplateId
    ? await db.q<{ id: string }>(`select id from scm.reno_term_templates where id = $1 and kind = 'CUSTOMER' and company_id = $2`, [termTemplateId, companyId])
    : await db.q<{ id: string }>(`select id from scm.reno_term_templates where kind = 'CUSTOMER' and company_id = $1 and is_default and active`, [companyId]);
  if (termTemplateId && tpl.length === 0) throw refuse(404, 'term_template_not_found', 'That payment-term template does not exist.');
  if (tpl.length === 0) return { templateId: null, rows: [] };
  const rows = await db.q<{ seq: number; label: string; pct_bp: number; description: string; stage_code: string | null; trigger: NormInstalment['trigger'] }>(
    `select seq, label, pct_bp, description, stage_code, trigger from scm.reno_term_template_lines where template_id = $1 order by seq`,
    [tpl[0].id],
  );
  return {
    templateId: tpl[0].id,
    rows: rows.map((r) => ({ seq: Number(r.seq), label: r.label, pctBp: Number(r.pct_bp), description: r.description, stageCode: r.stage_code, trigger: r.trigger })),
  };
}

async function writeRevisionHeader(db: RenoDb, revisionId: string, h: RevisionHeader): Promise<void> {
  await db.q(
    `update scm.reno_quotation_revisions set print_format = $2, attention = $3, customer_name = $4, customer_phone = $5, customer_email = $6,
        building = $7, unit_no = $8, prepared_by = $9, doc_date = $10::date, last_amended = $11::date, valid_until = $12::date, intro = $13,
        terms_note = $14, term_template_id = $15, doc_discount_sen = $16, doc_discount_label = $17, promo_lines = $18::text::jsonb, updated_at = now()
      where id = $1`,
    [revisionId, h.printFormat, h.attention, h.customerName, h.customerPhone, h.customerEmail, h.building, h.unitNo, h.preparedBy, h.docDate,
      h.lastAmended, h.validUntil, h.intro, h.termsNote, h.termTemplateId, h.docDiscountSen, h.docDiscountLabel, JSON.stringify(h.promoLines)],
  );
  await writeRevisionProperty(db, revisionId, h);
}

export async function projectExists(db: RenoDb, projectId: number, companyId?: number): Promise<boolean> {
  const rows = await db.q(`select 1 from public.projects where id = $1 and ($2::bigint is null or company_id = $2)`, [projectId, companyId ?? null]);
  return rows.length > 0;
}

export async function createQuotation(
  db: RenoDb,
  actor: RenoActor,
  body: { projectId: number | null; brandId?: number | null; templateId?: string | null; header?: DocHeaderInput; sections?: NormSection[]; instalments?: NormInstalment[] },
): Promise<{ id: string; quoteNo: string; revisionId: string }> {
  /* A quotation may come before its project (owner 11 Oct 2026): projectId null links later. */
  if (body.projectId != null && !(await projectExists(db, body.projectId, actor.companyId))) throw refuse(404, 'project_not_found', `Project ${body.projectId} does not exist.`);
  let base: Partial<RevisionHeader> = {};
  let sections: NormSection[] = body.sections ?? [];
  let instalments: NormInstalment[] | null = body.instalments && body.instalments.length ? body.instalments : null;
  let brandId = body.brandId ?? null;
  if (body.templateId) {
    const [t] = await db.q<{ id: string; brand_id: number | null; print_format: PrintFormat; term_template_id: string | null; doc_discount_sen: number; doc_discount_label: string; promo_lines: unknown; active: boolean }>(
      `select id, brand_id, print_format, term_template_id, doc_discount_sen, doc_discount_label, promo_lines, active
         from scm.reno_quotation_templates where id = $1 and company_id = $2`,
      [body.templateId, actor.companyId],
    );
    if (!t) throw refuse(404, 'template_not_found', 'That package template does not exist.');
    base = {
      printFormat: t.print_format, termTemplateId: t.term_template_id, docDiscountSen: Number(t.doc_discount_sen),
      docDiscountLabel: t.doc_discount_label, promoLines: Array.isArray(t.promo_lines) ? (t.promo_lines as RevisionHeader['promoLines']) : [],
    };
    brandId = brandId ?? (t.brand_id === null ? null : Number(t.brand_id));
    if (!body.sections?.length) sections = cloneSections(await readSections(db, { kind: 'template', id: t.id }));
    if (!instalments) {
      const own = await readInstalments(db, { kind: 'template', id: t.id });
      if (own.length) instalments = own.map(({ id: _id, ...r }) => r);
    }
  }
  /* A quotation for a project starts from the project's customer and property where the form left them blank. */
  const header = fillBlanksFromProject(mergeHeader(base, body.header), await readProjectParty(db, body.projectId, actor.companyId));
  if (!instalments) {
    const terms = await instalmentsFromTerms(db, actor.companyId, header.termTemplateId);
    instalments = terms.rows;
    header.termTemplateId = terms.templateId;
  }
  const quoteNo = await mintDocNo(db, 'reno_quotations', 'quote_no', `QT-${yymmOf(header.docDate)}`);
  const [q] = await db.q<{ id: string }>(
    `insert into scm.reno_quotations (company_id, quote_no, project_id, brand_id, template_id, created_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [actor.companyId, quoteNo, body.projectId, brandId, body.templateId ?? null, actor.name],
  );
  const [rev] = await db.q<{ id: string }>(
    `insert into scm.reno_quotation_revisions (company_id, quotation_id, rev_no, doc_no, created_by) values ($1, $2, 1, $3, $4) returning id`,
    [actor.companyId, q.id, quoteNo, actor.name],
  );
  await writeRevisionHeader(db, rev.id, header);
  await insertSections(db, { kind: 'revision', id: rev.id }, sections, actor.companyId);
  await insertInstalments(db, { kind: 'revision', id: rev.id }, instalments, actor.companyId);
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation', entityId: q.id, docNo: quoteNo, action: 'CREATE', actorName: actor.name, note: body.templateId ? 'from package template' : undefined });
  return { id: q.id, quoteNo, revisionId: rev.id };
}

export interface QuotationHead {
  id: string; quoteNo: string; projectId: number | null; brandId: number | null; status: QuotationStatus; currentRev: number;
  acceptedRev: number | null; convertedSoDocNo: string | null; lockedAt: string | null; templateId: string | null; version: number;
  createdAt: string; projectName?: string | null;
}

const Q_COLS = `q.id, q.quote_no, q.project_id, q.brand_id, q.status, q.current_rev, q.accepted_rev, q.converted_so_doc_no, q.locked_at::text as locked_at,
  q.template_id, q.version, q.created_at::text as created_at`;

function headOf(r: Record<string, any>): QuotationHead {
  return {
    id: r.id, quoteNo: r.quote_no, projectId: r.project_id == null ? null : Number(r.project_id), brandId: r.brand_id === null ? null : Number(r.brand_id), status: r.status,
    currentRev: Number(r.current_rev), acceptedRev: r.accepted_rev === null ? null : Number(r.accepted_rev), convertedSoDocNo: r.converted_so_doc_no,
    lockedAt: r.locked_at, templateId: r.template_id, version: Number(r.version), createdAt: r.created_at, projectName: r.project_name ?? null,
  };
}

export async function lockQuotation(db: RenoDb, id: string, companyId: number): Promise<QuotationHead> {
  const [r] = await db.q(`select ${Q_COLS} from scm.reno_quotations q where q.id = $1 and q.company_id = $2 for update`, [id, companyId]);
  if (!r) throw refuse(404, 'quotation_not_found', 'That quotation does not exist.');
  return headOf(r);
}

export async function readRevision(db: RenoDb, revisionId: string) {
  const [r] = await db.q<RevRow>(`select ${REV_COLS} from scm.reno_quotation_revisions where id = $1`, [revisionId]);
  if (!r) throw refuse(404, 'revision_not_found', 'That revision does not exist.');
  const header: RevisionHeader = { ...headerOf(r), ...(await readRevisionProperty(db, r.id)) };
  const sections = await readSections(db, { kind: 'revision', id: r.id });
  const instalments = await readInstalments(db, { kind: 'revision', id: r.id });
  return {
    id: r.id, revNo: Number(r.rev_no), docNo: r.doc_no, frozenAt: r.frozen_at, header, sections, instalments,
    totals: totalsOf(sections, header.docDiscountSen),
  };
}

async function revisionId(db: RenoDb, quotationId: string, revNo: number): Promise<string> {
  const [r] = await db.q<{ id: string }>(`select id from scm.reno_quotation_revisions where quotation_id = $1 and rev_no = $2`, [quotationId, revNo]);
  if (!r) throw refuse(404, 'revision_not_found', `Revision R${revNo} does not exist.`);
  return r.id;
}

export async function getQuotation(db: RenoDb, id: string, companyId: number, revNo?: number) {
  const [r] = await db.q(
    `select ${Q_COLS}, p.name as project_name from scm.reno_quotations q left join public.projects p on p.id = q.project_id
      where q.id = $1 and q.company_id = $2`,
    [id, companyId],
  );
  if (!r) throw refuse(404, 'quotation_not_found', 'That quotation does not exist.');
  const head = headOf(r);
  const revisions = await db.q<{ rev_no: number; doc_no: string; frozen_at: string | null; created_at: string }>(
    `select rev_no, doc_no, frozen_at::text as frozen_at, created_at::text as created_at from scm.reno_quotation_revisions where quotation_id = $1 order by rev_no`,
    [id],
  );
  const revision = await readRevision(db, await revisionId(db, id, revNo ?? head.currentRev));
  return {
    quotation: head,
    revisions: revisions.map((x) => ({ revNo: Number(x.rev_no), docNo: x.doc_no, frozenAt: x.frozen_at, createdAt: x.created_at })),
    revision,
    editable: head.status === 'DRAFT' && !head.lockedAt && revision.revNo === head.currentRev,
    propertyReady: await quotePropertyReady(db),
  };
}

export async function saveRevision(
  db: RenoDb,
  actor: RenoActor,
  id: string,
  body: { version: number; header?: DocHeaderInput; sections?: NormSection[]; instalments?: NormInstalment[] },
): Promise<{ version: number }> {
  const q = await lockQuotation(db, id, actor.companyId);
  if (q.version !== body.version) throw refuse(409, 'stale_version', 'Someone else saved this quotation first. Reload to see their changes.', { version: q.version });
  if (q.lockedAt) throw refuse(409, 'quotation_locked', 'This quotation has been converted to a sales order and is locked.');
  if (q.status !== 'DRAFT') throw refuse(409, 'not_editable', 'Only a draft can be edited. Start a new revision to change a sent quotation.');
  const revId = await revisionId(db, id, q.currentRev);
  const current = await readRevision(db, revId);
  if (current.frozenAt) throw refuse(409, 'revision_frozen', 'This revision is frozen.');
  const header = mergeHeader(current.header, body.header);
  await writeRevisionHeader(db, revId, header);
  if (body.header?.brandId !== undefined) await db.q(`update scm.reno_quotations set brand_id = $2 where id = $1`, [id, body.header.brandId]);
  if (body.sections) {
    await deleteStructure(db, { kind: 'revision', id: revId }, { instalments: false });
    await insertSections(db, { kind: 'revision', id: revId }, body.sections, actor.companyId);
  }
  if (body.instalments) {
    await db.q(`delete from scm.reno_doc_instalments where revision_id = $1`, [revId]);
    await insertInstalments(db, { kind: 'revision', id: revId }, body.instalments, actor.companyId);
  }
  const [v] = await db.q<{ version: number }>(`update scm.reno_quotations set version = version + 1, updated_at = now() where id = $1 returning version`, [id]);
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation', entityId: id, docNo: current.docNo, action: 'UPDATE', actorName: actor.name });
  return { version: Number(v.version) };
}

export async function newRevision(db: RenoDb, actor: RenoActor, id: string, version: number): Promise<{ revNo: number; docNo: string; version: number }> {
  const q = await lockQuotation(db, id, actor.companyId);
  if (q.version !== version) throw refuse(409, 'stale_version', 'Someone else saved this quotation first. Reload to see their changes.', { version: q.version });
  if (q.lockedAt || q.convertedSoDocNo) throw refuse(409, 'quotation_locked', 'This quotation has been converted to a sales order and is locked.');
  if (q.status === 'ACCEPTED') throw refuse(409, 'quotation_accepted', 'An accepted quotation cannot be revised. Set it back to Sent first.');
  const cur = await readRevision(db, await revisionId(db, id, q.currentRev));
  const revNo = q.currentRev + 1;
  const docNo = revisionDocNo(q.quoteNo, revNo);
  await db.q(`update scm.reno_quotation_revisions set frozen_at = now() where id = $1`, [cur.id]);
  const [rev] = await db.q<{ id: string }>(
    `insert into scm.reno_quotation_revisions (company_id, quotation_id, rev_no, doc_no, created_by) values ($1, $2, $3, $4, $5) returning id`,
    [actor.companyId, id, revNo, docNo, actor.name],
  );
  await writeRevisionHeader(db, rev.id, { ...cur.header, lastAmended: todayKl() });
  await insertSections(db, { kind: 'revision', id: rev.id }, cloneSections(cur.sections), actor.companyId);
  await insertInstalments(db, { kind: 'revision', id: rev.id }, cur.instalments.map(({ id: _id, ...r }) => r), actor.companyId);
  const [v] = await db.q<{ version: number }>(
    `update scm.reno_quotations set current_rev = $2, status = 'DRAFT', version = version + 1, updated_at = now() where id = $1 returning version`,
    [id, revNo],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation', entityId: id, docNo, action: 'NEW_REVISION', actorName: actor.name });
  return { revNo, docNo, version: Number(v.version) };
}

export async function setQuotationStatus(db: RenoDb, actor: RenoActor, id: string, to: QuotationStatus, version: number): Promise<{ status: QuotationStatus; version: number }> {
  const q = await lockQuotation(db, id, actor.companyId);
  if (q.version !== version) throw refuse(409, 'stale_version', 'Someone else saved this quotation first. Reload to see their changes.', { version: q.version });
  if (q.lockedAt) throw refuse(409, 'quotation_locked', 'This quotation has been converted to a sales order and is locked.');
  if (!quotationTransitionAllowed(q.status, to)) throw refuse(409, 'bad_transition', `A ${q.status.toLowerCase()} quotation cannot become ${to.toLowerCase()}.`);
  const [v] = await db.q<{ version: number }>(
    `update scm.reno_quotations set status = $2, accepted_rev = case when $2 = 'ACCEPTED' then current_rev else null end,
        version = version + 1, updated_at = now() where id = $1 returning version`,
    [id, to],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation', entityId: id, docNo: q.quoteNo, action: 'STATUS', actorName: actor.name, changes: [{ field: 'status', from: q.status, to }] });
  return { status: to, version: Number(v.version) };
}

export async function listQuotations(db: RenoDb, companyId: number, f: { projectId?: number | null; status?: string | null; q?: string | null; limit?: number }) {
  const rows = await db.q(
    `select ${Q_COLS}, p.name as project_name, r.id as revision_id, r.doc_no, r.customer_name, r.building, r.unit_no, r.doc_date::text as doc_date,
            r.doc_discount_sen, r.print_format
       from scm.reno_quotations q
       join scm.reno_quotation_revisions r on r.quotation_id = q.id and r.rev_no = q.current_rev
       left join public.projects p on p.id = q.project_id
      where q.company_id = $1
        and ($2::bigint is null or q.project_id = $2)
        and ($3::text is null or q.status = $3)
        and ($4::text is null or q.quote_no ilike '%' || $4 || '%' or r.customer_name ilike '%' || $4 || '%' or r.building ilike '%' || $4 || '%')
      order by q.created_at desc
      limit $5`,
    [companyId, f.projectId ?? null, f.status ?? null, f.q ?? null, Math.min(f.limit ?? 200, 500)],
  );
  const structures = await readSectionsMany(db, 'revision', rows.map((r) => String(r.revision_id)));
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.revision_id, totalsOf(structures.get(r.revision_id) ?? [], Number(r.doc_discount_sen)).finalSen);
  return rows.map((r) => ({
    ...headOf(r), docNo: r.doc_no, customerName: r.customer_name, building: r.building, unitNo: r.unit_no, docDate: r.doc_date,
    printFormat: r.print_format, totalSen: totals.get(r.revision_id) ?? 0,
  }));
}

/* ── Package templates ───────────────────────────────────────────────────── */

export async function listTemplates(db: RenoDb, companyId: number, includeArchived = false) {
  const rows = await db.q(
    `select id, name, brand_id, description, print_format, active, updated_at::text as updated_at
       from scm.reno_quotation_templates where company_id = $1 and ($2 or active) order by name`,
    [companyId, includeArchived],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, brandId: r.brand_id === null ? null : Number(r.brand_id), description: r.description, printFormat: r.print_format, active: r.active, updatedAt: r.updated_at }));
}

export async function getTemplate(db: RenoDb, id: string, companyId: number) {
  const [t] = await db.q(
    `select id, name, brand_id, description, print_format, term_template_id, doc_discount_sen, doc_discount_label, promo_lines, active
       from scm.reno_quotation_templates where id = $1 and company_id = $2`,
    [id, companyId],
  );
  if (!t) throw refuse(404, 'template_not_found', 'That package template does not exist.');
  const sections = await readSections(db, { kind: 'template', id });
  return {
    id: t.id, name: t.name, brandId: t.brand_id === null ? null : Number(t.brand_id), description: t.description, printFormat: t.print_format,
    termTemplateId: t.term_template_id, docDiscountSen: Number(t.doc_discount_sen), docDiscountLabel: t.doc_discount_label,
    promoLines: Array.isArray(t.promo_lines) ? t.promo_lines : [], active: t.active,
    sections, instalments: await readInstalments(db, { kind: 'template', id }), totals: totalsOf(sections, Number(t.doc_discount_sen)),
  };
}

export interface TemplateBody {
  name?: string; brandId?: number | null; description?: string; printFormat?: PrintFormat; termTemplateId?: string | null;
  docDiscountSen?: number; docDiscountLabel?: string; promoLines?: Array<{ text: string; color?: string | null }>; active?: boolean;
  sections?: NormSection[]; instalments?: NormInstalment[];
}

async function templateNameTaken(db: RenoDb, companyId: number, name: string, exceptId: string | null): Promise<boolean> {
  const r = await db.q(`select 1 from scm.reno_quotation_templates where company_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`, [companyId, name, exceptId]);
  return r.length > 0;
}

export async function createTemplate(db: RenoDb, actor: RenoActor, body: TemplateBody & { fromRevisionId?: string | null }): Promise<{ id: string }> {
  const name = (body.name ?? '').trim();
  if (!name) throw refuse(400, 'name_required', 'A package template needs a name.');
  if (await templateNameTaken(db, actor.companyId, name, null)) throw refuse(409, 'name_taken', `A package template called "${name}" already exists.`);
  let sections: NormSection[] = body.sections ?? [];
  let instalments: NormInstalment[] = body.instalments ?? [];
  let base: Partial<TemplateBody> = {};
  if (body.fromRevisionId) {
    const rev = await readRevision(db, body.fromRevisionId);
    sections = cloneSections(rev.sections);
    instalments = rev.instalments.map(({ id: _id, ...r }) => r);
    const [qr] = await db.q<{ brand_id: number | null }>(`select q.brand_id from scm.reno_quotations q join scm.reno_quotation_revisions r on r.quotation_id = q.id where r.id = $1`, [body.fromRevisionId]);
    base = { printFormat: rev.header.printFormat, termTemplateId: rev.header.termTemplateId, docDiscountSen: rev.header.docDiscountSen,
      docDiscountLabel: rev.header.docDiscountLabel, promoLines: rev.header.promoLines, brandId: qr?.brand_id ?? null };
  }
  const b = { ...base, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as TemplateBody;
  const [t] = await db.q<{ id: string }>(
    `insert into scm.reno_quotation_templates (company_id, name, brand_id, description, print_format, term_template_id, doc_discount_sen, doc_discount_label, promo_lines, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10) returning id`,
    [actor.companyId, name, b.brandId ?? null, b.description ?? '', b.printFormat ?? 'AMOUNT', b.termTemplateId ?? null, b.docDiscountSen ?? 0,
      b.docDiscountLabel ?? '', JSON.stringify(b.promoLines ?? []), actor.name],
  );
  await insertSections(db, { kind: 'template', id: t.id }, sections, actor.companyId);
  await insertInstalments(db, { kind: 'template', id: t.id }, instalments, actor.companyId);
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation_template', entityId: t.id, docNo: name, action: 'CREATE', actorName: actor.name });
  return { id: t.id };
}

export async function saveTemplate(db: RenoDb, actor: RenoActor, id: string, body: TemplateBody): Promise<void> {
  const [cur] = await db.q(`select id, name from scm.reno_quotation_templates where id = $1 and company_id = $2 for update`, [id, actor.companyId]);
  if (!cur) throw refuse(404, 'template_not_found', 'That package template does not exist.');
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw refuse(400, 'name_required', 'A package template needs a name.');
    if (await templateNameTaken(db, actor.companyId, name, id)) throw refuse(409, 'name_taken', `A package template called "${name}" already exists.`);
  }
  await db.q(
    `update scm.reno_quotation_templates set
        name = coalesce($2, name), brand_id = case when $3::boolean then $4 else brand_id end, description = coalesce($5, description),
        print_format = coalesce($6, print_format), term_template_id = case when $7::boolean then $8::uuid else term_template_id end,
        doc_discount_sen = coalesce($9, doc_discount_sen), doc_discount_label = coalesce($10, doc_discount_label),
        promo_lines = coalesce($11::text::jsonb, promo_lines), active = coalesce($12, active), updated_at = now()
      where id = $1`,
    [id, body.name?.trim() ?? null, body.brandId !== undefined, body.brandId ?? null, body.description ?? null, body.printFormat ?? null,
      body.termTemplateId !== undefined, body.termTemplateId ?? null, body.docDiscountSen ?? null, body.docDiscountLabel ?? null,
      body.promoLines ? JSON.stringify(body.promoLines) : null, body.active ?? null],
  );
  if (body.sections) {
    await deleteStructure(db, { kind: 'template', id }, { instalments: false });
    await insertSections(db, { kind: 'template', id }, body.sections, actor.companyId);
  }
  if (body.instalments) {
    await db.q(`delete from scm.reno_doc_instalments where template_id = $1`, [id]);
    await insertInstalments(db, { kind: 'template', id }, body.instalments, actor.companyId);
  }
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_quotation_template', entityId: id, docNo: cur.name, action: 'UPDATE', actorName: actor.name });
}

export type { DocSectionOut };
