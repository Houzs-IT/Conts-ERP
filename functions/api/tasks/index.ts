import { type Env, all, one, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 25), 100);
  const mine = isFieldRole(session.role);

  const args: unknown[] = [];
  if (state) args.push(state);
  if (mine) args.push(session.userId);
  args.push(pageSize, (page - 1) * pageSize);

  const rows = await all(env, `
    SELECT t.*, u.unit_number, p.name AS property_name, COALESCE(a.full_name,'') AS assignee_name,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photo_count
    FROM tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE 1 = 1 ${state ? 'AND t.state = ?' : ''} ${mine ? 'AND t.assignee_id = ?' : ''}
    ORDER BY t.due_at
    LIMIT ? OFFSET ?`, ...args);

  const total = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM tasks');
  return json({
    generatedAt: new Date().toISOString(),
    total: total?.n ?? 0,
    page,
    data: rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      instructions: r.instructions,
      kind: r.kind,
      state: r.state,
      unitNumber: r.unit_number,
      propertyName: r.property_name,
      assigneeName: r.assignee_name || null,
      dueAt: r.due_at,
      scheduledFor: r.scheduled_for,
      completedAt: r.completed_at,
      requiresPhoto: !!r.requires_photo,
      photoCount: r.photo_count ?? 0,
      sync: r.sync,
    })),
  });
};
