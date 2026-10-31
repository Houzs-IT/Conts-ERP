import { describe, expect, it, test } from 'vitest';
import { NOT_IN_A_ROOM, categoryLabel, categoryRooms, roomGroups, roomLabel, roomOrdered } from './so-print-rooms';

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
  const groups: Record<string, string> = { 'RN-ELECTRICAL': 'WORKS', 'RN-WARDROBE': 'BUILTIN', 'CUR-GEN-DOUBLE': 'SOFT' };
  const items = [
    { id: 'a', item_code: 'RN-ELECTRICAL', total_sen: 100 },
    { id: 'b', item_code: 'RN-WARDROBE', total_sen: 200 },
    { id: 'c', item_code: 'RENO-DISCOUNT', total_sen: -50 },
    { id: 'd', item_code: 'CUR-GEN-DOUBLE', total_sen: 300 },
    { id: 'e', item_code: 'RN-ELECTRICAL', total_sen: 400 },
  ];
  it('labels each line by its catalog category, in the fixed category order', () => {
    const r = categoryRooms(items, (code) => groups[code]);
    expect(r.order).toEqual(['Built-in', 'Works', 'Soft furnishing']);
    expect(r.byItem).toEqual({ a: 'Works', b: 'Built-in', d: 'Soft furnishing', e: 'Works' });
  });
  it('groups with subtotals, a line outside the catalog last under Other items', () => {
    const g = roomGroups(items, categoryRooms(items, (code) => groups[code]));
    expect(g.map((x) => [x.area, x.lines.map((l) => l.id), x.subtotalSen])).toEqual([
      ['Built-in', ['b'], 200], ['Works', ['a', 'e'], 500], ['Soft furnishing', ['d'], 300], ['Other items', ['c'], -50],
    ]);
  });
  it('names an unknown category plainly', () => {
    expect(categoryLabel('KITCHEN_APPLIANCE')).toBe('Kitchen appliance');
    expect(categoryLabel(null)).toBeNull();
  });
});
