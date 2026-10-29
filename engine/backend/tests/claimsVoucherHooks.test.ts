/* What a payment voucher settles when it posts or is cancelled (Conts; design 2026-10-28 §4.5-4.6). Pinned:
     · posting a top-up records the money paid in and marks the checked receipts topped up; cancelling it puts the
       float and every receipt back exactly as they were;
     · posting a pay-back marks the receipt paid back; cancelling makes it payable again;
     · a request is part paid, then paid, as its vouchers post, and steps back when one is cancelled;
     · a failure inside a hook never throws. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../src/scm/lib/fake-postgrest';
import { afterVoucherCancelledBestEffort, afterVoucherPostedBestEffort } from '../src/conts/claims-voucher-hooks';
import { floatBalance } from '../src/conts/petty-cash';
import { requestStatus, requestReservation } from '../src/conts/payment-requests';

const world = () => fakeSb({
  petty_cash_floats: [{ id: 'F1', company_id: 1, float_sen: 100000 }],
  petty_cash_events: [{ id: 'E0', float_id: 'F1', kind: 'PAID_IN', amount_sen: 100000, event_date: '2026-11-01', pv_id: null }],
  staff_receipts: [
    { id: 'R1', company_id: 1, float_id: 'F1', amount_sen: 4500, status: 'CHECKED', topup_pv_id: null, payback_pv_id: null },
    { id: 'R2', company_id: 1, float_id: 'F1', amount_sen: 1000, status: 'HANDED_IN', topup_pv_id: null, payback_pv_id: null },
    { id: 'R3', company_id: 1, float_id: null, amount_sen: 3000, status: 'CHECKED', topup_pv_id: null, payback_pv_id: 'PVB' },
  ],
  payment_requests: [{ id: 'Q1', amount_sen: 10000, status: 'SUBMITTED' }],
  payment_vouchers: [
    { id: 'PVT', voucher_date: '2026-11-30', status: 'POSTED', petty_cash_float_id: 'F1', staff_receipt_id: null, payment_request_id: null },
    { id: 'PVB', voucher_date: '2026-11-30', status: 'POSTED', petty_cash_float_id: null, staff_receipt_id: 'R3', payment_request_id: null },
    { id: 'PVQ1', voucher_date: '2026-11-30', status: 'POSTED', petty_cash_float_id: null, staff_receipt_id: null, payment_request_id: 'Q1' },
    { id: 'PVQ2', voucher_date: '2026-12-05', status: 'DRAFT', petty_cash_float_id: null, staff_receipt_id: null, payment_request_id: 'Q1' },
  ],
  payment_voucher_lines: [
    { pv_id: 'PVT', amount_sen: 5500 }, { pv_id: 'PVB', amount_sen: 3000 }, { pv_id: 'PVQ1', amount_sen: 4000 }, { pv_id: 'PVQ2', amount_sen: 6000 },
  ],
});
const balance = (sb: ReturnType<typeof world>) => floatBalance(
  sb.tables.petty_cash_events.map(e => ({ kind: e.kind as 'PAID_IN', amountSen: Number(e.amount_sen) })),
  sb.tables.staff_receipts.filter(r => r.float_id === 'F1').map(r => ({ amountSen: Number(r.amount_sen), status: r.status as 'CHECKED' })),
);

describe('a top-up voucher', () => {
  test('posting pays the keeper and tops up the checked receipts; cancelling undoes both', async () => {
    const sb = world();
    const before = { balance: balance(sb), statuses: sb.tables.staff_receipts.map(r => r.status) };
    await afterVoucherPostedBestEffort(sb, 'PVT');
    expect(balance(sb)).toBe(before.balance + 5500);
    expect(sb.tables.staff_receipts.map(r => r.status)).toEqual(['TOPPED_UP', 'HANDED_IN', 'CHECKED']);
    await afterVoucherCancelledBestEffort(sb, 'PVT');
    expect(balance(sb)).toBe(before.balance);
    expect(sb.tables.staff_receipts.map(r => r.status)).toEqual(before.statuses);
    expect(sb.tables.staff_receipts[0].topup_pv_id).toBeNull();
  });
});

describe('a pay-back voucher', () => {
  test('posting pays the receipt back; cancelling makes it payable again', async () => {
    const sb = world();
    await afterVoucherPostedBestEffort(sb, 'PVB');
    expect(sb.tables.staff_receipts[2]).toMatchObject({ status: 'PAID_BACK', payback_pv_id: 'PVB' });
    await afterVoucherCancelledBestEffort(sb, 'PVB');
    expect(sb.tables.staff_receipts[2]).toMatchObject({ status: 'CHECKED', payback_pv_id: null });
  });
});

describe('a request', () => {
  test('part paid, then paid, as its vouchers post; back when one is cancelled', async () => {
    const sb = world();
    await afterVoucherPostedBestEffort(sb, 'PVQ1');
    expect(sb.tables.payment_requests[0].status).toBe('PART_PAID');
    sb.tables.payment_vouchers[3].status = 'POSTED';
    await afterVoucherPostedBestEffort(sb, 'PVQ2');
    expect(sb.tables.payment_requests[0].status).toBe('PAID');
    sb.tables.payment_vouchers[3].status = 'CANCELLED';
    await afterVoucherCancelledBestEffort(sb, 'PVQ2');
    expect(sb.tables.payment_requests[0].status).toBe('PART_PAID');
  });
  test('status and reservation rules', () => {
    expect(requestStatus(10000, 0, 'SUBMITTED')).toBe('SUBMITTED');
    expect(requestStatus(10000, 4000, 'SUBMITTED')).toBe('PART_PAID');
    expect(requestStatus(10000, 10000, 'PART_PAID')).toBe('PAID');
    expect(requestStatus(10000, 4000, 'CLOSED')).toBe('CLOSED');
    expect([...requestReservation([{ projectId: 7, amountSen: 10000 }, { projectId: null, amountSen: 500 }], [{ projectId: 7, amountSen: 4000 }])]).toEqual([[7, 6000]]);
    expect([...requestReservation([{ projectId: 7, amountSen: 4000 }], [{ projectId: 7, amountSen: 4000 }])]).toEqual([]);
  });
});

describe('failures', () => {
  test('a hook that cannot read never throws', async () => {
    const sb = fakeSb({}, { payment_vouchers: ['id'] });
    await expect(afterVoucherPostedBestEffort(sb, 'X')).resolves.toBeUndefined();
    await expect(afterVoucherCancelledBestEffort(sb, 'X')).resolves.toBeUndefined();
  });
});
