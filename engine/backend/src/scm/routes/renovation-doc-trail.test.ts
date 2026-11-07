import { describe, expect, it } from 'vitest';
import { stepOf, trailOf, type TrailRow } from './renovation-doc-trail';

const row = (over: Partial<TrailRow>): TrailRow => ({ kind: 'po', id: '1', no: 'TC-PO-1', status: 'SUBMITTED', on_hold: false, expected: '2026-11-20', started: null, done: null, who: null, ...over });

describe('stepOf', () => {
  it('a PO on its way says when it arrives, a received one when it came', () => {
    expect(stepOf(row({}))).toMatchObject({ word: 'Arrives', date: '2026-11-20', tone: 'active' });
    expect(stepOf(row({ status: 'RECEIVED', done: '2026-11-07' }))).toMatchObject({ word: 'Received', date: '2026-11-07', tone: 'done' });
  });
  it('a production order reads by what actually happened', () => {
    expect(stepOf(row({ kind: 'production' }))).toMatchObject({ word: 'Not started, due' });
    expect(stepOf(row({ kind: 'production', started: '2026-11-07' }))).toMatchObject({ word: 'In progress, due' });
    expect(stepOf(row({ kind: 'production', started: '2026-11-07', done: '2026-11-08' }))).toMatchObject({ word: 'Completed', date: '2026-11-08' });
  });
  it('a DO separates draft, confirmed and delivered', () => {
    expect(stepOf(row({ kind: 'do', status: 'DRAFT' }))).toMatchObject({ word: 'Draft delivery' });
    expect(stepOf(row({ kind: 'do', status: 'LOADED' }))).toMatchObject({ word: 'Confirmed, due' });
    expect(stepOf(row({ kind: 'do', status: 'DELIVERED', done: '2026-11-07' }))).toMatchObject({ word: 'Delivered' });
  });
  it('held and cancelled win over everything', () => {
    expect(stepOf(row({ on_hold: true })).word).toBe('On hold');
    expect(stepOf(row({ status: 'CANCELLED', done: '2026-11-07' })).word).toBe('Cancelled');
  });
});

it('trailOf keeps the flow order', () => {
  expect(trailOf([row({ kind: 'do', no: 'D' }), row({ kind: 'so', no: 'S' }), row({ kind: 'gr', no: 'G' })]).map((s) => s.kind)).toEqual(['so', 'gr', 'do']);
});
