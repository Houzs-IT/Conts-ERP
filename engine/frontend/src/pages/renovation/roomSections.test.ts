import { describe, expect, test } from 'vitest';
import { insertRoomSections } from './roomSections';

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
