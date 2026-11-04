import { describe, expect, test } from 'vitest';
import { projectDemandLine, type DemandRow } from './mrp';

/* Owner, 4 Nov 2026: "只要一有 delivery date，它就会排着出来". */

const row = (so: Partial<NonNullable<DemandRow['so']>> = {}): DemandRow => ({
  id: 'L1', doc_no: 'TC-SO-1', item_code: 'RN-ELECTRICAL', description: null, item_group: 'RENOVATION', variants: null, qty: 1,
  warehouse_id: null, line_delivery_date: null, line_delivery_date_overridden: false, line_no: 1, created_at: null, cancelled: false,
  allocated_batch_no: null,
  so: {
    debtor_name: null, status: 'RENO_CONFIRMED', so_date: null, customer_delivery_date: null, amended_delivery_date: null,
    processing_date: null, customer_state: null, project_id: 1, sales_location: null, ...so,
  },
});

const plan = (p: Partial<{ order_on: string | null; deliver_on: string | null; no_po: boolean }>) =>
  ({ order_on: null, deliver_on: null, no_po: false, ...p });

describe('which project lines are demand', () => {
  test('a delivery date on the PO tab is enough, no processing date needed', () => {
    const [line] = projectDemandLine(row(), plan({ deliver_on: '2026-11-18' }));
    expect(line?.line_delivery_date).toBe('2026-11-18');
    expect(line?.line_delivery_date_overridden).toBe(true);
  });

  test("the order's own delivery date is enough, with no plan row at all", () => {
    expect(projectDemandLine(row({ customer_delivery_date: '2026-11-18' }), undefined)).toHaveLength(1);
  });

  test('a processing date alone stays in, undated', () => {
    const [line] = projectDemandLine(row(), plan({ order_on: '2026-11-10' }));
    expect(line?.so?.processing_date).toBe('2026-11-10');
    expect(line?.line_delivery_date).toBeNull();
  });

  test('no date at all is not demand', () => {
    expect(projectDemandLine(row(), undefined)).toEqual([]);
    expect(projectDemandLine(row(), plan({}))).toEqual([]);
  });

  test('marked No PO stays out, whatever dates it has', () => {
    expect(projectDemandLine(row(), plan({ order_on: '2026-11-10', deliver_on: '2026-11-18', no_po: true }))).toEqual([]);
  });
});
