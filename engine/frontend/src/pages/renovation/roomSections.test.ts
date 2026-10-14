import { describe, expect, test } from 'vitest';
import { generateRooms, groupByRoom, insertRoomSections, moveRoom, nextRoomName, renameRoom } from './roomSections';

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
  test('generate adds only the missing rooms, in layout order', () => {
    expect(generateRooms(['Bedroom 1', 'Kitchen'], 2, 1)).toEqual({
      rooms: ['Living hall', 'Bedroom 1', 'Bedroom 2', 'Bathroom 1', 'Common area', 'Kitchen'],
      added: ['Living hall', 'Bedroom 2', 'Bathroom 1', 'Common area'],
    });
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
