import { type Env, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ownerFor } from '../../_lib/ownerScope';
import { ownerReviews } from '../../_lib/ownerReviews';

/** GET /api/owner/reviews?unitId=&page=1&pageSize=20 — guest reviews of the owner's own units, newest first, with the
 *  average on each channel's scale and, for one unit, its category averages (functions/_lib/ownerReviews.ts). Owners
 *  see only their units; finance and management may pass ?ownerId=. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const owner = await ownerFor(env, session, url);
  if (owner instanceof Response) return owner;
  return json(await ownerReviews(env, owner.id, {
    unitId: url.searchParams.get('unitId'), page: Number(url.searchParams.get('page')) || 1, pageSize: Number(url.searchParams.get('pageSize')) || 20,
  }));
};
