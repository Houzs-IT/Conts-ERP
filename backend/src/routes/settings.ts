import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Vars } from '../lib/types';
import { requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { badRequest, requestMeta } from '../lib/http';

export const settings = new Hono<{ Bindings: Env; Variables: Vars }>();

const companySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  legal_name: z.string().trim().max(160).nullable().optional(),
  registration_no: z.string().trim().max(60).nullable().optional(),
  address_line1: z.string().trim().max(160).nullable().optional(),
  address_line2: z.string().trim().max(160).nullable().optional(),
  postcode: z.string().trim().max(12).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  website: z.string().trim().max(160).nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).optional(),
});

settings.get('/company', requirePermission('settings.company.view'), async (c) => {
  const [row] = await c.get('db')`select * from app.company_settings where id = true`;
  return c.json({ company: row });
});

settings.put('/company', requirePermission('settings.company.edit'), async (c) => {
  const db = c.get('db');
  const parsed = companySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());

  const [before] = await db`select * from app.company_settings where id = true`;
  const merged = { ...before, ...parsed.data, updated_at: new Date(), updated_by: c.get('auth').id };
  const [after] = await db`
    update app.company_settings set ${db(merged as never,
      'name','legal_name','registration_no','address_line1','address_line2','postcode','city','state',
      'country','phone','email','website','timezone','currency','updated_at','updated_by')}
    where id = true returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'company.update', entity: 'company_settings', entityId: 'company', before, after, ...requestMeta(c) });
  return c.json({ company: after });
});

settings.get('/doc-numbers', requirePermission('settings.docnumbers.view'), async (c) => {
  const rows = await c.get('db')`select * from app.doc_number_rules order by doc_type`;
  return c.json({ rules: rows });
});

settings.put('/doc-numbers/:docType', requirePermission('settings.docnumbers.manage'), async (c) => {
  const db = c.get('db');
  const docType = c.req.param('docType');
  const parsed = z.object({
    prefix: z.string().trim().min(1).max(12),
    padding: z.number().int().min(1).max(12),
    next_number: z.number().int().min(1),
    reset_period: z.enum(['never', 'yearly', 'monthly']),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw badRequest('Check the fields', parsed.error.flatten());
  const b = parsed.data;

  const [before] = await db`select * from app.doc_number_rules where doc_type = ${docType}`;
  const [after] = await db`
    insert into app.doc_number_rules (doc_type, prefix, padding, next_number, reset_period, updated_at)
    values (${docType}, ${b.prefix}, ${b.padding}, ${b.next_number}, ${b.reset_period}, now())
    on conflict (doc_type) do update set
      prefix = excluded.prefix, padding = excluded.padding,
      next_number = excluded.next_number, reset_period = excluded.reset_period, updated_at = now()
    returning *
  `;
  await writeAudit(db, { actorId: c.get('auth').id, action: 'docnumbers.update', entity: 'doc_number_rule', entityId: docType, before, after, ...requestMeta(c) });
  return c.json({ rule: after });
});

/** Audit log, newest first. Filter by entity, actor or date. */
settings.get('/audit', requirePermission('settings.audit.view'), async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const entity = c.req.query('entity') ?? null;
  const actor = c.req.query('actor_id') ?? null;

  const rows = await db`
    select a.*, p.full_name as actor_name
    from app.audit_log a
    left join app.profiles p on p.id = a.actor_id
    where (${entity}::text is null or a.entity = ${entity})
      and (${actor}::uuid is null or a.actor_id = ${actor}::uuid)
    order by a.created_at desc
    limit ${limit}
  `;
  return c.json({ entries: rows });
});
