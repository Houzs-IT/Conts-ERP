import { describe, expect, test } from 'vitest';
import { readRenovationBlock, renovationSoProblems } from './renovation-so-info';
import { soRouterSource } from '../../../tests/lib/so-router-source';
import { roomsForCreatedLines } from '../../services/renovation/customerProperty';

describe('the renovation block of a sales order', () => {
  test('reads the project, building, unit and property', () => {
    const r = readRenovationBlock({ projectId: '12', building: ' Skyline ', unitNo: 'A-1-1', propertyType: 'Condo', layoutLabel: '2 bed 2 bath', bedrooms: 2, bathrooms: '2', builtUpSqft: '950' });
    expect(r.projectId).toBe(12);
    expect(r.building).toBe('Skyline');
    expect(r.property).toEqual({ propertyType: 'Condo', layoutLabel: '2 bed 2 bath', bedrooms: 2, bathrooms: 2, builtUpSqft: 950 });
    expect(r.problems).toEqual([]);
  });

  test('a missing or bad project id is no project', () => {
    expect(readRenovationBlock({ projectId: 'abc' }).projectId).toBeNull();
    expect(readRenovationBlock(null).projectId).toBeNull();
  });

  test('the server refuses what the owner made required, and invalid numbers first', () => {
    const r = readRenovationBlock({ propertyType: 'Condo', layoutLabel: 'Odd', bedrooms: '2.5', bathrooms: '1' });
    const p = renovationSoProblems(r, { customerName: 'Tan', phone: '012', address1: '' });
    expect(p.map((x) => x.field)).toEqual(['Bedrooms', 'Address line 1', 'Layout', 'Built-up sq ft']);
  });
});

describe('the create route checks before and stamps after the core', () => {
  const raw = soRouterSource();
  const start = raw.indexOf("mfgSalesOrders.post('/', async (c) => {");
  const handler = start < 0 ? '' : raw.slice(start, raw.indexOf('\nmfgSalesOrders.', start + 10));

  test('the refusal runs before createSalesOrderCore and the stamp after it', () => {
    expect(start).toBeGreaterThan(-1);
    const refuse = handler.indexOf('renovationSoProblems(renoBlock');
    const core = handler.indexOf('createSalesOrderCore(');
    const stamp = handler.indexOf('applyRenovationSoInfo(');
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(core);
    expect(stamp).toBeGreaterThan(core);
  });

  test('a draft is not held to the renovation required fields', () => {
    expect(handler).toContain("if (peek!.asDraft !== true) {");
  });
});

describe('rooms of a new renovation SO', () => {
  test('the block carries the room list and the edit form line rooms; absent means leave them', () => {
    const r = readRenovationBlock({ roomSections: ['Living hall', 'living hall', ' Bedroom 1 '], itemRooms: { '11111111-1111-4111-8111-111111111111': ' Bedroom 1 ', bad: 'x' } });
    expect(r.roomSections).toEqual(['Living hall', 'Bedroom 1']);
    expect(r.itemRooms).toEqual([{ id: '11111111-1111-4111-8111-111111111111', room: 'Bedroom 1' }]);
    expect(readRenovationBlock({}).roomSections).toBeNull();
  });

  test('inserted lines take the sent rooms by item code in order; a line the server added gets none', () => {
    const inserted = [{ id: 'a', item_code: 'RN-PAINT' }, { id: 'b', item_code: 'FREE-GIFT' }, { id: 'c', item_code: 'RN-PAINT' }, { id: 'd', item_code: 'RN-DOOR' }];
    const sent = [{ itemCode: 'RN-PAINT', room: 'Living hall' }, { itemCode: 'RN-PAINT', room: 'Bedroom 1' }, { itemCode: 'RN-DOOR', room: '' }];
    expect(roomsForCreatedLines(inserted, sent)).toEqual([{ id: 'a', room: 'Living hall' }, { id: 'c', room: 'Bedroom 1' }]);
  });
});
