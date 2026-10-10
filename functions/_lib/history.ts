import { type Env, run, nowIso } from './db';

/** Only what changed between two snapshots of a record, as the before / after an audit row keeps. */
export function changedFields(was: Record<string, unknown>, now: Record<string, unknown>) {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const a = was[k] ?? null, b = now[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) { before[k] = a; after[k] = b; }
  }
  return { before, after };
}

export interface AuditEntry {
  actorId: string | null; actorLabel: string; action: string; entityTable: string; entityId: string;
  before?: unknown; after?: unknown; source?: string;
}

/** Many audit rows in one statement, for actions that touch many records at once (generating a month of statements). */
export async function auditMany(env: Env, entries: AuditEntry[]) {
  const at = nowIso();
  for (let i = 0; i < entries.length; i += 1000) {
    const rows = entries.slice(i, i + 1000).map(e => ({
      actor_id: e.actorId, actor_label: e.actorLabel, action: e.action, entity_table: e.entityTable, entity_id: e.entityId,
      before_state: e.before ? JSON.stringify(e.before) : null, after_state: e.after ? JSON.stringify(e.after) : null,
      source: e.source ?? 'web', occurred_at: at,
    }));
    await run(env, `
      INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
      SELECT x.actor_id, x.actor_label, x.action, x.entity_table, x.entity_id, x.before_state, x.after_state, x.source, x.occurred_at
      FROM jsonb_to_recordset(?::text::jsonb) AS x(actor_id text, actor_label text, action text, entity_table text, entity_id text,
        before_state text, after_state text, source text, occurred_at text)`, JSON.stringify(rows));
  }
}
