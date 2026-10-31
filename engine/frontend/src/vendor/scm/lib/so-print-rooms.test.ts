import { describe, expect, it, test } from 'vitest';
import { NOT_IN_A_ROOM, categoryRooms, roomGroups, roomLabel, roomOrdered } from './so-print-rooms';

const rooms = { order: ['Living hall', 'Bedroom 1'], byItem: { a: 'bedroom 1', b: 'Living hall', c: '', d: 'Gone', e: 'Living hall' } };

describe('lines room by room', () => {
  test('room order first, then lines in no room; line order kept inside a room', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    expect(roomOrdered(items, rooms).map((x) => x.id)).toEqual(['b', 'e', 'a', 'c', 'd']);
  });

  test('a line prints under its room as listed, or under Other items', () => {
    expect(roomLabel(rooms, 'a')).toBe('Bedroom 1');
    expect(roomLabel(rooms, 'd')).toBe(NOT_IN_A_ROOM);
  });
});

describe('categoryRooms (By category, owner 31 Oct 2026)', () => {
  /* names and order as the catalog tables hold them, not as this code guesses them */
  const names = {
    groups: [{ code: 'WORKS', label: 'Works' }, { code: 'BUILTIN', label: 'Built-in' }, { code: 'SOFT', label: 'Soft furnishing' }],
    subs: [
      { group: 'WORKS', code: 'ELECTRICAL', label: 'Electrical', sort: 50 },
      { group: 'WORKS', code: 'PLUMBING', label: 'Plumbing', sort: 30 },
      { group: 'BUILTIN', code: 'WARDROBE', label: 'Wardrobe', sort: 20 },
      { group: 'SOFT', code: 'BED_LINEN', label: 'Bed linen', sort: 20, legacy: ['BEDLINES'] },
    ],
  };
  const products: Record<string, { group: string; sub: string | null }> = {
    'RN-ELECTRICAL': { group: 'WORKS', sub: 'ELECTRICAL' }, 'RN-PLUMB': { group: 'WORKS', sub: 'PLUMBING' },
    'RN-WARDROBE': { group: 'BUILTIN', sub: 'WARDROBE' }, 'SHEET-1': { group: 'SOFT', sub: 'BEDLINES' }, 'SOFT-X': { group: 'SOFT', sub: null },
  };
  const items = [
    { id: 'a', item_code: 'RN-ELECTRICAL', total_sen: 100 },
    { id: 'b', item_code: 'RN-WARDROBE', total_sen: 200 },
    { id: 'c', item_code: 'RENO-DISCOUNT', total_sen: -50 },
    { id: 'd', item_code: 'SHEET-1', total_sen: 300 },
    { id: 'e', item_code: 'RN-PLUMB', total_sen: 400 },
    { id: 'f', item_code: 'SOFT-X', total_sen: 10 },
  ];
  it('labels each line "Category · Sub-category" from the catalog, in the catalog order', () => {
    const r = categoryRooms(items, (code) => products[code], names);
    expect(r.order).toEqual(['Works · Plumbing', 'Works · Electrical', 'Built-in · Wardrobe', 'Soft furnishing · Bed linen', 'Soft furnishing']);
    expect(r.byItem).toEqual({ a: 'Works · Electrical', b: 'Built-in · Wardrobe', d: 'Soft furnishing · Bed linen', e: 'Works · Plumbing', f: 'Soft furnishing' });
  });
  it('groups with subtotals, a line outside the catalog last under Other items', () => {
    const g = roomGroups(items, categoryRooms(items, (code) => products[code], names));
    expect(g.map((x) => [x.area, x.lines.map((l) => l.id), x.subtotalSen])).toEqual([
      ['Works · Plumbing', ['e'], 400], ['Works · Electrical', ['a'], 100], ['Built-in · Wardrobe', ['b'], 200],
      ['Soft furnishing · Bed linen', ['d'], 300], ['Soft furnishing', ['f'], 10], ['Other items', ['c'], -50],
    ]);
  });
});
