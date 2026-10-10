import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';
import { checkSen, checkInt, invalid, type Fields } from '../../_lib/validate';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit fabrics.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM fabric_library WHERE id = ?', id)) return fail('NOT_FOUND', 'That fabric does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkSen(fields, 'defaultSurchargeSen', b.defaultSurchargeSen, { label: 'Surcharge' });
  checkInt(fields, 'sortOrder', b.sortOrder, { label: 'Sort order' });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = []; const args: unknown[] = [];
  if (b.label !== undefined) { const l = String(b.label).trim(); if (!l) return fail('VALIDATION', 'Enter a label.', 422, { label: 'Enter a label.' }); sets.push('label = ?'); args.push(l); }
  if (b.fabricCode !== undefined) { sets.push('fabric_code = ?'); args.push(strOrNull(b.fabricCode)); }
  if (b.tier !== undefined) { sets.push('tier = ?'); args.push(strOrNull(b.tier) ?? 'standard'); }
  if (b.defaultSurchargeSen !== undefined) { sets.push('default_surcharge_sen = ?'); args.push(intOrNull(b.defaultSurchargeSen) ?? 0); }
  if (b.sofaTier !== undefined) { sets.push('sofa_tier = ?'); args.push(strOrNull(b.sofaTier)); }
  if (b.bedframeTier !== undefined) { sets.push('bedframe_tier = ?'); args.push(strOrNull(b.bedframeTier)); }
  if (b.swatchKey !== undefined) { sets.push('swatch_key = ?'); args.push(strOrNull(b.swatchKey)); }
  if (b.active !== undefined) { sets.push('active = ?'); args.push(flag(b.active) ?? 1); }
  if (b.sortOrder !== undefined) { sets.push('sort_order = ?'); args.push(intOrNull(b.sortOrder) ?? 0); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE fabric_library SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fabric.update', entityTable: 'fabric_library', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete fabrics.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM fabric_library WHERE id = ?', id)) return fail('NOT_FOUND', 'That fabric does not exist.', 404);
  await run(env, 'DELETE FROM fabric_library WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fabric.delete', entityTable: 'fabric_library', entityId: id });
  return new Response(null, { status: 204 });
};
