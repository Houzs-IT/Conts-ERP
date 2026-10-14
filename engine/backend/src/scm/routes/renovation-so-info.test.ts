import { describe, expect, test } from 'vitest';
import { readRenovationBlock, renovationSoProblems } from './renovation-so-info';
import { soRouterSource } from '../../../tests/lib/so-router-source';

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
    expect(p.map((x) => x.field)).toEqual(['Bedrooms', 'Delivery address', 'Layout', 'Built-up sq ft']);
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
