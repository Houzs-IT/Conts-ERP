import { type Env, all, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const KL_TODAY = `to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** GET /api/dashboard/exceptions — what needs a person, highest risk first. One action per row. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const out: Record<string, unknown>[] = [];

  // 1. Turnovers that will not be ready before the next guest.
  const risky = await all<any>(env, `
    SELECT t.id, t.state, t.assignee_id, t.next_guest_at, t.due_at, u.id AS unit_id, u.unit_number, p.name AS property_name, u.readiness,
           EXTRACT(EPOCH FROM (t.next_guest_at::timestamptz - now())) / 60 AS minutes_left
    FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    WHERE t.state != 'resolved' AND t.kind IN ('turnover','deep_clean','light_clean')
      AND t.next_guest_at IS NOT NULL
      AND t.next_guest_at::timestamptz BETWEEN now() - interval '6 hours' AND now() + interval '24 hours'
      AND (t.assignee_id IS NULL OR t.state = 'overdue')
    ORDER BY t.next_guest_at LIMIT 5`);
  for (const r of risky) {
    const mins = Math.round(Number(r.minutes_left));
    const label = `${r.property_name} ${r.unit_number}`;
    out.push({
      id: `risk-${r.id}`, tone: 'critical',
      title: mins > 0 ? `Check-in at risk in ${mins} minutes` : 'Check-in is overdue',
      detail: `${label} is ${String(r.readiness).replace('_', ' ')}${r.assignee_id ? '' : ' with no cleaner assigned'}. Guest arrives ${hhmm(r.next_guest_at)}.`,
      action: { label: 'Assign cleaner', taskId: r.id },
      unitId: r.unit_id, unitLabel: label, nextGuestAt: hhmm(r.next_guest_at),
      slaLabel: mins > 0 ? `Due in ${mins} min` : `Overdue ${-mins} min`,
    });
  }

  // 2. Units taken off sale for maintenance where the owner has not been told.
  const blocked = await all<any>(env, `
    SELECT m.id, m.title, m.blocked_from, m.blocked_to, u.id AS unit_id, u.unit_number, u.base_rate, p.name AS property_name,
           o.id AS owner_id, o.display_name AS owner_name
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    WHERE m.state != 'resolved' AND m.blocks_unit = 1
    ORDER BY m.reported_at DESC LIMIT 3`);
  for (const b of blocked) {
    const label = `${b.property_name} ${b.unit_number}`;
    const from = b.blocked_from ?? null, to = b.blocked_to ?? null;
    const nights = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5)) : 1;
    out.push({
      id: `block-${b.id}`, tone: 'warning',
      title: 'Unit blocked for maintenance',
      detail: `${label} is off sale while ${String(b.title).toLowerCase()} is dealt with. Tell the owner.`,
      action: { label: 'Notify owner' },
      unitId: b.unit_id, unitLabel: label, owner: { id: b.owner_id, name: b.owner_name },
      reason: b.title,
      datesBlocked: from && to ? `${day(from)} – ${day(to)}` : 'Dates not set',
      revenueAtRisk: session.manage ? Number(b.base_rate) * nights : undefined,
      expectedReturn: to ? day(to) : undefined,
    });
  }

  // 3. Finalised statements waiting to go out.
  const stmts = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM owner_statements WHERE state = 'finalised'`);
  if (session.manage && Number(stmts?.n) > 0) {
    const n = Number(stmts!.n);
    out.push({
      id: 'statements-ready', tone: 'info',
      title: `${n} statement${n === 1 ? '' : 's'} ready to send`,
      detail: 'Owner statements are finalised and waiting to go out.',
      action: { label: 'Review and send' },
    });
  }

  // 4. Listed units with nothing booked over the next two weeks.
  const empty = await all<any>(env, `
    WITH d AS (SELECT ${KL_TODAY} AS today)
    SELECT u.id, u.unit_number, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id, d
    WHERE u.is_listed = 1 AND u.readiness NOT IN ('maintenance','blocked')
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.unit_id = u.id AND r.state IN ('confirmed','checked_in') AND r.channel NOT IN ('maintenance_block')
          AND r.check_in < to_char(d.today::date + 14, 'YYYY-MM-DD') AND r.check_out > d.today)
    ORDER BY p.name, u.unit_number LIMIT 3`);
  for (const e of empty) {
    const label = `${e.property_name} ${e.unit_number}`;
    out.push({
      id: `empty-${e.id}`, tone: 'warning',
      title: 'No bookings in the next two weeks',
      detail: `${label} is listed but has nothing booked. Check the rate.`,
      action: { label: 'Open pricing' }, unitId: e.id, unitLabel: label,
    });
  }

  return json({ generatedAt: new Date().toISOString(), exceptions: out });
};
