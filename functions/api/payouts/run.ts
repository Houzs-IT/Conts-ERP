import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { stage } from '../../_lib/approvals';

/** POST /api/payouts/run { payoutIds, reason? } — asks for a payout run: the chosen Pending payouts are to move to
 *  Processing, which means "the bank transfers are being made". Money leaving needs a second person, so this only
 *  stages the run (functions/_lib/approvals.ts); approving it moves the payouts, each audited with the run's
 *  reference. Nothing is sent to any bank from here: finance makes the transfers in the bank's own system, then marks
 *  each payout Paid once the bank confirms it left. Answers 202 with the request. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view payouts but cannot start a payout run. Ask a Finance Admin for access.', 403);

  const b = await request.json<{ payoutIds?: string[]; reason?: string }>().catch(() => null);
  const ids = Array.isArray(b?.payoutIds) ? [...new Set(b!.payoutIds.map(String))] : [];
  if (!ids.length || ids.length > 500) return fail('VALIDATION', 'Choose at least one pending payout (500 at most).', 422);

  const rows = await all<{ id: string; state: string; amount: number; bank_last4: string | null; owner_id: string }>(env,
    `SELECT id, state, amount, bank_last4, owner_id FROM payouts WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  // A payout already in another run waiting for approval cannot join a second one.
  const queued = new Set((await all<{ id: string }>(env, `SELECT jsonb_array_elements_text(payload->'payoutIds') AS id FROM approval_requests WHERE kind = 'payout_run' AND status = 'pending'`)).map(r => r.id));
  const chosen: typeof rows = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const p = rows.find(r => r.id === id);
    if (!p) { skipped.push({ id, reason: 'That payout no longer exists.' }); continue; }
    if (p.state !== 'pending') { skipped.push({ id, reason: `Only a pending payout can join a run (this one is ${p.state}).` }); continue; }
    if (!p.bank_last4) { skipped.push({ id, reason: 'No bank account on file for this owner.' }); continue; }
    if (queued.has(id)) { skipped.push({ id, reason: 'Already in a run waiting for approval.' }); continue; }
    chosen.push(p);
  }
  if (!chosen.length) return fail('NOTHING_TO_RUN', skipped[0]?.reason ?? 'None of these payouts can join a run.', 409);

  const runRef = `RUN-${nowIso().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const total = chosen.reduce((n, r) => n + Number(r.amount), 0);
  const owners = new Set(chosen.map(r => r.owner_id)).size;
  const amount = `RM ${(total / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
  const staged = await stage(env, session, {
    kind: 'payout_run', entity: 'payouts', entityId: runRef, amount: total,
    summary: `Payout run ${runRef}: ${chosen.length} ${chosen.length === 1 ? 'payout' : 'payouts'} to ${owners} ${owners === 1 ? 'owner' : 'owners'}, ${amount}`,
    reason: (typeof b?.reason === 'string' && b.reason.trim()) || `Owner payouts, ${chosen.length} ${chosen.length === 1 ? 'transfer' : 'transfers'}`,
    payload: { payoutIds: chosen.map(r => r.id), runRef },
  });
  return json({ ...staged, run: runRef, queued: chosen.length, total, skipped }, 202);
};
