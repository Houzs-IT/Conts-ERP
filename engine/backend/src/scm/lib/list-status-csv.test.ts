import { describe, expect, it } from 'vitest';
import { knownSoStatuses } from './so-list-read';
import { knownDoStatuses } from './do-list-read';
import { inArm, supplierIdsByName } from './so-ref-search';

/* The phone's convert picker asks the lists for several statuses at once (audit 20 Nov 2026). Only real enum labels
   may reach Postgres: an unknown one fails the whole read with 22P02. */
describe('comma status lists on the SO and DO lists', () => {
  it('keeps real SO statuses, drops the rest', () => {
    expect(knownSoStatuses('CONFIRMED,reno_confirmed, DELIVERED,BOGUS,CONFIRMED')).toEqual(['CONFIRMED', 'RENO_CONFIRMED', 'DELIVERED']);
  });
  it('keeps real DO statuses, drops the rest', () => {
    expect(knownDoStatuses('LOADED,DISPATCHED,COMPLETED,signed')).toEqual(['LOADED', 'DISPATCHED', 'SIGNED']);
    expect(knownDoStatuses('NOPE,')).toEqual([]);
  });
});

describe('the PO search also finds a supplier by name', () => {
  it('reads supplier ids by name or code, capped, and adds them as a search arm', async () => {
    const calls: string[] = [];
    const sb = {
      from: (t: string) => ({
        select: () => ({
          or: (f: string) => { calls.push(`${t}:${f}`); return { limit: () => Promise.resolve({ data: [{ id: 's1' }, { id: 's1' }, { id: 's2' }], error: null }) }; },
        }),
      }),
    } as never;
    expect(await supplierIdsByName(sb, 'Acme')).toEqual(['s1', 's2']);
    expect(calls).toEqual(['suppliers:name.ilike.%Acme%,code.ilike.%Acme%']);
    expect(await supplierIdsByName(sb, 'a')).toEqual([]);
    expect(inArm('supplier_id', ['s1'])).toEqual(['supplier_id.in.("s1")']);
  });
});
