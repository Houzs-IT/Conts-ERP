import { describe, expect, it } from 'vitest';
import { readPoSchedule } from './renovation-po-schedule';
import type { RenoDb } from './renovation-db';

/* The PO was raised at RM 1,000 (stored 300 / 700), then amended to RM 2,000. */
const db = {
  q: async (sql: string) => {
    if (/from scm\.purchase_orders po/.test(sql)) return [{ id: 'p', po_number: 'PO-1', status: 'SUBMITTED', total_sen: 200_000, supplier_id: 's', supplier_name: 'S', line_count: 1, open_lines: 1, project_id: null }];
    if (/from scm\.reno_po_instalments i where/.test(sql)) {
      return [
        { id: 'a', seq: 1, label: 'Mobilise', pct_bp: 3000, amount_sen: 30_000, payable_on: 'ON_CONFIRM', released_at: null, released_by: null, release_note: '', paid_sen: 30_000 },
        { id: 'b', seq: 2, label: 'Completion', pct_bp: 7000, amount_sen: 70_000, payable_on: 'MANUAL', released_at: null, released_by: null, release_note: '', paid_sen: 0 },
      ];
    }
    return [];
  },
} as unknown as RenoDb;

describe('a PO schedule after an amendment', () => {
  it('reads what is due from the PO as it stands', async () => {
    const v = await readPoSchedule(db, 'p', 1);
    expect(v.instalments.map((i) => i.amountSen)).toEqual([60_000, 140_000]);
    expect(v.instalments[0]?.outstandingSen).toBe(30_000);
    expect(v.totals.scheduledSen).toBe(200_000);
  });
});
