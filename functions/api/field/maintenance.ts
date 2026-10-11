import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { windowsFor, staysOverlapping, mytToday, type RepairWindow, type Overlap } from '../../_lib/cleaning';

const mytDayOf = (iso: string) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);

/** GET /api/field/maintenance?view=todo|history — the repairs given to the signed-in technician's ACCOUNT.
 *  todo: work not yet done, each in a bucket: overdue (every agreed window is over), today (a window today, or no
 *  time agreed yet: do it as soon as possible) or upcoming (the next window is on a later day), with the windows,
 *  the unit's address and access, and who is staying in the unit now or during the next window.
 *  history: work this person finished (newest first, the last 100). Never carries quotes, costs or who pays. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const history = new URL(request.url).searchParams.get('view') === 'history';

  const rows = await all<any>(env, `
    SELECT m.id, m.unit_id, m.title, m.detail, m.state, m.category, m.urgency, m.blocks_unit, m.reported_at, m.started_at, m.ended_at,
           m.resolved_at, m.done_note, m.owner_approval_required, m.owner_approved_at, m.charge_to,
           u.unit_number, p.id AS property_id, p.name AS property_name, p.address_line, mt.name AS template_name,
           (SELECT c.instruction FROM access_credentials c WHERE c.unit_id = u.id ORDER BY c.updated_at DESC LIMIT 1) AS access_instruction,
           (SELECT COUNT(*)::int FROM documents d WHERE d.maintenance_id = m.id AND d.kind IN ('photo','video')) AS photo_count,
           (SELECT COUNT(*)::int FROM maintenance_checklist_items c WHERE c.issue_id = m.id) AS steps,
           (SELECT COUNT(*)::int FROM maintenance_checklist_items c WHERE c.issue_id = m.id AND c.done_at IS NOT NULL) AS steps_done
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN maintenance_templates mt ON mt.id = m.template_id
    WHERE m.assignee_id = ? AND ${history ? `(m.state = 'resolved' OR m.ended_at IS NOT NULL)` : `m.state != 'resolved' AND m.ended_at IS NULL`}
    ORDER BY ${history ? 'COALESCE(m.ended_at, m.resolved_at) DESC' : 'm.reported_at'} LIMIT ${history ? 100 : 500}`, session.userId);

  const windows = await windowsFor(env, rows.map(r => r.id));
  const today = mytToday();
  const now = Date.now();
  const stayNow = new Map<string, Overlap | null>();

  const data = [];
  for (const r of rows) {
    const ws: RepairWindow[] = windows.get(r.id) ?? [];
    const next = ws.find(w => Date.parse(w.endsAt) > now) ?? null;
    let bucket: 'overdue' | 'today' | 'upcoming' = 'today';
    if (!history) {
      if (ws.length && !next) bucket = 'overdue';
      else if (next && Date.parse(next.startsAt) > now && mytDayOf(next.startsAt) > today) bucket = 'upcoming';
    }
    // Who is in the unit right now: the technician knocks first.
    if (!history && !stayNow.has(r.unit_id)) {
      const from = new Date(now).toISOString(), to = new Date(now + 60e3).toISOString();
      stayNow.set(r.unit_id, (await staysOverlapping(env, r.unit_id, from, to))[0] ?? null);
    }
    const guest = history ? null : stayNow.get(r.unit_id) ?? null;
    data.push({
      id: r.id, unitId: r.unit_id, title: r.title, detail: r.detail ?? null, state: r.state, category: r.category ?? 'other', urgency: r.urgency ?? 'normal',
      blocksUnit: !!r.blocks_unit, reportedAt: r.reported_at, startedAt: r.started_at ?? null, endedAt: r.ended_at ?? null, resolvedAt: r.resolved_at ?? null,
      doneNote: r.done_note ?? null, templateName: r.template_name ?? null,
      waitingForOwner: !!r.owner_approval_required && !r.owner_approved_at && r.charge_to === 'owner',
      unit: { unitNumber: r.unit_number, propertyName: r.property_name }, buildingId: r.property_id,
      addressLine: String(r.address_line ?? '').replace(/[\s,]+$/, ''), accessInstruction: r.access_instruction ?? null,
      photoCount: Number(r.photo_count), checklist: { done: Number(r.steps_done), total: Number(r.steps) },
      windows: ws.map(w => ({ id: w.id, startsAt: w.startsAt, endsAt: w.endsAt, note: w.note, guests: w.overlaps.map(o => ({ guestName: o.guestName, checkOut: o.checkOut, checkOutTime: o.checkOutTime })) })),
      nextWindow: next ? { startsAt: next.startsAt, endsAt: next.endsAt } : null,
      bucket: history ? null : bucket,
      guestNow: guest ? { guestName: guest.guestName, checkOut: guest.checkOut, checkOutTime: guest.checkOutTime } : null,
    });
  }
  const order = { overdue: 0, today: 1, upcoming: 2 } as const;
  if (!history) {
    data.sort((a, b) => order[a.bucket!] - order[b.bucket!]
      || (a.urgency === b.urgency ? 0 : a.urgency === 'urgent' ? -1 : 1)
      || (a.nextWindow?.startsAt ?? '9').localeCompare(b.nextWindow?.startsAt ?? '9')
      || a.reportedAt.localeCompare(b.reportedAt));
  }
  return json({ generatedAt: nowIso(), today, view: history ? 'history' : 'todo', rows: data });
};
