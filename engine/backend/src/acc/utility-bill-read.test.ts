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
    expect(readFailed(coerceUtilityRead({ amountDue: '10.00', billMonth: '2026-10' }))).toBe(false);
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
