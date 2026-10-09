import { type Env, all, one, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { buildReport } from '../../../_lib/ownerReport';

/** GET /api/statements/:id/report[?unit=<unit id>] — the Owner Income Report's figures: the company letterhead
 *  and terms (Settings), the owner, and per unit the month (page 1) and the year to date (page 2). The page
 *  #/finance/statements/:id/report prints it; Save as PDF gives the owner's two-page report. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const unit = new URL(request.url).searchParams.get('unit');

  const s = await one<any>(env, 'SELECT s.state, o.user_id FROM owner_statements s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?', id);
  if (!s) return fail('NOT_FOUND', 'That statement no longer exists.', 404);
  if (session.role === 'owner') {
    if (s.user_id !== session.userId) return fail('FORBIDDEN', 'This statement belongs to another owner.', 403);
    if (s.state === 'provisional') return fail('NOT_FINAL', 'This statement is not final yet.', 403);
  } else if (!session.manage) return fail('FORBIDDEN', 'Statements are available to finance, management and the owner.', 403);

  const report = await buildReport((sql, ...args) => all(env, sql, ...args), id, unit);
  if (!report) return fail('NOT_FOUND', 'That statement no longer exists.', 404);
  if (unit && !report.units.length) return fail('NOT_FOUND', 'That unit is not on this statement.', 404);
  return json({ generatedAt: new Date().toISOString(), data: report });
};
