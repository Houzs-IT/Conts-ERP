import { type Env } from './db';
import { hasColumn } from './auth';

/** Migration 0113: a staff account's department and position, free text. The renovation pickers in the engine show
 *  them after the name ("Alex · Project PIC · Renovation"). Before the migration runs both are simply absent. */
export const userJobReady = (env: Env) => hasColumn(env, 'users', 'department').catch(() => false);

export const JOB_MAX = 80;

/** Department and position from a request body: trimmed, blank as null, only the keys that were sent.
 *  Problems go into `fields` under the same key. */
export function cleanJob(b: Record<string, unknown> | null | undefined, fields: Record<string, string>): { department?: string | null; position?: string | null } {
  const out: { department?: string | null; position?: string | null } = {};
  for (const k of ['department', 'position'] as const) {
    if (!b || !(k in b) || b[k] === undefined) continue;
    const v = b[k];
    if (v !== null && typeof v !== 'string') { fields[k] = 'Enter text.'; continue; }
    const s = (v ?? '').trim().replace(/\s+/g, ' ');
    if (s.length > JOB_MAX) { fields[k] = `${JOB_MAX} characters at most.`; continue; }
    out[k] = s || null;
  }
  return out;
}
