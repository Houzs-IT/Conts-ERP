import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  if (!canSeeFinance(session.role) && !ownerScoped) {
    return fail('FORBIDDEN', 'Payouts are visible to finance and management roles.', 403);
  }

  const rows = await all(env, `
    SELECT y.*, o.display_name, o.bank_name, o.bank_account_last4
    FROM payouts y
    JOIN owners o ON o.id = y.owner_id
    WHERE 1 = 1 ${ownerScoped ? 'AND o.user_id = ?' : ''}
    ORDER BY y.created_at DESC`, ...(ownerScoped ? [session.userId] : []));

  return json({
    generatedAt: new Date().toISOString(),
    data: (rows as any[]).map(r => ({
      id: r.id, statementId: r.statement_id,
      ownerName: r.display_name, amount: r.amount, currency: r.currency,
      state: r.state, method: r.method,
      // Never the full account number, only the tail.
      bankName: r.bank_name, bankLast4: r.bank_account_last4,
      paidAt: r.paid_at, failureReason: r.failure_reason,
    })),
  });
};

/** POST /api/payouts { statementIds } — creates a payout run from sent statements. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'You can view payouts but cannot create them. Ask a Finance Admin for access.', 403);
  }

  const { statementIds } = await request.json<{ statementIds: string[] }>();
  if (!statementIds?.length) return fail('VALIDATION', 'Select at least one statement.', 422);

  const placeholders = statementIds.map(() => '?').join(',');
  const rows = await all<any>(env, `
    SELECT s.id, s.state, s.owner_id, s.net_payout, o.bank_account_last4
    FROM owner_statements s JOIN owners o ON o.id = s.owner_id
    WHERE s.id IN (${placeholders})`, ...statementIds);

  const created: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const s of rows) {
    if (s.state !== 'sent' && s.state !== 'paid') {
      skipped.push({ id: s.id, reason: 'Cannot pay out. The statement has not been sent to the owner.' });
      continue;
    }
    if (!s.bank_account_last4) {
      skipped.push({ id: s.id, reason: 'No bank details on file for this owner.' });
      continue;
    }
    const id = crypto.randomUUID();
    await run(env, `
      INSERT INTO payouts (id, statement_id, owner_id, amount, currency, state, method, bank_last4, created_at)
      VALUES (?, ?, ?, ?, 'MYR', 'pending', 'bank_transfer', ?, ?)`,
      id, s.id, s.owner_id, s.net_payout, s.bank_account_last4, nowIso());
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'payout.create',
      entityTable: 'payouts', entityId: id, after: { statementId: s.id, amount: s.net_payout },
    });
    created.push(id);
  }

  return json({ created: created.length, skipped });
};

/** PATCH — mark a payout paid or failed. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Finance access is required.', 403);

  const { id, state, failureReason } = await request.json<{ id: string; state: string; failureReason?: string }>();
  if (!['processing', 'paid', 'failed'].includes(state)) return fail('VALIDATION', 'Unknown payout state.', 422);

  const before = await one<any>(env, 'SELECT state, statement_id FROM payouts WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That payout no longer exists.', 404);

  await run(env, 'UPDATE payouts SET state = ?, paid_at = ?, failure_reason = ? WHERE id = ?',
    state, state === 'paid' ? nowIso() : null, state === 'failed' ? (failureReason ?? null) : null, id);

  if (state === 'paid') {
    await run(env, "UPDATE owner_statements SET state = 'paid' WHERE id = ?", before.statement_id);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'payout.' + state,
    entityTable: 'payouts', entityId: id,
    before: { state: before.state }, after: { state, failureReason: failureReason ?? null },
  });
  const owner = await one<{ display_name: string; email: string; amount: number; bank_account_last4: string }>(env, `
    SELECT o.display_name, o.email, y.amount, o.bank_account_last4
    FROM payouts y JOIN owners o ON o.id = y.owner_id WHERE y.id = ?`, id);

  if (owner && (state === 'paid' || state === 'failed')) {
    const amount = `RM ${(owner.amount / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
    await notify(env, {
      template: state === 'paid' ? 'owner.payout_paid' : 'owner.payout_failed',
      recipient: owner.email,
      channel: 'email',
      subject: state === 'paid' ? 'Your payout has been sent' : 'We could not complete your payout',
      body: state === 'paid'
        ? `${amount} was transferred to your account ending ${owner.bank_account_last4}.`
        : `We could not complete your ${amount} payout. ${failureReason ?? 'We will contact you shortly.'}`,
      entityTable: 'payouts', entityId: id,
      // A failed payout overrides quiet hours — the owner is expecting money.
      urgent: state === 'failed',
    });
  }

  return json({ ok: true });
};
