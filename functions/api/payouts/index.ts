import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { refOf } from '../../_lib/ops';

const STATES = ['failed', 'pending', 'processing', 'paid'];
const METHOD_LABEL: Record<string, string> = { bank_transfer: 'Bank transfer', ibg: 'IBG', duitnow: 'DuitNow' };

/** GET /api/payouts?state=&period=YYYY-MM&q=&page=&pageSize=
 *  Attention order (failed, pending, processing, then paid newest first), a page at a time, with counts per
 *  state and the amount still outstanding for the whole filter so the header never depends on the page. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  if (!session.manage && !ownerScoped) {
    return fail('FORBIDDEN', 'Payouts are visible to finance and management roles.', 403);
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const period = url.searchParams.get('period');
  const q = url.searchParams.get('q')?.trim() || null;
  if (state && !STATES.includes(state)) return fail('VALIDATION', 'Unknown payout state.', 422);
  if (period && !/^\d{4}-\d{2}$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 100)));

  // Everything but the state filter: the state counts are taken over this.
  const base: string[] = [], args: unknown[] = [];
  if (ownerScoped) { base.push('o.user_id = ?'); args.push(session.userId); }
  if (period) { base.push('s.period_start = ?'); args.push(`${period}-01`); }
  if (q) { base.push('o.display_name ILIKE ?'); args.push(`%${q.replace(/[%_\\]/g, m => '\\' + m)}%`); }
  const baseSql = base.length ? 'AND ' + base.join(' AND ') : '';
  const FROM = 'FROM payouts y JOIN owners o ON o.id = y.owner_id LEFT JOIN owner_statements s ON s.id = y.statement_id';

  const [rows, counts, periods] = await Promise.all([
    all<any>(env, `
      SELECT y.*, o.display_name, o.bank_name, o.bank_account_last4, substr(s.period_start, 1, 7) AS period
      ${FROM} WHERE 1 = 1 ${baseSql} ${state ? 'AND y.state = ?' : ''}
      ORDER BY CASE y.state WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,
               CASE WHEN y.state = 'paid' THEN y.paid_at END DESC NULLS LAST, y.amount DESC, y.id
      LIMIT ? OFFSET ?`, ...args, ...(state ? [state] : []), pageSize, (page - 1) * pageSize),
    all<any>(env, `SELECT y.state, COUNT(*) AS n, COALESCE(SUM(y.amount), 0) AS amount ${FROM} WHERE 1 = 1 ${baseSql} GROUP BY y.state`, ...args),
    all<any>(env, `SELECT DISTINCT substr(s.period_start, 1, 7) AS period ${FROM} WHERE s.period_start IS NOT NULL ${ownerScoped ? 'AND o.user_id = ?' : ''} ORDER BY 1 DESC`, ...(ownerScoped ? [session.userId] : [])),
  ]);
  const byState = Object.fromEntries(STATES.map(st => [st, { count: 0, amount: 0 }])) as Record<string, { count: number; amount: number }>;
  for (const c of counts) byState[c.state] = { count: Number(c.n), amount: Number(c.amount) };

  return json({
    generatedAt: new Date().toISOString(),
    filtersApplied: { state: state ?? 'all', period: period ?? 'all', q: q ?? '' },
    page, pageSize,
    total: state ? byState[state].count : STATES.reduce((n, st) => n + byState[st].count, 0),
    counts: Object.fromEntries(STATES.map(st => [st, byState[st].count])),
    outstanding: byState.failed.amount + byState.pending.amount + byState.processing.amount,
    periods: periods.map(p => p.period),
    data: (rows as any[]).map(r => ({
      id: r.id, ref: refOf('PAY', r.id), statementId: r.statement_id, period: r.period ?? null,
      ownerName: r.display_name, amount: Number(r.amount), currency: r.currency,
      state: r.state, method: METHOD_LABEL[r.method] ?? r.method,
      // Never the full account number, only the tail.
      bankName: r.bank_name, bankLast4: r.bank_account_last4,
      paidAt: r.paid_at, failureReason: r.failure_reason, source: r.source ?? 'generated',
    })),
  });
};

/** POST /api/payouts { statementIds } — creates a payout run from sent statements. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) {
    return fail('FORBIDDEN', 'You can view payouts but cannot create them. Ask a Finance Admin for access.', 403);
  }

  const { statementIds } = await request.json<{ statementIds: string[] }>();
  if (!statementIds?.length) return fail('VALIDATION', 'Select at least one statement.', 422);

  const placeholders = statementIds.map(() => '?').join(',');
  const rows = await all<any>(env, `
    SELECT s.id, s.state, s.owner_id, s.net_payout, o.bank_account_last4,
           EXISTS (SELECT 1 FROM payouts x WHERE x.statement_id = s.id) AS has_payout
    FROM owner_statements s JOIN owners o ON o.id = s.owner_id
    WHERE s.id IN (${placeholders})`, ...statementIds);

  const created: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const s of rows) {
    if (s.state !== 'sent' && s.state !== 'paid') {
      skipped.push({ id: s.id, reason: 'Cannot pay out. The statement has not been sent to the owner.' });
      continue;
    }
    // Sending a statement already creates its payout (statements/send.ts); a second row would pay the owner twice.
    if (s.has_payout) {
      skipped.push({ id: s.id, reason: 'This statement already has a payout.' });
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
  if (!session.manage) return fail('FORBIDDEN', 'Finance access is required.', 403);

  const b = await request.json<{ id: string; state: string; failureReason?: string }>().catch(() => null);
  const { id, state, failureReason } = b ?? ({} as { id: string; state: string; failureReason?: string });
  if (!['processing', 'paid', 'failed'].includes(state)) return fail('VALIDATION', 'Unknown payout state.', 422);

  const before = await one<any>(env, 'SELECT state, statement_id FROM payouts WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That payout no longer exists.', 404);
  if (before.state === 'paid') return fail('CONFLICT', 'That payout is already paid.', 409);
  if (state === 'failed' && !failureReason?.trim()) return fail('VALIDATION', 'Say why it failed.', 422, { failureReason: 'Give the reason the bank gave.' });

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
