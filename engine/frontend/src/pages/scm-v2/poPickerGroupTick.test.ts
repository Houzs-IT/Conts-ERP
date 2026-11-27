import { describe, expect, test } from 'vitest';
import type { OutstandingSoItem } from '../../vendor/scm/lib/suppliers-queries';
import { planGroupTick } from './poPickerGroupTick';

const line = (id: string, mainSupplierCode: string | null): OutstandingSoItem =>
  ({ soItemId: id, mainSupplierCode } as unknown as OutstandingSoItem);

describe('planGroupTick: a project checkbox ticks one supplier', () => {
  const mixed = [line('1', null), line('2', 'OAK'), line('3', 'LUM'), line('4', 'OAK')];

  test('nothing locked: the first bound supplier, with the unbound lines', () => {
    const plan = planGroupTick(mixed, null);
    expect(plan.supplier).toBe('OAK');
    expect(plan.rideOn.map((r) => r.soItemId)).toEqual(['1', '2', '4']);
    expect(plan.skipped).toBe(1);
  });

  test('a locked supplier wins over the project order', () => {
    const plan = planGroupTick(mixed, 'LUM');
    expect(plan.rideOn.map((r) => r.soItemId)).toEqual(['1', '3']);
    expect(plan.skipped).toBe(2);
  });

  test('no bound line at all: every line rides, none skipped', () => {
    const plan = planGroupTick([line('1', null), line('2', null)], null);
    expect(plan).toEqual({ rideOn: [line('1', null), line('2', null)], skipped: 0, supplier: null });
  });
});
