import { type Env, all } from './db';
import { windowsFor } from './cleaning';

/** One repair job as the field app shows it: where, what, how urgent, who reported it, when the technician may go in,
 *  and how far the work is. Never any amount: quotes, final cost, billing and what the technician is owed stay office-only. */
export interface FieldRepair {
  id: string; unitId: string; unitNumber: string; propertyName: string; buildingId: string; addressLine: string;
  title: string; detail: string | null; category: string; urgency: string; state: string; source: string;
  reportedAt: string; reporter: string | null; assigneeName: string | null;
  startedAt: string | null; endedAt: string | null; resolvedAt: string | null; blocksUnit: boolean;
  waitingForOwner: boolean; beforeCount: number; afterCount: number; documentCount: number;
  windows: { id: string; startsAt: string; endsAt: string; note: string | null; guestStaying: boolean }[];
}

/** Repair jobs on alias `m` matching `where` (with `args`), newest first. */
export async function fieldRepairs(env: Env, where: string, args: unknown[]): Promise<FieldRepair[]> {
  const rows = await all<any>(env, `
    SELECT m.id, m.unit_id, m.title, m.detail, m.state, m.category, m.urgency, m.source, m.reported_at, m.vendor_name,
           m.started_at, m.ended_at, m.resolved_at, m.blocks_unit, m.owner_approval_required, m.owner_approved_at, m.charge_to,
           u.unit_number, p.id AS property_id, p.name AS property_name, p.address_line, COALESCE(r.full_name, '') AS reporter,
           (SELECT COUNT(*)::int FROM documents d WHERE d.maintenance_id = m.id AND d.kind IN ('photo','video') AND d.file_name NOT LIKE 'after-%') AS before_count,
           (SELECT COUNT(*)::int FROM documents d WHERE d.maintenance_id = m.id AND d.kind IN ('photo','video') AND d.file_name LIKE 'after-%') AS after_count,
           (SELECT COUNT(*)::int FROM documents d WHERE d.maintenance_id = m.id AND d.kind NOT IN ('photo','video')) AS document_count
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN users r ON r.id = m.reported_by
    WHERE ${where}
    ORDER BY (m.urgency = 'urgent') DESC, m.reported_at DESC
    LIMIT 200`, ...args);
  const windows = await windowsFor(env, rows.map(r => r.id));
  return rows.map(r => ({
    id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name, buildingId: r.property_id,
    addressLine: String(r.address_line ?? '').replace(/[\s,]+$/, ''),
    title: r.title, detail: r.detail ?? null, category: r.category ?? 'other', urgency: r.urgency ?? 'normal', state: r.state, source: r.source ?? 'staff',
    reportedAt: r.reported_at, reporter: r.reporter || null, assigneeName: r.vendor_name ?? null,
    startedAt: r.started_at ?? null, endedAt: r.ended_at ?? null, resolvedAt: r.resolved_at ?? null, blocksUnit: !!r.blocks_unit,
    waitingForOwner: !!r.owner_approval_required && !r.owner_approved_at && r.charge_to === 'owner',
    beforeCount: Number(r.before_count), afterCount: Number(r.after_count), documentCount: Number(r.document_count),
    // Who is staying is the office's business; the technician only needs to know someone is.
    windows: (windows.get(r.id) ?? []).map(w => ({ id: w.id, startsAt: w.startsAt, endsAt: w.endsAt, note: w.note, guestStaying: w.overlaps.length > 0 })),
  }));
}
