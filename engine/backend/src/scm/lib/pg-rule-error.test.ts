import { describe, expect, it } from 'vitest';
import { dbWriteFailure, pgRuleRefusal } from './pg-rule-error';

/* The browser drops a sentence with any of these (authed-fetch.ts isPlain), so none may appear. */
const UNSAYABLE = /violates|constraint|null value|column|relation|syntax|PGRST|error_code|\b\d{5}\b/i;

const fakeC = () => ({ json: (body: unknown, status: number) => ({ body, status }) as unknown as Response });

describe('pgRuleRefusal: database rule failures as plain 400/409 (audit 20 Nov 2026)', () => {
  const cases: Array<[string, number, string, Record<string, string>]> = [
    ['23505', 409, 'duplicate_record', { message: 'duplicate key value violates unique constraint "x_key"' }],
    ['23503', 409, 'linked_record_missing', { message: 'insert or update on table "a" violates foreign key constraint', details: 'Key (warehouse_id)=(1) is not present in table "warehouses".' }],
    ['23503', 409, 'still_in_use', { message: 'update or delete on table "a" violates foreign key constraint', details: 'Key (id)=(1) is still referenced from table "b".' }],
    ['23514', 400, 'value_not_allowed', { message: 'new row for relation "x" violates check constraint "qty_positive"' }],
    ['23502', 400, 'required_value_missing', { message: 'null value in column "unit_price_sen" of relation "x" violates not-null constraint' }],
    ['22P02', 400, 'invalid_value', { message: 'invalid input syntax for type uuid: "abc"' }],
  ];
  for (const [code, status, error, rest] of cases) {
    it(`${code} -> ${status} ${error}, in words the browser shows`, () => {
      const r = pgRuleRefusal({ code, ...rest }, 'line');
      expect(r?.status).toBe(status);
      expect(r?.body.error).toBe(error);
      expect(r!.body.message.length).toBeLessThan(200);
      expect(r!.body.message).not.toMatch(UNSAYABLE);
      expect(r!.body.message).toContain('line');
    });
  }

  it('names the missing field when Postgres says which', () => {
    expect(pgRuleRefusal({ code: '23502', message: 'null value in column "unit_price_sen" of relation "x"' }, 'line')!.body.message)
      .toBe('This line is missing its unit price. Fill it in and save again.');
  });

  it('anything else stays the 500 it was, with the driver reason', () => {
    expect(pgRuleRefusal({ code: '57014', message: 'canceling statement due to statement timeout' })).toBeNull();
    const res = dbWriteFailure(fakeC(), { code: '57014', message: 'timeout' }, 'insert_failed', 'line') as unknown as { body: unknown; status: number };
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'insert_failed', reason: 'timeout' });
    const dup = dbWriteFailure(fakeC(), { code: '23505', message: 'dup' }, 'insert_failed', 'payment voucher') as unknown as { body: { error: string }; status: number };
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('duplicate_record');
  });
});
