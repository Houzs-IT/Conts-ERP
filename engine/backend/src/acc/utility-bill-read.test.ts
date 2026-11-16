/* Reading one utility bill page (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 1). Pinned: money in
   sen from what is printed, masks kept, nothing invented (an unreadable amount is null, never 0), Sonnet 5.5 only. */
import { describe, expect, test } from 'vitest';
import { UTILITY_READ_MODEL, UTILITY_READ_SCHEMA, coerceUtilityRead, readFailed, readUtilityPage } from './utility-bill-read';

const answer = (json: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: JSON.stringify(json) }], ...extra }), { status: 200, headers: { 'content-type': 'application/json' } });
const PAGE = { mime: 'image/jpeg', dataBase64: btoa('jpeg') };

describe('coerceUtilityRead', () => {
  test('ringgit to sen, masks kept, dates only when ISO', () => {
    const r = coerceUtilityRead({ kind: 'electricity', amountDue: 'RM 1,311.18', deposit: '998.38', accountNoVisible: '2104010945XX02', billMonth: '2026-09', periodFrom: '2026-08-15', periodTo: '14/09/2026' });
    expect(r).toMatchObject({ kind: 'electricity', amountDueSen: 131118, depositSen: 99838, accountNoVisible: '2104010945XX02', billMonth: '2026-09', periodFrom: '2026-08-15', periodTo: null });
  });
  test('an unreadable amount is null, never 0; an unknown kind is other', () => {
    const r = coerceUtilityRead({ kind: 'gas', amountDue: 'see overleaf' });
    expect(r.amountDueSen).toBeNull();
    expect(r.kind).toBe('other');
    expect(readFailed(r)).toBe(true);
    expect(readFailed(coerceUtilityRead({ currentCharges: '10.00', billMonth: '2026-10' }))).toBe(false);
  });
});

/* chew 3 Nov 2026, after the September TNB run: a bill goes to the month its period ENDS (06/08-05/09 is September),
   and what is recorded is Caj Semasa (this period's charges), never Jumlah Perlu Dibayar or Baki Terdahulu. */
/* chew 16 Nov 2026: what is paid is the current charges with their rounding (TNB Caj Semasa 314.24 + Pelarasan
   Penggenapan 0.01 = 314.25; Unifi 94.34 + 0.01 = 94.35), and a bill's later pages are known by "Page 1 of 5". */
describe('the rounding and the pages of a bill', () => {
  test('the rounding is added to the current charges; a misread one (more than a few sen) is left out', () => {
    expect(coerceUtilityRead({ currentCharges: '314.24', rounding: '0.01', amountDue: '314.25' })).toMatchObject({ currentChargesSen: 31425, roundingSen: 1, amountDueSen: 31425 });
    expect(coerceUtilityRead({ currentCharges: '94.37', rounding: '-0.02' }).currentChargesSen).toBe(9435);
    expect(coerceUtilityRead({ currentCharges: '100.00', rounding: '' }).currentChargesSen).toBe(10000);
    expect(coerceUtilityRead({ currentCharges: '100.00', rounding: '12.00' })).toMatchObject({ currentChargesSen: 10000, roundingSen: null });
    expect(coerceUtilityRead({ currentCharges: '', rounding: '0.01' }).currentChargesSen).toBeNull();
  });
  test('the page number and the number of pages, as printed', () => {
    expect(coerceUtilityRead({ pageNo: '1', pageCount: '5' })).toMatchObject({ pageNo: 1, pageCount: 5 });
    expect(coerceUtilityRead({ pageNo: '', pageCount: 'two' })).toMatchObject({ pageNo: null, pageCount: null });
  });
});

describe('the month and the amount finance records', () => {
  test('the bill month is the month the printed period ends, whatever the model said', () => {
    expect(coerceUtilityRead({ billMonth: '2026-08', periodFrom: '2026-08-06', periodTo: '2026-09-05', currentCharges: '377.50' }).billMonth).toBe('2026-09');
    expect(coerceUtilityRead({ billMonth: '2026-10', periodFrom: '', periodTo: '', currentCharges: '1.00' }).billMonth).toBe('2026-10');
  });

  test('a period that makes no sense (reversed, or longer than about three months) leaves the month the model read', () => {
    expect(coerceUtilityRead({ billMonth: '2026-09', periodFrom: '2026-08-06', periodTo: '2026-05-09' }).billMonth).toBe('2026-09');
    expect(coerceUtilityRead({ billMonth: '2026-09', periodFrom: '2025-08-06', periodTo: '2026-12-05' }).billMonth).toBe('2026-09');
    expect(coerceUtilityRead({ billMonth: '2026-08', periodFrom: '2026-06-07', periodTo: '2026-09-06' }).billMonth).toBe('2026-09');
  });

  test('without Caj Semasa the page cannot be recorded as it is, even with an amount due', () => {
    const r = coerceUtilityRead({ billMonth: '2026-09', amountDue: '527.35', currentCharges: '' });
    expect(r.currentChargesSen).toBeNull();
    expect(readFailed(r)).toBe(true);
  });

  test('the prompt says Caj Semasa is the charge and Baki Terdahulu never is', async () => {
    let sent: any = null;
    await readUtilityPage('k', PAGE, (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return answer({ kind: 'electricity' }); }) as typeof fetch);
    const prompt = sent.messages[0].content[1].text as string;
    expect(prompt).toMatch(/Caj Semasa/);
    expect(prompt).toMatch(/Baki Terdahulu/);
    expect(prompt).toMatch(/month the period ends/);
  });
});

/* 24 of the 104 September pages came back with zero-width spaces inside the account number, which breaks matching. */
describe('invisible characters', () => {
  test('are taken out of every text field', () => {
    const r = coerceUtilityRead({ accountNoVisible: '21040241\u200b60XX', invoiceNo: '0009467266\u200b80', provider: '\ufeffTNB' });
    expect(r).toMatchObject({ accountNoVisible: '2104024160XX', invoiceNo: '000946726680', provider: 'TNB' });
  });
});

/* The API refused the first schema on the live run (3 Nov 2026): "Schemas contains too many parameters with union
   types (17 parameters with type arrays or anyOf)". Every field is a plain type; "" means not printed. */
describe('the schema', () => {
  test('no field is a union type', () => {
    const props = UTILITY_READ_SCHEMA.properties as Record<string, { type?: unknown; anyOf?: unknown }>;
    expect(Object.entries(props).filter(([, v]) => Array.isArray(v.type) || v.anyOf).map(([k]) => k)).toEqual([]);
  });

  test('an empty string is read as not printed: null, never 0', () => {
    const r = coerceUtilityRead({ kind: 'water', billMonth: '', periodFrom: '', amountDue: '', deposit: '', accountNoVisible: '', meterPrevious: '', meterCurrent: '1,234', confidenceNotes: '' });
    expect(r).toMatchObject({ billMonth: null, periodFrom: null, amountDueSen: null, depositSen: null, accountNoVisible: null, meterPrevious: null, meterCurrent: 1234, confidenceNotes: null });
    expect(readFailed(r)).toBe(true);
  });
});

describe('readUtilityPage', () => {
  test('asks Sonnet 5.5 for JSON to a schema and returns the read', async () => {
    let sent: any = null;
    const fake = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return answer({ kind: 'water', amountDue: '45.10', billMonth: '2026-10' }); }) as unknown as typeof fetch;
    const r = await readUtilityPage('k', PAGE, fake);
    expect(UTILITY_READ_MODEL).toBe('claude-sonnet-5-5');
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
    expect(r).toMatchObject({ model: 'claude-sonnet-5-5', read: { kind: 'water', amountDueSen: 4510, billMonth: '2026-10' } });
  });
  test('a refusal, an error or a non-JSON answer is an error, not an empty bill', async () => {
    const refused = (async () => answer({}, { stop_reason: 'refusal', content: [] })) as unknown as typeof fetch;
    const broken = (async () => new Response('overloaded', { status: 400 })) as unknown as typeof fetch;
    const prose = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'I cannot read this' }] }), { status: 200 })) as unknown as typeof fetch;
    for (const f of [refused, broken, prose]) expect(await readUtilityPage('k', PAGE, f)).toHaveProperty('error');
  });
});
