/* What finance corrects on a voucher goes back to the requests and claims it pays (chew, 16 Nov 2026). Pinned:
     · a request alone on the voucher takes its payee; a request paid by this voucher alone takes its lines and total,
       keeping what was first asked;
     · on a voucher to several payees the line's payee prefix is not carried back; a claim takes its lines and total;
     · a part-paid request paid by an earlier voucher too keeps its lines; a cancelled voucher carries nothing. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { syncFromVoucherBestEffort } from './voucher-sync';

const req = (id: string, payee: string, amount: number) => ({ id, status: 'SUBMITTED', payee_name: payee, supplier_id: null, amount_sen: amount, asked_lines: null });
const qline = (id: string, q: string, amount: number, description: string) => ({ id, request_id: q, department: 'rental', sub_department_id: null, unit_id: null, maintenance_issue_id: null, project_id: null, account_code: null, amount_sen: amount, description, sort: 0 });
const pvLine = (n: number, amount: number, description: string, links: Record<string, string>) => ({ pv_id: 'PV1', line_no: n, description, amount_sen: amount, department: 'rental', sub_department_id: null, project_id: null, unit_id: null, debit_account_code: '601-0001', ...links });

describe('a voucher carries back', () => {
  test('one request: its payee, lines and total; what was asked kept', async () => {
    const sb = fakeSb({
      payment_vouchers: [{ id: 'PV1', status: 'DRAFT', payee_name: 'Tenaga Nasional Berhad', supplier_id: null, payment_request_id: 'Q1' }],
      payment_voucher_lines: [pvLine(1, 5_200, 'Electricity Oct A-12-06', { payment_request_id: 'Q1' })],
      payment_requests: [req('Q1', 'tnb', 5_000)], payment_request_lines: [qline('L1', 'Q1', 5_000, 'elec')],
      staff_receipts: [], staff_receipt_lines: [],
    });
    await syncFromVoucherBestEffort(sb, 'PV1');
    expect(sb.tables.payment_requests[0]).toMatchObject({ payee_name: 'Tenaga Nasional Berhad', amount_sen: 5_200, asked_amount_sen: 5_000 });
    expect(sb.tables.payment_request_lines.map(l => [l.description, l.amount_sen, l.account_code])).toEqual([['Electricity Oct A-12-06', 5_200, '601-0001']]);
  });
  test('several payees: no prefix carried back, payees kept; a claim takes its lines', async () => {
    const sb = fakeSb({
      payment_vouchers: [{ id: 'PV1', status: 'DRAFT', payee_name: 'Various (2)', supplier_id: null, payment_request_id: null }],
      payment_voucher_lines: [pvLine(1, 3_000, 'Ah Seng · Pipe fix', { payment_request_id: 'Q1' }), pvLine(2, 1_500, 'Siti · Detergent 5L', { staff_receipt_id: 'R1' })],
      payment_requests: [req('Q1', 'Ah Seng', 3_000)], payment_request_lines: [qline('L1', 'Q1', 3_000, 'pipe')],
      staff_receipts: [{ id: 'R1', status: 'CHECKED', payback_pv_id: 'PV1', amount_sen: 1_400 }],
      staff_receipt_lines: [{ id: 'RL1', receipt_id: 'R1', department: 'rental', unit_id: null, maintenance_issue_id: null, project_id: null, account_code: '601-0002', amount_sen: 1_400, description: 'detergent', sort: 0 }],
    });
    await syncFromVoucherBestEffort(sb, 'PV1');
    expect(sb.tables.payment_requests[0]).toMatchObject({ payee_name: 'Ah Seng' });
    expect(sb.tables.payment_request_lines.map(l => l.description)).toEqual(['Pipe fix']);
    expect(sb.tables.staff_receipt_lines.map(l => [l.description, l.amount_sen])).toEqual([['Detergent 5L', 1_500]]);
    expect(sb.tables.staff_receipts[0]).toMatchObject({ amount_sen: 1_500 });
  });
  test('paid by an earlier voucher too: lines kept; a cancelled voucher carries nothing', async () => {
    const sb = fakeSb({
      payment_vouchers: [{ id: 'PV0', status: 'POSTED', payee_name: 'Ah Seng', payment_request_id: 'Q1' }, { id: 'PV1', status: 'DRAFT', payee_name: 'Ah Seng', supplier_id: null, payment_request_id: 'Q1' }],
      payment_voucher_lines: [{ pv_id: 'PV0', line_no: 1, amount_sen: 1_000, payment_request_id: 'Q1' }, pvLine(1, 2_000, 'rest', { payment_request_id: 'Q1' })],
      payment_requests: [{ ...req('Q1', 'Ah Seng', 3_000), status: 'PART_PAID' }], payment_request_lines: [qline('L1', 'Q1', 3_000, 'pipe')],
      staff_receipts: [], staff_receipt_lines: [],
    });
    await syncFromVoucherBestEffort(sb, 'PV1');
    expect(sb.tables.payment_request_lines.map(l => [l.description, l.amount_sen])).toEqual([['pipe', 3_000]]);
    sb.tables.payment_vouchers[1]!.status = 'CANCELLED';
    sb.tables.payment_vouchers[1]!.payee_name = 'Someone else';
    await syncFromVoucherBestEffort(sb, 'PV1');
    expect(sb.tables.payment_requests[0]).toMatchObject({ payee_name: 'Ah Seng' });
  });
});
