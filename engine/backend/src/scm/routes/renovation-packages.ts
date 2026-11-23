// ----------------------------------------------------------------------------
// /api/scm/renovation/packages — the Packages module (owner, 20 Nov 2026).
// Packages (PKG-, areas) and kits (KIT-) of products, quantities and SLA days;
// the logic is lib/renovation-packages.ts. Reads ride the Sales Orders view
// level (scm/index.ts); saving needs scm.renovation.quote, as templates did.
// ----------------------------------------------------------------------------
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { normaliseSections } from '../lib/renovation-validate';
import {
  createPackage, expandPackage, getPackage, listPackages, nextCode, normalisePackageHeader, savePackage, searchPackages, type PackageBody,
} from '../lib/renovation-packages';
import { loadUomsSql } from './renovation-catalog-settings';
import { actorOf, handle, json, need, param } from './renovation';

export const renovationPackages = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationPackages.use('/packages', supabaseAuth);
renovationPackages.use('/packages/*', supabaseAuth);

const QUOTE = 'scm.renovation.quote';

renovationPackages.get('/packages', handle(null, async (c, { sqlRead }) => c.json({ packages: await listPackages(sqlRead, actorOf(c).companyId) })));

renovationPackages.get('/packages/search', handle(null, async (c, { sqlRead }) =>
  c.json({ packages: await searchPackages(sqlRead, actorOf(c).companyId, c.req.query('q') ?? '') })));

renovationPackages.get('/packages/next-code', handle(null, async (c, { sqlRead }) =>
  c.json({ code: await nextCode(sqlRead, actorOf(c).companyId, c.req.query('kind') === 'KIT' ? 'KIT' : 'PACKAGE') })));

renovationPackages.get('/packages/:id', handle(null, async (c, { sqlRead }) => c.json(await getPackage(sqlRead, param(c, 'id'), actorOf(c).companyId))));

renovationPackages.get('/packages/:id/expand', handle(null, async (c, { sqlRead }) => c.json(await expandPackage(sqlRead, param(c, 'id'), actorOf(c).companyId))));

async function bodyOf(c: Parameters<typeof actorOf>[0], sqlRead: Parameters<typeof loadUomsSql>[0], partial: boolean): Promise<PackageBody> {
  const b = await json(c);
  const head = need(normalisePackageHeader(b, partial));
  const sections = b.sections !== undefined ? need(normaliseSections(b.sections, 'doc', await loadUomsSql(sqlRead))) : undefined;
  return { ...head, sections, fromSoDocNo: typeof b.fromSoDocNo === 'string' ? b.fromSoDocNo.slice(0, 60) : null };
}

renovationPackages.post('/packages', handle(QUOTE, async (c, { tx, sqlRead }) => {
  const body = await bodyOf(c, sqlRead, false);
  return c.json(await tx((db) => createPackage(db, actorOf(c), body)), 201);
}));

renovationPackages.put('/packages/:id', handle(QUOTE, async (c, { tx, sqlRead }) => {
  const body = await bodyOf(c, sqlRead, true);
  await tx((db) => savePackage(db, actorOf(c), param(c, 'id'), body));
  return c.json({ ok: true });
}));
