import { type Env, all, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ownerFor, VISIBLE } from '../../_lib/ownerScope';

const monthYear = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) : '');

/** GET /api/owner/documents — finalised statements, plus files staff have marked visible to the owner. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const owner = await ownerFor(env, session, new URL(request.url));
  if (owner instanceof Response) return owner;

  const statements = await all<any>(env, `
    SELECT id, period_start, state, finalised_at, generated_at FROM owner_statements WHERE owner_id = ? AND state IN ${VISIBLE} ORDER BY period_start DESC LIMIT 24`, owner.id);
  const files = await all<any>(env, `
    SELECT id, kind, file_name, mime_type, byte_size, created_at FROM documents WHERE owner_id = ? AND visible_to_owner = 1 ORDER BY created_at DESC LIMIT 50`, owner.id);

  const kindOf = (k: string) => (k === 'contract' || k === 'invoice' ? k : 'report');
  return json({
    data: [
      ...statements.map(s => ({
        id: s.id, type: 'statement', refId: s.id, title: `Statement — ${monthYear(String(s.period_start).slice(0, 7))}`,
        meta: s.finalised_at ? `Final ${day(s.finalised_at)} · PDF` : `${s.state === 'paid' ? 'Paid' : 'Final'} · PDF`, issuedAt: String(s.finalised_at ?? s.generated_at).slice(0, 10),
      })),
      ...files.map(f => ({
        id: f.id, type: kindOf(f.kind), title: f.file_name, meta: `${Math.max(1, Math.round(Number(f.byte_size) / 1024))} KB`, issuedAt: String(f.created_at).slice(0, 10),
      })),
    ],
  });
};
