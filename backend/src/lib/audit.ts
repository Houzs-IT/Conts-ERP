import type { Sql } from 'postgres';

type AuditEntry = {
  actorId: string | null;
  action: string;                 // 'user.invite', 'role.permissions.set', ...
  entity: string;                 // 'profile', 'role', 'department', ...
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

/** Never let an audit failure break the request it was recording. */
export async function writeAudit(db: Sql, e: AuditEntry): Promise<void> {
  try {
    await db`
      insert into app.audit_log (actor_id, action, entity, entity_id, before, after, ip, user_agent)
      values (${e.actorId}, ${e.action}, ${e.entity}, ${e.entityId ?? null},
              ${e.before ? db.json(e.before as never) : null},
              ${e.after ? db.json(e.after as never) : null},
              ${e.ip ?? null}, ${e.userAgent ?? null})
    `;
  } catch (err) {
    console.error('audit write failed', err);
  }
}
