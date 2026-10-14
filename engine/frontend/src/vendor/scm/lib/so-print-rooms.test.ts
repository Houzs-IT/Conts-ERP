import { describe, expect, test } from 'vitest';
import { NOT_IN_A_ROOM, roomLabel, roomOrdered } from './so-print-rooms';

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
