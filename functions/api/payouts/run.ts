import { type Env, all, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { notifyUsers } from '../../_lib/notify';

/** POST /api/payouts/run { payoutIds } — starts a payout run: the chosen Pending payouts move to Processing,
 *  which means "the bank transfers are being made". Nothing is sent to any bank from here; finance makes the
 *  transfers in the bank's own system, then marks each payout Paid once the bank confirms it left.
 *  Each move is audited with the run's reference so the run can be traced afterwards. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view payouts but cannot start a payout run. Ask a Finance Admin for access.', 403);

  const b = await request.json<{ payoutIds?: string[] }>().catch(() => null);
  const ids = Array.isArray(b?.payoutIds) ? [...new Set(b!.payoutIds.map(String))] : [];
  if (!ids.length || ids.length > 500) return fail('VALIDATION', 'Choose at least one pending payout (500 at most).', 422);

  const rows = await all<{ id: string; state: string; amount: number; bank_last4: string | null; owner_id: string }>(env,
    `SELECT id, state, amount, bank_last4, owner_id FROM payouts WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const runRef = `RUN-${nowIso().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const started: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const p = rows.find(r => r.id === id);
    if (!p) { skipped.push({ id, reason: 'That payout no longer exists.' }); continue; }
    if (p.state !== 'pending') { skipped.push({ id, reason: `Only a pending payout can join a run (this one is ${p.state}).` }); continue; }
    if (!p.bank_last4) { skipped.push({ id, reason: 'No bank account on file for this owner.' }); continue; }
    // The state guard in the UPDATE keeps two people starting runs at once from moving a payout twice.
    const moved = await all<{ id: string }>(env, "UPDATE payouts SET state = 'processing' WHERE id = ? AND state = 'pending' RETURNING id", id);
    if (!moved.length) { skipped.push({ id, reason: 'Someone else already started it.' }); continue; }
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payout.run', entityTable: 'payouts', entityId: id, before: { state: 'pending' }, after: { state: 'processing', run: runRef, amount: Number(p.amount) } });
    started.push(id);
  }
  const total = rows.filter(r => started.includes(r.id)).reduce((n, r) => n + Number(r.amount), 0);
  if (started.length) {
    const rm = `RM ${(total / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await notifyUsers(env, 'finance', {
      kind: 'payout.run', title: `Payout run ${runRef} started`,
      body: `${started.length} ${started.length === 1 ? 'payout' : 'payouts'} totalling ${rm} moved to Processing by ${session.fullName}${skipped.length ? `; ${skipped.length} skipped` : ''}. Mark each one paid once the bank confirms it.`,
      link: '/finance/payouts', entityTable: 'payouts', entityId: runRef, dedupeKey: `payout-run-${runRef}`, except: session.userId,
    });
  }
  return json({ run: runRef, started: started.length, total, skipped });
};

