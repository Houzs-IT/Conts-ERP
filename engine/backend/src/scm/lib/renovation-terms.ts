/* Payment-term templates (customer and PO) and brand letterhead profiles. */

import { z } from 'zod';
import { auditEntity, refuse, type RenoDb } from './renovation-db';
import type { RenoActor } from './renovation-quotation';
import { INSTALMENT_TRIGGERS, PO_PAYABLE_ON } from './renovation-validate';
import { instalmentPctError } from '../shared/renovation-money';
import { isStageKey } from '../shared/renovation-stages';

export async function listTermTemplates(db: RenoDb, companyId: number, kind?: 'CUSTOMER' | 'PO' | null) {
  const tpls = await db.q(
    `select id, kind, name, is_default, active from scm.reno_term_templates where company_id = $1 and ($2::text is null or kind = $2) order by kind, name`,
    [companyId, kind ?? null],
  );
  const lines = await db.q(
    `select l.template_id, l.seq, l.label, l.pct_bp, l.description, l.stage_code, l.trigger, l.payable_on
       from scm.reno_term_template_lines l join scm.reno_term_templates t on t.id = l.template_id
      where t.company_id = $1 order by l.seq`,
    [companyId],
  );
  return tpls.map((t) => ({
    id: t.id as string, kind: t.kind as 'CUSTOMER' | 'PO', name: t.name as string, isDefault: t.is_default as boolean, active: t.active as boolean,
    lines: lines.filter((l) => l.template_id === t.id).map((l) => ({
      seq: Number(l.seq), label: l.label as string, pctBp: Number(l.pct_bp), description: l.description as string,
      stageCode: l.stage_code as string | null, trigger: l.trigger as string, payableOn: l.payable_on as string | null,
    })),
  }));
}

const termBody = z.object({
  kind: z.enum(['CUSTOMER', 'PO']),
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  lines: z.array(z.object({
    seq: z.number().int().min(1).max(20),
    label: z.string().max(100),
    pctBp: z.number().int().min(1).max(10000),
    description: z.string().max(1000).optional().default(''),
    stageCode: z.string().nullable().optional(),
    trigger: z.enum(INSTALMENT_TRIGGERS).optional().default('stage_start'),
    payableOn: z.enum(PO_PAYABLE_ON).nullable().optional(),
  })).min(1).max(20),
});

export async function saveTermTemplate(db: RenoDb, actor: RenoActor, id: string | null, input: unknown): Promise<{ id: string }> {
  const parsed = termBody.safeParse(input);
  if (!parsed.success) throw refuse(400, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const b = parsed.data;
  const err = instalmentPctError(b.lines);
  if (err) throw refuse(422, 'bad_percentages', err);
  for (const l of b.lines) {
    if (l.stageCode && !isStageKey(l.stageCode)) throw refuse(422, 'bad_stage', `Unknown stage ${l.stageCode}.`);
    if (b.kind === 'PO' && !l.payableOn) throw refuse(422, 'payable_on_required', `PO instalment ${l.seq} needs "payable on".`);
  }
  const dup = await db.q(`select 1 from scm.reno_term_templates where company_id = $1 and kind = $2 and lower(name) = lower($3) and ($4::uuid is null or id <> $4)`, [actor.companyId, b.kind, b.name, id]);
  if (dup.length) throw refuse(409, 'name_taken', `A ${b.kind === 'PO' ? 'PO' : 'customer'} template called "${b.name}" already exists.`);
  if (b.isDefault) await db.q(`update scm.reno_term_templates set is_default = false where company_id = $1 and kind = $2 and ($3::uuid is null or id <> $3)`, [actor.companyId, b.kind, id]);
  let tplId = id;
  if (id) {
    const [r] = await db.q<{ id: string }>(
      `update scm.reno_term_templates set name = $3, is_default = $4, active = $5, updated_at = now() where id = $1 and company_id = $2 and kind = $6 returning id`,
      [id, actor.companyId, b.name, b.isDefault, b.active, b.kind],
    );
    if (!r) throw refuse(404, 'term_template_not_found', 'That payment-term template does not exist.');
    await db.q(`delete from scm.reno_term_template_lines where template_id = $1`, [id]);
  } else {
    const [r] = await db.q<{ id: string }>(
      `insert into scm.reno_term_templates (company_id, kind, name, is_default, active) values ($1, $2, $3, $4, $5) returning id`,
      [actor.companyId, b.kind, b.name, b.isDefault, b.active],
    );
    tplId = r.id;
  }
  await db.q(
    `insert into scm.reno_term_template_lines (template_id, seq, label, pct_bp, description, stage_code, trigger, payable_on)
     select $2, x.seq, x.label, x.pct_bp, x.description, x.stage_code, x.trigger, x.payable_on
       from jsonb_to_recordset($1::text::jsonb) as x(seq int, label text, pct_bp int, description text, stage_code text, trigger text, payable_on text)`,
    [JSON.stringify(b.lines.map((l) => ({ seq: l.seq, label: l.label, pct_bp: l.pctBp, description: l.description, stage_code: l.stageCode ?? null,
      trigger: l.trigger, payable_on: b.kind === 'PO' ? l.payableOn : null }))), tplId],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_term_template', entityId: tplId!, docNo: b.name, action: id ? 'UPDATE' : 'CREATE', actorName: actor.name });
  return { id: tplId! };
}

export async function listBrandProfiles(db: RenoDb, companyId: number) {
  const rows = await db.q(
    `select b.id, b.name, b.color, b.logo_r2_key, b.active, p.company_lines, p.contact_line, p.bank_line, p.terms_lines, p.intro, p.signatory_company,
            (p.brand_id is not null) as has_profile
       from public.project_brands b left join scm.reno_brand_profiles p on p.brand_id = b.id
      where b.company_id = $1 order by b.sort_order, b.name`,
    [companyId],
  );
  return rows.map((r) => ({
    brandId: Number(r.id), name: r.name as string, color: r.color as string, logoR2Key: r.logo_r2_key as string | null, active: Number(r.active) === 1,
    hasProfile: r.has_profile as boolean, companyLines: (r.company_lines ?? []) as string[], contactLine: (r.contact_line ?? '') as string,
    bankLine: (r.bank_line ?? '') as string, termsLines: (r.terms_lines ?? []) as string[], intro: (r.intro ?? '') as string,
    signatoryCompany: (r.signatory_company ?? '') as string,
  }));
}

const brandBody = z.object({
  companyLines: z.array(z.string().max(200)).max(8),
  contactLine: z.string().max(300),
  bankLine: z.string().max(300),
  termsLines: z.array(z.string().max(300)).max(10),
  intro: z.string().max(500),
  signatoryCompany: z.string().max(200),
});

export async function saveBrandProfile(db: RenoDb, actor: RenoActor, brandId: number, input: unknown): Promise<void> {
  const parsed = brandBody.safeParse(input);
  if (!parsed.success) throw refuse(400, 'invalid_body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const b = parsed.data;
  const [brand] = await db.q(`select id, name from public.project_brands where id = $1 and company_id = $2`, [brandId, actor.companyId]);
  if (!brand) throw refuse(404, 'brand_not_found', 'That brand does not exist.');
  await db.q(
    `insert into scm.reno_brand_profiles (brand_id, company_id, company_lines, contact_line, bank_line, terms_lines, intro, signatory_company, updated_at, updated_by)
     values ($1, $2, array(select jsonb_array_elements_text($3::text::jsonb)), $4, $5, array(select jsonb_array_elements_text($6::text::jsonb)), $7, $8, now(), $9)
     on conflict (brand_id) do update set company_lines = excluded.company_lines, contact_line = excluded.contact_line, bank_line = excluded.bank_line,
        terms_lines = excluded.terms_lines, intro = excluded.intro, signatory_company = excluded.signatory_company, updated_at = now(), updated_by = excluded.updated_by`,
    [brandId, actor.companyId, JSON.stringify(b.companyLines), b.contactLine, b.bankLine, JSON.stringify(b.termsLines), b.intro, b.signatoryCompany, actor.name],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'reno_brand_profile', entityId: String(brandId), docNo: brand.name, action: 'UPDATE', actorName: actor.name });
}
