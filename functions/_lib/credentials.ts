import { mayRun } from './access';
import { hasColumn, type Session } from './auth';
import type { Env } from './db';

/** Offered for new items. The old kinds (smart_lock, key_box, guard_desk) stay valid below for rows saved before. */
export const CREDENTIAL_KINDS = [
  'smartlock_key', 'main_door_key', 'room_key', 'mailbox_key', 'yard_key', 'balcony_key',
  'smartlock_pin', 'mailbox_pin', 'lockbox_pin', 'wifi',
  'card', 'lift_card', 'parking_card', 'two_in_one_card',
  'smart_lock', 'key_box', 'guard_desk',
];

/** Who an access item may be handed to. Every item starts with all five (migration 0147). */
export const CREDENTIAL_USERS = ['maintenance', 'cleaner', 'guest', 'sales', 'management'] as const;
export type CredentialUser = typeof CREDENTIAL_USERS[number];

export const usedByReady = (env: Env): Promise<boolean> => hasColumn(env, 'access_credentials', 'used_by').catch(() => false);

/** ` AND <alias>.used_by @> '["who"]'::jsonb` once migration 0147 is in, else ''. No `?` here: the db helpers turn every `?` into a parameter. */
export async function usedBySql(env: Env, alias: string, who: CredentialUser): Promise<string> {
  return (await usedByReady(env)) ? ` AND ${alias}.used_by @> '["${who}"]'::jsonb` : '';
}

/** Who may see a code in the clear, and so who may set one: the same people. */
export const CREDENTIAL_ROLES = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)
export const mayEditCredentials = (s: Session) => mayRun(s, CREDENTIAL_ROLES);

export interface CredentialInput {
  unitId?: string; kind?: string; label?: string; secret?: string | null; instruction?: string; rotatesAfterStay?: boolean; usedBy?: string[];
}

/** The first problem with the input, or null. `partial` is a PATCH: only what is present is checked. */
export function invalidCredential(b: CredentialInput, partial: boolean): { field: string; message: string } | null {
  if (!partial && !b.unitId) return { field: 'unitId', message: 'Say which unit.' };
  if ((!partial || b.kind !== undefined) && !CREDENTIAL_KINDS.includes(String(b.kind))) return { field: 'kind', message: 'Pick the type of access.' };
  if ((!partial || b.label !== undefined) && !String(b.label ?? '').trim()) return { field: 'label', message: 'Name it, e.g. Main door.' };
  if (b.label !== undefined && String(b.label).length > 120) return { field: 'label', message: 'Keep the name under 120 characters.' };
  if ((!partial || b.instruction !== undefined) && !String(b.instruction ?? '').trim()) return { field: 'instruction', message: 'Write the instruction guests and staff are given.' };
  if (b.instruction !== undefined && String(b.instruction).length > 1000) return { field: 'instruction', message: 'Keep the instruction under 1000 characters.' };
  if (b.usedBy !== undefined) {
    const u = b.usedBy;
    if (!Array.isArray(u) || u.length === 0 || u.some(x => !(CREDENTIAL_USERS as readonly unknown[]).includes(x)) || new Set(u).size !== u.length)
      return { field: 'usedBy', message: 'Pick who uses it: Maintenance, Cleaner, Guest, Sales or Management, at least one.' };
  }
  if (b.secret != null && String(b.secret).length > 200) return { field: 'secret', message: 'Keep the code under 200 characters.' };
  return null;
}
