import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const CATEGORIES = ['housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'owner') {
    return fail('FORBIDDEN', 'Expenses are visible to finance and management roles.', 403);
  }

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const unitId = url.searchParams.get('unitId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const args: unknown[] = [];
  if (category) args.push(category);
  if (unitId) args.push(unitId);
  if (from) args.push(from);
  if (to) args.push(to);
  // Owners only ever see lines that reached their own statements.
  if (session.role === 'owner') args.push(session.userId);

  const rows = await all(env, `
    SELECT e.*, u.unit_number, p.name AS property_name
    FROM expenses e
    JOIN units u ON u.id = e.unit_id
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    WHERE 1 = 1
      ${category ? 'AND e.category = ?' : ''}
      ${unitId ? 'AND e.unit_id = ?' : ''}
      ${from ? 'AND e.incurred_on >= ?' : ''}
      ${to ? 'AND e.incurred_on <= ?' : ''}
      ${session.role === 'owner' ? 'AND o.user_id = ?' : ''}
    ORDER BY e.incurred_on DESC`, ...args);

  const total = (rows as any[]).reduce((s, r) => s + r.amount, 0);

  return json({
    generatedAt: new Date().toISOString(),
    filtersApplied: { category: category ?? 'all', unitId: unitId ?? 'all', from: from ?? '', to: to ?? '' },
    total, currency: 'MYR',
    data: (rows as any[]).map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      category: r.category, description: r.description,
      amount: r.amount, currency: r.currency,
      incurredOn: r.incurred_on, reference: r.reference, chargeTo: r.charge_to,
    })),
  });
};

/** Every deduction needs a category, an amount and a date — that is what makes
 *  an owner statement explainable. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) {
    return fail('FORBIDDEN', 'You can view expenses but cannot add them. Ask a Finance Admin for access.', 403);
  }

  const b = await request.json<any>();
  const fields: Record<string, string> = {};
  if (!b.unitId) fields.unitId = 'A unit is required.';
  if (!CATEGORIES.includes(b.category)) fields.category = 'Choose a category.';
  if (typeof b.amount !== 'number' || b.amount < 0) fields.amount = 'Enter an amount of RM 0.00 or more.';
  if (!b.incurredOn) fields.incurredOn = 'A date is required.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Every expense needs a category, amount and date.', 422, fields);

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO expenses (id, unit_id, maintenance_id, task_id, category, description, amount, currency, incurred_on, reference, charge_to, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?)`,
    id, b.unitId, b.maintenanceId ?? null, b.taskId ?? null, b.category,
    b.description ?? '', b.amount, b.incurredOn, b.reference ?? null,
    b.chargeTo ?? 'owner', session.userId, nowIso());

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'expense.create',
    entityTable: 'expenses', entityId: id, after: b,
  });
  return json({ id }, 201);
};
