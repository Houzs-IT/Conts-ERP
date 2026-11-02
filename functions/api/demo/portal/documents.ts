import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { todayMyt } from '../../../_lib/ops';
import { sampleOwnerFor, statementMonths, statementId } from '../../../_lib/demoPortal';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** GET /api/demo/portal/documents?ownerId=demo-... — the sample owner's documents: one sample statement a month. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const found = await sampleOwnerFor(env, new URL(request.url));
  if (found instanceof Response) return found;
  const months = await statementMonths(env, found.units.map(u => u.id));
  const thisMonth = todayMyt().slice(0, 7);
  return json({
    sample: true,
    data: months.map(m => {
      const [y, mo] = m.split('-').map(Number);
      const issued = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
      return { id: statementId(found.owner.id, m), type: 'statement', refId: statementId(found.owner.id, m), title: `Statement · ${MONTHS[mo - 1]} ${y} (sample)`, meta: m < thisMonth ? 'Final · PDF · Sample data' : 'Draft · PDF · Sample data', issuedAt: m < thisMonth ? issued : `${m}-01` };
    }),
  });
};
