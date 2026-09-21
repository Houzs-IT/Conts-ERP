import { type Env, all, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ownerFor } from '../../_lib/ownerScope';

/** GET /api/owner/property-health — maintenance on the owner's units: everything open, plus what was finished in the last 90 days.
 *  Factual, owner-safe wording only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const owner = await ownerFor(env, session, new URL(request.url));
  if (owner instanceof Response) return owner;

  const rows = await all<any>(env, `
    SELECT m.id, m.title, m.detail, m.state, m.vendor_name, m.quoted_amount, m.final_amount, m.charge_to, m.reported_at, m.resolved_at,
           u.unit_number, p.name AS property_name
    FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ? AND (m.state != 'resolved' OR m.resolved_at::timestamptz > now() - interval '90 days')
    ORDER BY (m.state = 'waiting' AND m.owner_approval_required = 1 AND m.owner_approved_at IS NULL) DESC, m.reported_at DESC LIMIT 30`, owner.id);

  return json({
    issues: rows.map(i => ({
      id: i.id, unitLabel: `${i.property_name} ${i.unit_number}`, title: i.title, detail: i.detail, state: i.state,
      quotedAmount: i.quoted_amount, finalAmount: i.final_amount, vendorName: i.vendor_name, chargeTo: i.charge_to,
      reportedAt: String(i.reported_at).slice(0, 10), resolvedAt: i.resolved_at ? String(i.resolved_at).slice(0, 10) : null,
    })),
  });
};
