import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { hasBilling, DAY } from '../../_lib/maintenance';

/** Accounts payable (owner, 11 Oct 2026: "expenses I treat as AP, done by finance"): what the company owes outside
 *  people and whether it has been paid. Today that is the technician or contractor on a maintenance job
 *  (maintenance_issues.contractor_amount and contractor_paid_at, migration 0108); bills entered as expenses carry
 *  no paid date yet. Finance has no access to the Operations area, so the paid date is recorded here, not through
 *  /api/maintenance. Nothing here touches the expense rows that unit costs and owner statements read. */

const FROM = `FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
  WHERE m.contractor_amount IS NOT NULL AND m.contractor_amount > 0`;

/** GET /api/finance/payables?paid=no|yes|all&q= — contractor claims, the unpaid ones first (oldest billing date
 *  first), with counts and the amount still owed across every claim. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Accounts payable is visible to finance and management roles.', 403);

  if (!(await hasBilling(env))) {
    return json({ generatedAt: nowIso(), ready: false, data: [], counts: { unpaid: 0, paid: 0 }, owed: 0 });
  }
  const sp = new URL(request.url).searchParams;
  const paid = sp.get('paid') === 'yes' ? 'yes' : sp.get('paid') === 'all' ? 'all' : 'no';
  const q = sp.get('q')?.trim() || null;
  const where: string[] = [], args: unknown[] = [];
  if (paid === 'no') where.push('m.contractor_paid_at IS NULL');
  if (paid === 'yes') where.push('m.contractor_paid_at IS NOT NULL');
  if (q) {
    where.push(`(m.vendor_name ILIKE ? OR m.title ILIKE ? OR (p.name || ' ' || u.unit_number) ILIKE ?)`);
    const like = `%${q.replace(/[%_\\]/g, c => '\\' + c)}%`;
    args.push(like, like, like);
  }
  const extra = where.length ? ` AND ${where.join(' AND ')}` : '';

  const [rows, totals] = await Promise.all([
    all<any>(env, `
      SELECT m.id, m.title, m.state, m.vendor_name, m.assignee_kind, m.charge_to, m.billing_date, m.resolved_at,
             m.contractor_amount, m.contractor_paid_at, u.id AS unit_id, u.unit_number, p.name AS property_name
      ${FROM}${extra}
      ORDER BY (m.contractor_paid_at IS NULL) DESC,
               CASE WHEN m.contractor_paid_at IS NULL THEN COALESCE(m.billing_date, substr(m.resolved_at, 1, 10)) END ASC NULLS LAST,
               m.contractor_paid_at DESC, m.id
      LIMIT 500`, ...args),
    one<any>(env, `
      SELECT COUNT(*) FILTER (WHERE m.contractor_paid_at IS NULL) AS unpaid,
             COUNT(*) FILTER (WHERE m.contractor_paid_at IS NOT NULL) AS paid,
             COALESCE(SUM(m.contractor_amount) FILTER (WHERE m.contractor_paid_at IS NULL), 0) AS owed
      ${FROM}`),
  ]);

  return json({
    generatedAt: nowIso(), ready: true, paid,
    counts: { unpaid: Number(totals?.unpaid ?? 0), paid: Number(totals?.paid ?? 0) },
    owed: Number(totals?.owed ?? 0),
    data: rows.map(r => ({
      id: r.id, title: r.title, state: r.state, payee: r.vendor_name ?? null, payeeKind: r.assignee_kind ?? null,
      chargeTo: r.charge_to, billingDate: r.billing_date ?? null, finishedAt: r.resolved_at ?? null,
      amount: Number(r.contractor_amount), paidOn: r.contractor_paid_at ?? null,
      unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
    })),
  });
};

/** POST /api/finance/payables { maintenanceId, paidOn: 'YYYY-MM-DD' | null } — record the day accounts paid the
 *  technician or contractor for a job, or clear it. The same column the Maintenance screen's money section writes. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can record a payment.', 403);
  if (!(await hasBilling(env))) return fail('NOT_CONFIGURED', 'Contractor payments need a database update (migration 0108) that is not applied yet.', 501);

  const b = await request.json<any>().catch(() => null);
  const id = typeof b?.maintenanceId === 'string' ? b.maintenanceId : '';
  if (!id) return fail('VALIDATION', 'Pick the job to record.', 422);
  const paidOn = b?.paidOn ?? null;
  if (paidOn !== null && (typeof paidOn !== 'string' || !DAY.test(paidOn))) return fail('VALIDATION', 'Pick the day it was paid.', 422, { paidOn: 'Pick the day it was paid.' });

  const cur = await one<any>(env, 'SELECT id, contractor_amount, contractor_paid_at FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (!(Number(cur.contractor_amount) > 0)) return fail('CONFLICT', 'Nothing is owed on this job. Enter the amount owed on the maintenance job first.', 409);

  await run(env, 'UPDATE maintenance_issues SET contractor_paid_at = ?, updated_at = ? WHERE id = ?', paidOn, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.edit', entityTable: 'maintenance_issues', entityId: id,
    before: { contractorPaidAt: cur.contractor_paid_at ?? null }, after: { contractorPaidAt: paidOn },
  });
  return json({ ok: true, paidOn });
};
