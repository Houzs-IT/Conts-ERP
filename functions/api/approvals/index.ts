import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { VIEW_SQL, APPROVAL_KINDS, KIND_LABEL, decideContext, toView, pendingFor } from '../../_lib/approvals';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

/** GET /api/approvals?view=pending|decided&status=&kind=&q=&mine=1&page=&pageSize=
 *  Money requests waiting for a second person, or already decided. Counts per status and kind come back with every
 *  page, so the tabs and chips never depend on the page shown.
 *  GET /api/approvals?entity=reservations&entityId=... returns only the pending ones on that record (the banner). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Approvals are for management, finance and operations managers.', 403);

  const url = new URL(request.url);
  const entity = url.searchParams.get('entity');
  if (entity) return json({ data: await pendingFor(env, session, entity, url.searchParams.get('entityId')) });

  const view = url.searchParams.get('view') === 'decided' ? 'decided' : 'pending';
  const status = url.searchParams.get('status');
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q')?.trim() || null;
  const mine = url.searchParams.get('mine') === '1';
  if (status && !STATUSES.includes(status)) return fail('VALIDATION', 'Unknown status.', 422);
  if (kind && !(APPROVAL_KINDS as readonly string[]).includes(kind)) return fail('VALIDATION', 'Unknown request type.', 422);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 50)));

  const base: string[] = [], args: unknown[] = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    base.push('(a.summary ILIKE ? OR a.reason ILIKE ? OR rq.full_name ILIKE ?)'); args.push(like, like, like);
  }
  if (mine) { base.push('a.requested_by = ?'); args.push(session.userId); }
  const baseSql = base.length ? 'AND ' + base.join(' AND ') : '';
  const viewSql = view === 'pending' ? "a.status = 'pending'" : status ? 'a.status = ?' : "a.status <> 'pending'";
  const viewArgs = view === 'decided' && status ? [status] : [];
  const FROM = 'FROM approval_requests a JOIN users rq ON rq.id = a.requested_by';

  const [rows, totals, kinds, ctx] = await Promise.all([
    all<any>(env, `${VIEW_SQL} WHERE ${viewSql} ${kind ? 'AND a.kind = ?' : ''} ${baseSql}
      ORDER BY ${view === 'pending' ? 'a.requested_at' : 'a.decided_at DESC'}, a.id LIMIT ? OFFSET ?`,
      ...viewArgs, ...(kind ? [kind] : []), ...args, pageSize, (page - 1) * pageSize),
    all<{ status: string; n: number; amount: number }>(env, `SELECT a.status, COUNT(*)::int AS n, COALESCE(SUM(a.amount), 0)::bigint AS amount
      ${FROM} WHERE 1 = 1 ${kind ? 'AND a.kind = ?' : ''} ${baseSql} GROUP BY a.status`, ...(kind ? [kind] : []), ...args),
    all<{ kind: string; n: number }>(env, `SELECT a.kind, COUNT(*)::int AS n ${FROM} WHERE ${viewSql} ${baseSql} GROUP BY a.kind`, ...viewArgs, ...args),
    decideContext(env),
  ]);
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, { count: 0, amount: 0 }])) as Record<string, { count: number; amount: number }>;
  for (const t of totals) byStatus[t.status] = { count: Number(t.n), amount: Number(t.amount) };
  const decided = byStatus.approved.count + byStatus.rejected.count + byStatus.cancelled.count;

  return json({
    generatedAt: nowIso(), view, page, pageSize,
    total: view === 'pending' ? byStatus.pending.count : status ? byStatus[status].count : decided,
    counts: { pending: byStatus.pending.count, decided, approved: byStatus.approved.count, rejected: byStatus.rejected.count, cancelled: byStatus.cancelled.count },
    pendingAmount: byStatus.pending.amount,
    kinds: APPROVAL_KINDS.map(k => ({ value: k, label: KIND_LABEL[k], count: Number(kinds.find(x => x.kind === k)?.n ?? 0) })),
    rules: {
      enabled: ctx.enabled, financeAdminLimit: ctx.settings.financeAdminLimit, expenseThreshold: ctx.settings.expenseThreshold, managementCount: ctx.managementCount,
      you: session.role === 'management' ? 'any' : session.role === 'finance_admin' ? 'below_limit' : 'none',
    },
    data: rows.map(r => toView(r, session, ctx)),
  });
};
