import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hhmm, slaFor } from '../../_lib/ops';

/** GET /api/tasks — the full work list: everything open, plus what was finished in the last week. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const mine = isFieldRole(session.role);
  const rows = await all<any>(env, `
    SELECT t.id, t.unit_id, t.kind, t.state, t.title, t.instructions, t.assignee_id, t.scheduled_for, t.due_at, t.next_guest_at,
           t.requires_photo, t.sync, u.unit_number, p.name AS property_name, COALESCE(a.full_name, '') AS assignee_name,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photo_count
    FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE (t.state != 'resolved' OR t.completed_at::timestamptz > now() - interval '7 days')
      ${mine ? 'AND t.assignee_id = ?' : ''}
    ORDER BY COALESCE(t.due_at, t.scheduled_for, t.created_at)`, ...(mine ? [session.userId] : []));

  const withSla = rows.map(r => ({ r, sla: slaFor(r.state, r.due_at) }));
  const ranked = [...withSla].sort((a, b) => (a.sla.state === 'none' ? 1e9 : a.sla.minutes) - (b.sla.state === 'none' ? 1e9 : b.sla.minutes));
  const rank = new Map(ranked.map((x, i) => [x.r.id, i + 1]));

  return json({
    generatedAt: nowIso(), total: rows.length,
    data: withSla.map(({ r, sla }, i) => ({
      id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
      kind: r.kind, state: r.state, title: r.title, instructions: r.instructions,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name || null,
      scheduledFor: hhmm(r.scheduled_for), dueAt: hhmm(r.due_at), nextGuestAt: hhmm(r.next_guest_at),
      requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
      sequence: i + 1, sync: r.sync, sla, riskRank: rank.get(r.id) ?? i + 1,
    })),
  });
};
