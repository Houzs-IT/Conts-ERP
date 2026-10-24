/* Customers and suppliers imported from AutoCount's chart (Conts, finance phase 1.5; spec section 3): every SDR
   sub-account becomes a debtor under its control, every SCR one a supplier; the suppliers the ERP already holds are
   matched by name and take AutoCount's code. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { importParties, suggestSupplierMatches, type ParsedParty } from './parties';

const CO = 1;
const P = (code: string, name: string, controlCode: string, kind: ParsedParty['kind']): ParsedParty => ({ code, name, controlCode, kind });

describe('importing parties', () => {
  test('imports debtors under their control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [] });
    const r = await importParties(sb, CO, [P('301-M001', 'MS YAP (MAPLE A10-02)', '301-0000', 'DEBTOR')], {});
    expect(r).toMatchObject({ debtors: 1, creditors: 0, errors: [] });
    expect(sb.tables.debtors[0]).toMatchObject({ company_id: CO, code: '301-M001', name: 'MS YAP (MAPLE A10-02)', control_account: '301-0000', is_active: true });
  });

  test('a second import keeps a name finance changed', async () => {
    const sb = fakeSb({ debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS YAP', control_account: '301-0000', is_active: true }], suppliers: [] });
    const r = await importParties(sb, CO, [P('301-M001', 'MS YAP (MAPLE A10-02)', '301-0000', 'DEBTOR')], {});
    expect(r).toMatchObject({ debtors: 0, kept: 1 });
    expect(sb.tables.debtors).toHaveLength(1);
    expect(sb.tables.debtors[0].name).toBe('MS YAP');
  });

  test('a matched supplier takes the AutoCount code and control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 'sup-h', company_id: CO, code: 'HOOKKA', name: 'HOOKKA INDUSTRIES SDN BHD', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR')], { '400-H006': 'sup-h' });
    expect(r).toMatchObject({ creditors: 0, renamed: 1, errors: [] });
    expect(sb.tables.suppliers).toHaveLength(1);
    expect(sb.tables.suppliers[0]).toMatchObject({ code: '400-H006', control_account: '400-0000', name: 'HOOKKA INDUSTRIES SDN BHD' });
  });

  test('an unmatched creditor becomes a new supplier', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [] });
    const r = await importParties(sb, CO, [P('405-O001', 'OC - ABNB ELECTRICAL', '405-0000', 'CREDITOR')], {});
    expect(r).toMatchObject({ creditors: 1 });
    expect(sb.tables.suppliers[0]).toMatchObject({ company_id: CO, code: '405-O001', name: 'OC - ABNB ELECTRICAL', control_account: '405-0000' });
  });

  test('a supplier already holding the AutoCount code only gains its control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 's1', company_id: CO, code: '400-A001', name: 'AR RAYYAN', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-A001', 'AR RAYYAN SHAH RESOURCES', '400-0000', 'CREDITOR')], {});
    expect(r).toMatchObject({ creditors: 0, kept: 1 });
    expect(sb.tables.suppliers[0]).toMatchObject({ name: 'AR RAYYAN', control_account: '400-0000' });
  });

  test('a match naming a supplier of another company is a row error', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 'x', company_id: 2, code: 'HOOKKA', name: 'HOOKKA', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR')], { '400-H006': 'x' });
    expect(r.errors[0]).toMatchObject({ code: '400-H006' });
    expect(sb.tables.suppliers[0].code).toBe('HOOKKA');
  });
});

describe('suggesting supplier matches', () => {
  const existing = [
    { id: 'h', code: 'HOOKKA', name: 'HOOKKA INDUSTRIES SDN BHD' },
    { id: 'l', code: 'LOTWIN', name: 'LOT WIN LED LIGHTINGS (PUCHONG) SDN BHD' },
    { id: 'd', code: 'DHI', name: 'DHI FLOOR' },
    { id: 'k', code: 'KKGYPSUM', name: 'K & K GYPSUM MARKETING SDN BHD' },
  ];
  const parties = [
    P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR'),
    P('400-H004', 'HIN LIM FURNITURE MANUFACTURER SDN BHD', '400-0000', 'CREDITOR'),
    P('400-L001', 'LOT WIN LED LIGHTINGS', '400-0000', 'CREDITOR'),
    P('400-K003', 'K & K GYPSUM MARKETING SDN BHD', '400-0000', 'CREDITOR'),
    P('301-M001', 'MS DHI', '301-0000', 'DEBTOR'),
  ];

  test('pairs HOOKKA, LOT WIN and K & K, and nothing for DHI FLOOR', () => {
    expect(suggestSupplierMatches(existing, parties)).toEqual({ '400-H006': 'h', '400-L001': 'l', '400-K003': 'k' });
  });

  test('a supplier already on its AutoCount code is not offered again', () => {
    expect(suggestSupplierMatches([{ id: 'h', code: '400-H006', name: 'HOOKKA' }], parties)).toEqual({});
  });
});
