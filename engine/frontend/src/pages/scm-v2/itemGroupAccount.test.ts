import { describe, expect, test, vi } from 'vitest';
vi.mock('./accounting-phase1-queries', () => ({ useItemGroups: () => ({ data: undefined }) }));
import { accountForGroup, groupForAccount, type ItemGroupAccount } from './itemGroupAccount';

const G: ItemGroupAccount[] = [
  { code: 'WORKS', name: 'Works', purchaseAccount: '601-0010' },
  { code: 'BUILTIN', name: 'Built-in', purchaseAccount: '602-0000' },
  { code: 'LIGHTING', name: 'Lighting', purchaseAccount: '602-0000' },
  { code: 'FURNITURE', name: 'Furniture', purchaseAccount: null },
];

describe('a stock group and its purchase account fill each other', () => {
  test('the group fills its account, whatever the case; an unbound group leaves it', () => {
    expect(accountForGroup(G, 'works')).toBe('601-0010');
    expect(accountForGroup(G, 'FURNITURE')).toBeNull();
  });
  test('an account one group buys on names it; two groups on it keep the line its own; another clears a bound group', () => {
    expect(groupForAccount(G, '601-0010', null)).toBe('WORKS');
    expect(groupForAccount(G, '602-0000', 'lighting')).toBe('LIGHTING');
    expect(groupForAccount(G, '602-0000', null)).toBeNull();
    expect(groupForAccount(G, '900-0001', 'FURNITURE')).toBe('FURNITURE');
    expect(groupForAccount(G, '900-0001', 'WORKS')).toBeNull();
  });
});
