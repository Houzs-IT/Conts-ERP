import { describe, expect, test } from 'vitest';
import { autoRoomsPlan, generateRooms, groupByRoom, insertRoomSections, moveRoom, nextRoomName, placeRows, renameRoom } from './roomSections';

const make = (heading: string): { heading: string; made?: boolean } => ({ heading, made: true });
const heads = (r: { sections: Array<{ heading: string }> }) => r.sections.map((s) => s.heading);

describe('generate rooms from layout', () => {
  test('an empty document gets every room in order', () => {
    const r = insertRoomSections([], 2, 1, make);
    expect(heads(r)).toEqual(['Living hall', 'Bedroom 1', 'Bedroom 2', 'Bathroom 1', 'Common area']);
    expect(r.added).toHaveLength(5);
  });

  test('a studio (0 bedrooms) has no bedroom sections', () => {
    expect(heads(insertRoomSections([], 0, 1, make))).toEqual(['Living hall', 'Bathroom 1', 'Common area']);
  });

  test('rooms already there are kept in place and not duplicated (any case or spacing)', () => {
    const r = insertRoomSections([{ heading: 'living  HALL' }, { heading: 'Bedroom 2' }], 2, 1, make);
    expect(heads(r)).toEqual(['living  HALL', 'Bedroom 1', 'Bedroom 2', 'Bathroom 1', 'Common area']);
    expect(r.added).toEqual(['Bedroom 1', 'Bathroom 1', 'Common area']);
  });

  test('other sections stay; rooms go before the first existing room that follows them', () => {
    const r = insertRoomSections([{ heading: 'Kitchen' }, { heading: 'Common area' }], 1, 1, make);
    expect(heads(r)).toEqual(['Kitchen', 'Living hall', 'Bedroom 1', 'Bathroom 1', 'Common area']);
  });

  test('a second press adds nothing', () => {
    const once = insertRoomSections([], 3, 2, make);
    const twice = insertRoomSections(once.sections, 3, 2, make);
    expect(twice.added).toEqual([]);
    expect(heads(twice)).toEqual(heads(once));
  });

  test('new sections keep the document type the caller makes', () => {
    expect(insertRoomSections([], 0, 0, make).sections.every((s) => s.made)).toBe(true);
  });
});

describe('rooms on a renovation sales order', () => {
  test('generate adds only the missing rooms, Common area first, then layout order', () => {
    expect(generateRooms(['Bedroom 1', 'Kitchen'], 2, 1)).toEqual({
      rooms: ['Common area', 'Living hall', 'Bedroom 1', 'Bedroom 2', 'Bathroom 1', 'Kitchen'],
      added: ['Common area', 'Living hall', 'Bedroom 2', 'Bathroom 1'],
    });
    expect(generateRooms(['Common area'], 1, 1).rooms).toEqual(['Common area', 'Living hall', 'Bedroom 1', 'Bathroom 1']);
  });

  test('rename refuses a blank name or one another room has', () => {
    expect(renameRoom(['Living hall', 'Bedroom 1'], 'Bedroom 1', ' Master  bedroom ')).toEqual(['Living hall', 'Master bedroom']);
    expect(renameRoom(['Living hall', 'Bedroom 1'], 'Bedroom 1', 'living hall')).toBeNull();
    expect(renameRoom(['Living hall'], 'Living hall', '  ')).toBeNull();
    expect(renameRoom(['Living hall'], 'Living hall', 'LIVING HALL')).toEqual(['LIVING HALL']);
  });

  test('move swaps with the neighbour and stays inside the list', () => {
    expect(moveRoom(['A', 'B', 'C'], 1, -1)).toEqual(['B', 'A', 'C']);
    expect(moveRoom(['A', 'B'], 1, 1)).toEqual(['A', 'B']);
  });

  test('a new room gets a free default name', () => {
    expect(nextRoomName(['Room 2'])).toBe('Room 3');
    expect(nextRoomName(['Room 1', 'room 2'])).toBe('Room 3');
  });

  test('rows group under their room; a blank or unknown room is not placed', () => {
    const g = groupByRoom(['Living hall', 'Bedroom 1'], [{ room: 'bedroom 1', id: 1 }, { room: '', id: 2 }, { room: 'Gone', id: 3 }, { room: 'Living hall', id: 4 }]);
    expect(g.groups.map((x) => [x.room, x.rows.map((r) => r.id)])).toEqual([['Living hall', [4]], ['Bedroom 1', [1]]]);
    expect(g.unplaced.map((r) => r.id)).toEqual([2, 3]);
  });
});

describe('rooms made as soon as a layout is chosen', () => {
  const layout = { bedrooms: 2, bathrooms: 1 };
  test('no rooms and only the empty first line: rooms are made and the line goes into Common area', () => {
    expect(autoRoomsPlan([], [{ key: 'r1', filled: false }], layout)).toEqual({
      rooms: ['Common area', 'Living hall', 'Bedroom 1', 'Bedroom 2', 'Bathroom 1'],
      assign: { r1: 'Common area' },
    });
  });
  test('no layout, rooms already there, or a line with a product: left alone', () => {
    expect(autoRoomsPlan([], [{ key: 'r1', filled: false }], null)).toBeNull();
    expect(autoRoomsPlan(['Kitchen'], [{ key: 'r1', filled: false }], layout)).toBeNull();
    expect(autoRoomsPlan([], [{ key: 'r1', filled: true }], layout)).toBeNull();
  });
  test('an order with no lines at all still gets its rooms', () => {
    expect(autoRoomsPlan([], [], { bedrooms: 0, bathrooms: 1 })?.rooms).toEqual(['Common area', 'Living hall', 'Bathroom 1']);
  });
});

describe('every line belongs to a room', () => {
  test('no rooms yet: one Common area holds the lines', () => {
    expect(placeRows([], [{ key: 'a', room: '' }])).toEqual({ rooms: ['Common area'], roomOf: { a: 'Common area' } });
  });
  test('a line with no room, or a room no longer listed, goes under Common area (added first when missing)', () => {
    const r = placeRows(['Living hall', 'Bedroom 1'], [{ key: 'a', room: 'bedroom 1' }, { key: 'b', room: '' }, { key: 'c', room: 'Gone' }]);
    expect(r.rooms).toEqual(['Common area', 'Living hall', 'Bedroom 1']);
    expect(r.roomOf).toEqual({ a: 'Bedroom 1', b: 'Common area', c: 'Common area' });
    expect(placeRows(['Common area', 'Kitchen'], [{ key: 'x', room: '' }]).rooms).toEqual(['Common area', 'Kitchen']);
  });
  test('the starting Common area does not stop rooms being made from the layout', () => {
    expect(autoRoomsPlan(['Common area'], [{ key: 'r1', filled: false }], { bedrooms: 1, bathrooms: 1 })?.rooms)
      .toEqual(['Common area', 'Living hall', 'Bedroom 1', 'Bathroom 1']);
  });
});
