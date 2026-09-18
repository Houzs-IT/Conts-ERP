import { type Env, all, json } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const fmtMin = (min: number) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} m` : ''}`;

/** Operations Today shows this per row; Housekeeping (same endpoint) ignores it.
 *  Computed here, not stored, so "on time" naturally becomes "overdue" as the
 *  clock passes due_at without anyone having to update a row. */
function sla(state: string, dueAt: string | null): { label: string; tone: 'success' | 'warning' | 'critical' | 'neutral' } {
  if (state === 'resolved') return { label: 'Done', tone: 'success' };
  if (!dueAt) return { label: 'No due time', tone: 'neutral' };
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60000);
  if (minutes < 0) return { label: `Overdue ${fmtMin(-minutes)}`, tone: 'critical' };
  if (minutes < 120) return { label: `Due in ${fmtMin(minutes)}`, tone: 'warning' };
  return { label: 'On track', tone: 'success' };
}

/** GET /api/housekeeping/tasks?date=&assignee= — the roster for one day. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  // Field roles only ever see their own work.
  const mine = isFieldRole(session.role);
  const rows = await all(env, `
    SELECT t.id, t.kind, t.state, t.title, t.instructions, t.scheduled_for, t.due_at,
           t.next_guest_at, t.requires_photo, t.assignee_id,
           u.unit_number, u.readiness, p.name AS property_name, p.address_line,
           COALESCE(a.full_name, '') AS assignee_name
    FROM tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.kind IN ('turnover','deep_clean','light_clean')
      AND date(COALESCE(t.scheduled_for, t.due_at)) = ?
      ${mine ? 'AND t.assignee_id = ?' : ''}
    ORDER BY t.due_at`,
    ...(mine ? [date, session.userId] : [date]));

  return json({
    generatedAt: new Date().toISOString(),
    date,
    rows: rows.map((r: any) => ({
      id: r.id, kind: r.kind, state: r.state, title: r.title, instructions: r.instructions,
      unitNumber: r.unit_number, propertyName: r.property_name, readiness: r.readiness,
      addressLine: r.address_line,
      scheduledFor: r.scheduled_for, dueAt: r.due_at, nextGuestAt: r.next_guest_at,
      requiresPhoto: !!r.requires_photo,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name || null,
      sla: sla(r.state, r.due_at),
    })),
  });
};
