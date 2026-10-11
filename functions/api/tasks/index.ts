import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE, hhmm, slaFor, SHEET_CLEANER, ON_TASK_SQL } from '../../_lib/ops';

const STATES = ['open', 'assigned', 'in_progress', 'waiting', 'overdue', 'reopened', 'resolved'];
const KINDS = ['turnover', 'deep_clean', 'light_clean', 'inspection', 'maintenance', 'delivery', 'other'];
const CLEANING = ['turnover', 'deep_clean', 'light_clean'];
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** GET /api/tasks — the work list, one page at a time.
 *  ?state=active (default, everything not done) | all | <state>
 *  &kind=all | cleaning | <kind>  &building=<property id>  &assignee=none | u:<user> | c:<cleaner> | s:<sheet code>
 *  &from=&to= (task day, Malaysia)  &q= (unit, building or title)  &id=  &page=1  &pageSize=50 (or size=)
 *  &sort=day|unit|building|kind|cleaner|finished|state:asc|desc (left out: the order the state reads best in) */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const sp = new URL(request.url).searchParams;
  const state = sp.get('state') ?? 'active';
  const kind = sp.get('kind') ?? 'all';
  const building = sp.get('building');
  const assignee = sp.get('assignee');
  const from = sp.get('from'), to = sp.get('to');
  const q = (sp.get('q') ?? '').trim().slice(0, 80);
  const id = sp.get('id');
  // export=1: the table's Export reads every matching task in pages of up to 1,000.
  const pageSize = Math.min(sp.get('export') === '1' ? 1000 : 100, Math.max(1, Number(sp.get('size') ?? sp.get('pageSize')) || 50));
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1));

  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  // Every filter except state, so the state chips can show their counts under the rest.
  const where: string[] = [];
  const args: unknown[] = [];
  if (isFieldRole(session.role)) { where.push(ON_TASK_SQL('t')); args.push(session.userId, session.userId); }
  if (id) { where.push('t.id = ?'); args.push(id); }
  if (kind === 'cleaning') where.push(`t.kind IN (${CLEANING.map(k => `'${k}'`).join(',')})`);
  else if (KINDS.includes(kind)) { where.push('t.kind = ?'); args.push(kind); }
  if (building) { where.push('u.property_id = ?'); args.push(building); }
  if (assignee === 'none') where.push(`t.assignee_id IS NULL AND t.cleaner_id IS NULL AND ${SHEET_CLEANER('t')} IS NULL`);
  else if (assignee?.startsWith('u:')) { where.push('t.assignee_id = ?'); args.push(assignee.slice(2)); }
  else if (assignee?.startsWith('c:')) { where.push('(t.cleaner_id = ? OR EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id AND tc.cleaner_id = ?))'); args.push(assignee.slice(2), assignee.slice(2)); }
  else if (assignee?.startsWith('s:')) { where.push(`${SHEET_CLEANER('t')} = ?`); args.push(assignee.slice(2)); }
  if (isDate(from)) { where.push(`${day} >= ?`); args.push(from); }
  if (isDate(to)) { where.push(`${day} <= ?`); args.push(to); }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    where.push('(u.unit_number ILIKE ? OR p.name ILIKE ? OR t.title ILIKE ?)'); args.push(like, like, like);
  }
  const base = `FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id`;
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const stateWhere = state === 'active' ? `t.state != 'resolved'` : STATES.includes(state) ? 't.state = ?' : null;
  const stateArgs = STATES.includes(state) ? [state] : [];
  const full = [cond || 'WHERE TRUE', stateWhere].filter(Boolean).join(' AND ');
  // Finished work reads newest first; open work reads in the order it falls due.
  const order = state === 'resolved' ? 'DESC' : 'ASC';
  const [sortKey, sortDir] = (sp.get('sort') ?? '').split(':');
  const SORTS: Record<string, string> = {
    day, unit: 'u.unit_number', building: 'p.name', kind: 't.kind', cleaner: 'COALESCE(cl.full_name, a.full_name)',
    finished: 't.completed_at', state: 't.state',
  };
  const orderBy = SORTS[sortKey]
    ? `${SORTS[sortKey]} ${sortDir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, t.id`
    : `COALESCE(t.due_at, t.scheduled_for, t.created_at) ${order}, t.id`;

  const counts = await all<{ state: string; n: number }>(env, `SELECT t.state, COUNT(*)::int AS n ${base} ${cond} GROUP BY t.state`, ...args);
  const rows = await all<any>(env, `
    SELECT t.id, t.unit_id, t.kind, t.state, t.title, t.instructions, t.assignee_id, t.cleaner_id, t.scheduled_for, t.due_at, t.next_guest_at,
           t.requires_photo, t.sync, t.started_at, t.completed_at, u.unit_number, p.id AS property_id, p.name AS property_name, ${day} AS day,
           COALESCE(cl.full_name, a.full_name) AS assignee_name, ${SHEET_CLEANER('t')} AS sheet_cleaner,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind IN ('photo','video')) AS photo_count
    ${base}
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
    ${full}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`, ...args, ...stateArgs, pageSize, (page - 1) * pageSize);

  const byState = Object.fromEntries(counts.map(c => [c.state, Number(c.n)]));
  const total = state === 'all' ? counts.reduce((s, c) => s + Number(c.n), 0)
    : state === 'active' ? counts.filter(c => c.state !== 'resolved').reduce((s, c) => s + Number(c.n), 0)
    : byState[state] ?? 0;

  return json({
    generatedAt: nowIso(), total, page, pageSize, counts: byState,
    data: rows.map((r, i) => {
      const sla = slaFor(r.state, r.due_at);
      return {
        id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyId: r.property_id, propertyName: r.property_name,
        kind: r.kind, state: r.state, title: r.title, instructions: r.instructions, date: r.day,
        assigneeId: r.assignee_id, cleanerId: r.cleaner_id ?? null, assigneeName: r.assignee_name || null, sheetCleaner: r.sheet_cleaner ?? null,
        scheduledFor: hhmm(r.scheduled_for), dueAt: hhmm(r.due_at), nextGuestAt: hhmm(r.next_guest_at), startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
        requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
        sequence: (page - 1) * pageSize + i + 1, sync: r.sync, sla, riskRank: (page - 1) * pageSize + i + 1,
      };
    }),
  });
};
