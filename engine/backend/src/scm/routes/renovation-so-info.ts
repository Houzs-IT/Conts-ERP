// ----------------------------------------------------------------------------
// /api/scm/renovation-so-info — the "Order information" block of a sales order
// in renovation mode (owner, 14 Oct 2026; migration 0112).
//
//   GET  /lists               property types + layouts (Project Maintenance), ready flag
//   GET  /projects?q=         renovation projects to put the SO under, with their shared fields
//   GET  /projects/:id        one project's shared fields (prefill when an SO is opened from it)
//   GET  /so/:docNo           an existing SO's order information (the edit form)
//   PUT  /:docNo              save the SO's order information and write it back to its project
//
// The create path (POST /api/scm/mfg-sales-orders with a `renovation` block) and
// this PUT share applyRenovationSoInfo below. Reads ride the Sales Orders view
// level; the PUT needs Sales Orders edit (area guard in scm/index.ts).
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { activeCompanyId, activeCompanySql } from '../lib/companyScope';
import type { Env, Variables } from '../env';
import type { Db } from '../../services/renovation/load';
import {
  propertyColumnsReady,
  readProjectShared,
  readPropertyLists,
  renovationMode,
  searchProjects,
  writeSoPropertyColumns,
  writeSoToProject,
  type SoShared,
} from '../../services/renovation/customerProperty';
import { readPropertyInput, renoSoRequiredProblems, type PropertyProblem } from '../shared/renovation-property';

type C = Context<{ Bindings: Env; Variables: Variables }>;

export const renovationSoInfo = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationSoInfo.use('*', supabaseAuth);

const dbOf = (c: { env: Env }) => c.env.DB as unknown as Db;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The renovation block a SO form sends (`body.renovation`), read and checked. */
export interface RenovationSoInput {
  projectId: number | null;
  building: string;
  unitNo: string;
  property: ReturnType<typeof readPropertyInput>['value'];
  problems: PropertyProblem[];
}

export function readRenovationBlock(raw: unknown): RenovationSoInput {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pid = Number(b.projectId);
  const { value, problems } = readPropertyInput(b);
  return {
    projectId: Number.isInteger(pid) && pid > 0 ? pid : null,
    building: str(b.building).slice(0, 120),
    unitNo: str(b.unitNo).slice(0, 40),
    property: value,
    problems,
  };
}

/** Every reason a renovation SO cannot be saved: invalid values, then the required fields. */
export function renovationSoProblems(input: RenovationSoInput, head: { customerName: string; phone: string; address1: string }): PropertyProblem[] {
  const invalid = new Set(input.problems.map((p) => p.field));
  return [...input.problems, ...renoSoRequiredProblems({ ...head, property: input.property }).filter((p) => !invalid.has(p.field))];
}

/** Whether a request may use the renovation block at all: renovation mode and migration 0112 applied. */
export async function renovationSoAvailable(db: Db): Promise<{ ok: true } | { ok: false; status: 409; body: Record<string, unknown> }> {
  if (!(await renovationMode(db))) {
    return { ok: false, status: 409, body: { error: 'not_renovation_mode', message: 'This install does not run renovation projects.' } };
  }
  if (!(await propertyColumnsReady(db))) {
    return { ok: false, status: 409, body: { error: 'property_columns_missing', message: 'The property fields are not in the database yet (migration 0112). Ask the administrator to apply it.' } };
  }
  return { ok: true };
}

/** Stamp the SO's order information and write the shared fields back to its project. */
export async function applyRenovationSoInfo(
  db: Db,
  docNo: string,
  input: RenovationSoInput,
  ctx: { companyId: number; companySql: string; actorId: number },
): Promise<{ ok: true; projectId: number | null } | { ok: false; status: 404 | 422; body: Record<string, unknown> }> {
  if (input.projectId != null && !(await readProjectShared(db, input.projectId, ctx.companySql))) {
    return { ok: false, status: 422, body: { error: 'project_not_found', message: 'That project does not exist in this company.' } };
  }
  await writeSoPropertyColumns(db, docNo, input.projectId, { building: input.building, unitNo: input.unitNo, ...input.property });
  if (input.projectId != null) {
    const so = await db.prepare(
      `SELECT debtor_name, phone, email, address1, address2 FROM scm.mfg_sales_orders WHERE doc_no = ?`,
    ).bind(docNo).first<Record<string, string | null>>();
    if (!so) return { ok: false, status: 404, body: { error: 'so_not_found' } };
    const shared: SoShared = {
      customerName: so.debtor_name ?? '', phone: so.phone ?? '', email: so.email ?? '',
      address1: so.address1 ?? '', address2: so.address2 ?? '', building: input.building, unitNo: input.unitNo, ...input.property,
    };
    await writeSoToProject(db, input.projectId, shared, ctx.actorId, ctx.companyId, docNo);
  }
  return { ok: true, projectId: input.projectId };
}

renovationSoInfo.get('/lists', async (c: C) => {
  const db = dbOf(c);
  const mode = await renovationMode(db).catch(() => false);
  const ready = mode && (await propertyColumnsReady(db).catch(() => false));
  if (!ready) return c.json({ ready: false, renovationMode: mode, propertyTypes: [], layouts: [] });
  const lists = await readPropertyLists(db, activeCompanySql(c));
  return c.json({ ready: true, renovationMode: true, ...lists });
});

renovationSoInfo.get('/projects', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  return c.json({ data: await searchProjects(db, activeCompanySql(c, 'p.company_id'), str(c.req.query('q'))) });
});

renovationSoInfo.get('/projects/:id', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const p = await readProjectShared(db, id, activeCompanySql(c, 'p.company_id'));
  if (!p) return c.json({ error: 'not_found', message: 'Project not found.' }, 404);
  return c.json({ project: p });
});

renovationSoInfo.get('/so/:docNo', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const r = await db.prepare(
    `SELECT project_id::int AS project_id, debtor_name, phone, email, address1, address2, building, unit_no, property_type, layout_label,
            bedrooms, bathrooms, built_up_sqft::float8 AS built_up_sqft
       FROM scm.mfg_sales_orders WHERE doc_no = ?${activeCompanySql(c)}`,
  ).bind(c.req.param('docNo') ?? '').first<Record<string, unknown>>();
  if (!r) return c.json({ error: 'so_not_found' }, 404);
  const t = (v: unknown) => (v == null ? '' : String(v));
  const projectId = r.project_id == null ? null : Number(r.project_id);
  /* project_id on a Houzs order can name an exhibition (its fair): only a renovation project counts here. */
  const project = projectId != null ? await readProjectShared(db, projectId, activeCompanySql(c, 'p.company_id')) : null;
  return c.json({
    info: {
      projectId: project ? project.id : null, customerName: t(r.debtor_name), customerPhone: t(r.phone), customerEmail: t(r.email),
      siteAddress: [t(r.address1), t(r.address2)].filter(Boolean).join('\n'), building: t(r.building), unitNo: t(r.unit_no),
      propertyType: t(r.property_type), layoutLabel: t(r.layout_label), bedrooms: t(r.bedrooms), bathrooms: t(r.bathrooms),
      builtUpSqft: t(r.built_up_sqft),
    },
    project,
  });
});

renovationSoInfo.put('/:docNo', async (c: C) => {
  const db = dbOf(c);
  const avail = await renovationSoAvailable(db);
  if (!avail.ok) return c.json(avail.body, avail.status);
  const docNo = c.req.param('docNo') ?? '';
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const so = await db.prepare(
    `SELECT doc_no, coalesce(so_kind, 'STANDARD') AS so_kind, status::text AS status, debtor_name, phone, address1, company_id::int AS company_id
       FROM scm.mfg_sales_orders WHERE doc_no = ?${activeCompanySql(c)}`,
  ).bind(docNo).first<{ so_kind: string; status: string; debtor_name: string | null; phone: string | null; address1: string | null; company_id: number }>();
  if (!so) return c.json({ error: 'so_not_found', message: `Sales order ${docNo} does not exist.` }, 404);
  if (so.so_kind !== 'STANDARD') return c.json({ error: 'renovation_contract', message: 'A renovation contract keeps the header it was signed with.' }, 409);
  if (so.status === 'CANCELLED' || so.status === 'CLOSED') return c.json({ error: 'so_closed', message: `Sales order ${docNo} is ${so.status.toLowerCase()}.` }, 409);
  const input = readRenovationBlock(body);
  const problems = renovationSoProblems(input, { customerName: so.debtor_name ?? '', phone: so.phone ?? '', address1: so.address1 ?? '' });
  if (problems.length) return c.json({ error: 'validation_failed', problems }, 422);
  const r = await applyRenovationSoInfo(db, docNo, input, {
    companyId: activeCompanyId(c) ?? so.company_id, companySql: activeCompanySql(c, 'p.company_id'),
    actorId: Number(c.get('houzsUser')?.id ?? 0),
  });
  if (!r.ok) return c.json(r.body, r.status);
  return c.json({ ok: true, docNo, projectId: r.projectId });
});
