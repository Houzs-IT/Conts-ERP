/* A job card from a draft DO: the PO is the one the row links, the place reads as the unit. Mark complete needs its proof. */
import { describe, expect, it } from 'vitest';
import { completeProblem, jobOf, type DraftJobRow } from './draft-deliveries';

const row: DraftJobRow = {
  id: 'd1', do_number: 'TC-DO-1', due: '2026-11-07', time_range: ' 10:30 ', building: 'KL 48', unit_no: 'B-35-13A', project_code: 'RN-1', project_name: 'Test',
  so_doc_no: 'TC-SO-1', items: '[{"code":"A","description":"Board","qty":2,"uom":"PCS"}]', pos: [{ poNumber: 'TC-PO-1', supplier: 'Kim Hup' }],
};

describe('jobOf', () => {
  it('reads the unit, the time and the linked PO', () => {
    expect(jobOf(row)).toMatchObject({ place: 'KL 48 B-35-13A', time: '10:30', projectCode: 'RN-1', pos: [{ poNumber: 'TC-PO-1', supplier: 'Kim Hup' }] });
    expect(jobOf(row).items).toHaveLength(1);
  });
  it('a job with no linked PO shows none, never a guess', () => {
    expect(jobOf({ ...row, pos: [] }).pos).toEqual([]);
  });
  it('falls back to the project, then the order', () => {
    expect(jobOf({ ...row, building: null, unit_no: null }).place).toBe('Test');
    expect(jobOf({ ...row, building: null, unit_no: null, project_name: null }).place).toBe('TC-SO-1');
  });
});

describe('completeProblem', () => {
  it('asks for at least one photo and a name', () => {
    expect(completeProblem({ podKeys: [], receivedBy: 'Ali' })).toMatch(/photo/);
    expect(completeProblem({ podKeys: ['a'], receivedBy: '  ' })).toMatch(/received/);
    expect(completeProblem({ podKeys: ['a'], receivedBy: 'Ali' })).toBeNull();
  });
});
