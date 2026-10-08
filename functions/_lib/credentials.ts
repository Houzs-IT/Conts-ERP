import { mayRun } from './access';
import type { Session } from './auth';

export const CREDENTIAL_KINDS = ['smart_lock', 'key_box', 'guard_desk', 'lift_card', 'wifi'];

/** Who may see a code in the clear, and so who may set one: the same people. */
export const CREDENTIAL_ROLES = ['management', 'operations_manager'];
export const mayEditCredentials = (s: Session) => mayRun(s, CREDENTIAL_ROLES);

export interface CredentialInput {
  unitId?: string; kind?: string; label?: string; secret?: string | null; instruction?: string; rotatesAfterStay?: boolean;
}

/** The first problem with the input, or null. `partial` is a PATCH: only what is present is checked. */
export function invalidCredential(b: CredentialInput, partial: boolean): { field: string; message: string } | null {
  if (!partial && !b.unitId) return { field: 'unitId', message: 'Say which unit.' };
  if ((!partial || b.kind !== undefined) && !CREDENTIAL_KINDS.includes(String(b.kind))) return { field: 'kind', message: 'Pick the type of access.' };
  if ((!partial || b.label !== undefined) && !String(b.label ?? '').trim()) return { field: 'label', message: 'Name it, e.g. Main door.' };
  if (b.label !== undefined && String(b.label).length > 120) return { field: 'label', message: 'Keep the name under 120 characters.' };
  if ((!partial || b.instruction !== undefined) && !String(b.instruction ?? '').trim()) return { field: 'instruction', message: 'Write the instruction guests and staff are given.' };
  if (b.instruction !== undefined && String(b.instruction).length > 1000) return { field: 'instruction', message: 'Keep the instruction under 1000 characters.' };
  if (b.secret != null && String(b.secret).length > 200) return { field: 'secret', message: 'Keep the code under 200 characters.' };
  return null;
}
