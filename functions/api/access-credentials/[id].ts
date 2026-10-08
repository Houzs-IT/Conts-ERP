import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidCredential, mayEditCredentials, type CredentialInput } from '../../_lib/credentials';

/** GET /api/access-credentials/:id?reveal=true — the clear code. Only operations managers and management, and every reveal is written to the audit log. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (new URL(request.url).searchParams.get('reveal') !== 'true') return fail('VALIDATION', 'Ask for a reveal explicitly.', 422);
  if (!mayEditCredentials(session)) return fail('FORBIDDEN', 'You can see the access instruction but not the raw code. Ask an operations manager.', 403);

  const id = String(params.id);
  const row = await one<any>(env, `
    SELECT a.id, a.secret, u.unit_number FROM access_credentials a JOIN units u ON u.id = a.unit_id WHERE a.id = ?`, id);
  if (!row) return fail('NOT_FOUND', 'That credential no longer exists.', 404);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'access.reveal', entityTable: 'access_credentials', entityId: id, after: { unitNumber: row.unit_number } });
  return json({ id, secret: row.secret ?? '' });
};

/** PATCH /api/access-credentials/:id — only what is present changes. `secret`: absent keeps the code, '' or null removes it.
 *  The audit log records that the code changed, never the code. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditCredentials(session)) return fail('FORBIDDEN', 'Only operations managers and management can change access codes.', 403);

  const b = await request.json<CredentialInput>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const bad = invalidCredential(b, true);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const id = String(params.id);
  const cur = await one<any>(env, `
    SELECT a.id, a.kind, a.label, a.instruction, a.rotates_after_stay, a.secret IS NOT NULL AND a.secret <> '' AS has_code, u.unit_number
    FROM access_credentials a JOIN units u ON u.id = a.unit_id WHERE a.id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That credential no longer exists.', 404);

  const codeChanged = b.secret !== undefined;
  const secret = codeChanged ? (String(b.secret ?? '').trim() || null) : null;
  await run(env, `
    UPDATE access_credentials SET kind = COALESCE(?, kind), label = COALESCE(?, label), instruction = COALESCE(?, instruction),
           rotates_after_stay = COALESCE(?, rotates_after_stay), updated_at = ?
    WHERE id = ?`,
    b.kind ?? null, b.label !== undefined ? String(b.label).trim() : null, b.instruction !== undefined ? String(b.instruction).trim() : null,
    b.rotatesAfterStay === undefined ? null : (b.rotatesAfterStay ? 1 : 0), nowIso(), id);
  if (codeChanged) await run(env, 'UPDATE access_credentials SET secret = ? WHERE id = ?', secret, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'access.update', entityTable: 'access_credentials', entityId: id,
    before: { kind: cur.kind, label: cur.label, rotatesAfterStay: !!cur.rotates_after_stay, hasCode: !!cur.has_code },
    after: {
      unitNumber: cur.unit_number, kind: b.kind ?? cur.kind, label: b.label !== undefined ? String(b.label).trim() : cur.label,
      rotatesAfterStay: b.rotatesAfterStay ?? !!cur.rotates_after_stay, instructionChanged: b.instruction !== undefined && String(b.instruction).trim() !== cur.instruction,
      codeChanged, ...(codeChanged ? { hasCode: !!secret } : {}),
    },
  });
  return json({ ok: true });
};

/** DELETE /api/access-credentials/:id — nothing else refers to a credential, so it goes alone, and the removal is audited. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditCredentials(session)) return fail('FORBIDDEN', 'Only operations managers and management can remove access codes.', 403);

  const id = String(params.id);
  const cur = await one<any>(env, `
    SELECT a.id, a.unit_id, a.kind, a.label, u.unit_number FROM access_credentials a JOIN units u ON u.id = a.unit_id WHERE a.id = ?`, id);
  if (!cur) return fail('NOT_FOUND', 'That credential no longer exists.', 404);

  await run(env, 'DELETE FROM access_credentials WHERE id = ?', id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'access.delete', entityTable: 'access_credentials', entityId: id,
    before: { unitId: cur.unit_id, unitNumber: cur.unit_number, kind: cur.kind, label: cur.label },
  });
  return json({ ok: true });
};
