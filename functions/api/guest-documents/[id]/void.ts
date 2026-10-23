import { type Env, json, fail } from '../../../_lib/db';
import { can } from '../../../_lib/access';
import { requireSession } from '../../../_lib/auth';
import { voidDoc, DocRefused } from '../../../_lib/guestDocuments';

/** POST /api/guest-documents/:id/void { reason } — voids an invoice or receipt. The number stays taken and is shown
 *  struck through; it is never issued again. Audited on the booking. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'finance', 'edit')) return fail('FORBIDDEN', 'Only people who can edit Finance void guest documents.', 403);
  const b = await request.json<{ reason?: string }>().catch(() => null);
  try {
    return json(await voidDoc(env, session, String(params.id), typeof b?.reason === 'string' ? b.reason : ''));
  } catch (e) {
    if (e instanceof DocRefused) return fail(e.code, e.message, e.status, e.code === 'VALIDATION' ? { reason: e.message } : undefined);
    throw e;
  }
};
