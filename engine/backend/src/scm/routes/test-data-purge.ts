// /api/scm/test-data: the owner's one-off clear of testing data (owner, 5 Nov 2026; migration 0226).
// The preview runs the real deletes and rolls them back, so what it shows is what the button does.
// Remove this route, its section and the database function once the clear has been done.
import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { requireHouzsPerm } from '../lib/houzs-perms';
import type { Env, Variables } from '../env';
import type { Db } from '../../services/renovation/load';

export const CLEAR_WORD = 'CLEAR';

export const testDataPurge = new Hono<{ Bindings: Env; Variables: Variables }>();
testDataPurge.use('*', supabaseAuth);
testDataPurge.use('*', requireHouzsPerm('*'));

async function run(env: Env, commit: boolean, actor: string | null): Promise<unknown> {
  const db = env.DB as unknown as Db;
  const row = await db.prepare(`SELECT scm.purge_test_data(?::boolean, ?) AS r`).bind(commit, actor).first<{ r: unknown }>();
  return typeof row?.r === 'string' ? JSON.parse(row.r) : row?.r;
}

testDataPurge.get('/preview', async (c) => c.json(await run(c.env, false, null)));

testDataPurge.post('/clear', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== CLEAR_WORD) return c.json({ error: 'confirm_required', message: `Type ${CLEAR_WORD} to confirm.` }, 400);
  const user = c.get('user') as { id?: string } | undefined;
  return c.json(await run(c.env, true, user?.id ?? null));
});
