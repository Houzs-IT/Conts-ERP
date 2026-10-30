/* Which status moves the contract page offers (chew, 30 Oct 2026: an in-progress contract may be cancelled too, by
   the same rules as a confirmed one; the server gate is acc/reno-ledger cancelGate and renovation-so). */
import { describe, expect, test } from 'vitest';
import { CONTRACT_NEXT_STATUS } from './api';

describe('contract status moves', () => {
  test('Cancel contract is offered on a confirmed and on an in-progress contract, never later', () => {
    const cancels = (s: string) => (CONTRACT_NEXT_STATUS[s] ?? []).some((n) => n.to === 'CANCELLED' && n.label === 'Cancel contract' && n.danger === true);
    expect(cancels('RENO_CONFIRMED')).toBe(true);
    expect(cancels('RENO_IN_PROGRESS')).toBe(true);
    expect(cancels('RENO_COMPLETED')).toBe(false);
    expect(CONTRACT_NEXT_STATUS.RENO_IN_PROGRESS.map((n) => n.to)).toEqual(['RENO_COMPLETED', 'CANCELLED']);
  });
});
