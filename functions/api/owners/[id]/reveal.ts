import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

const FIELDS = { ic: 'ic_number', bank: 'bank_account_number' } as const;

/** GET /api/owners/:id/reveal?field=ic|bank — the full IC / passport or bank account number for one owner.
 *  Management-side roles only, one field at a time, and every reveal is written to the audit log (who, which
 *  owner, which field, never the value). Lists and the profile show only the last four characters. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can see full identity and bank numbers.', 403);

  const field = new URL(request.url).searchParams.get('field') as keyof typeof FIELDS | null;
  if (!field || !(field in FIELDS)) return fail('VALIDATION', 'Say which number to show: ic or bank.', 422);

  const id = String(params.id);
  const o = await one<{ display_name: string; value: string | null }>(env, `SELECT display_name, ${FIELDS[field]} AS value FROM owners WHERE id = ?`, id);
  if (!o) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: field === 'ic' ? 'owner.reveal_ic' : 'owner.reveal_bank',
    entityTable: 'owners', entityId: id, after: { owner: o.display_name, field },
  });
  return json({ field, value: o.value ?? '' });
};
