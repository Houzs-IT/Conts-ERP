/* Creating a purchase order: every refusal that leaves nothing behind must release the idempotency claim, so the
 * corrected form can be saved again.
 *
 * THE BUG, as the owner hit it (New Purchase Order from Sales Order, production, 19 Nov 2026 18:07 MYT): the first
 * Save was refused by the database's renovation check ("A renovation purchase order holds one category: this PO is
 * BUILTIN, the line CUR-GEN-DOUBLE is SOFT ..."). The route rolled the header back but answered with a bare c.json,
 * so the middleware STORED that 500 against the form's key (public.idempotency_keys held it). He moved the line,
 * pressed Save again, and got "An earlier submission with different details already finished under this request
 * key" — the claim's hash no longer matched, and only a reload (losing the form) got out.
 *
 * Same completeness check as piCreatePreWriteRefusalsReleaseKey.test.ts, pointed at createMfgPurchaseOrderHandler:
 * no refusal before the first write keeps the key, and a refusal past it releases only with a reason a reader can
 * check. The release mechanism itself is proven in idempotencyRefusalRelease.test.ts. */
import { describe, it, expect } from 'vitest';
// ?raw so the assertion reads the real source, in any test runtime.
import routerSource from '../src/scm/routes/mfg-purchase-orders.ts?raw';
import { stripComments } from '../scripts/lib/classify-tests.mjs';

const lines: string[] = stripComments(routerSource).split('\n');
const raw: string[] = routerSource.split('\n');

const start = lines.findIndex((l) => l.startsWith('export const createMfgPurchaseOrderHandler = async'));
const after = lines.findIndex((l, i) => i > start && /^mfgPurchaseOrders\.post\('\/', createMfgPurchaseOrderHandler\)/.test(l));

it('the create handler is still where this file thinks it is', () => {
  expect(start).toBeGreaterThan(-1);
  expect(after).toBeGreaterThan(start);
});

/* Anything that can leave a row behind. Claiming a PO number is a counter write (lib/doc-no.ts), so it counts. */
const WRITES = /\.(insert|update|upsert|rpc)\(|\.delete\(\)|mintMonthlyDocNo\(|insertWithDocNoRetry\(|recordPoCreate\(|enqueue\w*\(/;
const RELEASES = /refuseWithoutWriting\(/;

const body = lines.slice(start, after);
const firstWrite = body.findIndex((l) => WRITES.test(l));

type Exit = { lineNo: number; text: string; status: string; releases: boolean };
const exits: Exit[] = [];
body.forEach((text, i) => {
  if (!/return (c\.json|refuseWithoutWriting)\(/.test(text)) return;
  const status = /, (\d{3})\);?\s*\}?\s*$/.exec(text)?.[1];
  if (!status) return;
  exits.push({ lineNo: start + i + 1, text: raw[start + i]!.trim(), status, releases: RELEASES.test(text) });
});

const isRefusal = (e: Exit) => e.status !== '200' && e.status !== '201';
const beforeFirstWrite = (e: Exit) => firstWrite === -1 || e.lineNo - start - 1 <= firstWrite;

/* Past the first write, a release needs a proof. Either the exit is gated on `rolledBack` — the header delete that
   returned its row — or it is listed here with the reason. */
const PAST_A_WRITE: Record<string, string> = {
  "if (hErr.code === '42501') return refuseWithoutWriting(c, { error: 'forbidden', reason: hErr.message }, 403);":
    'insertWithDocNoRetry returns the LAST attempt\'s error, and an attempt that errored wrote no row; earlier attempts only claimed doc numbers.',
  "return refuseWithoutWriting(c, { error: 'insert_failed', reason: hErr.message }, 500);":
    'Same: the header insert errored, so no purchase order exists.',
};
const provenRollback = (e: Exit) => /^if \(rolledBack\b/.test(e.text);

describe('every refusal POST /mfg-purchase-orders can emit releases the claim when nothing is left', () => {
  it("finds the handler's exits and its first write", () => {
    expect(exits.length).toBeGreaterThan(12);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(body[firstWrite]).toContain('mintMonthlyDocNo(');
  });

  it("no refusal before the first write keeps the operator's key", () => {
    const stuck = exits
      .filter(isRefusal).filter(beforeFirstWrite).filter((e) => !e.releases)
      .map((e) => `${e.lineNo}: ${e.text}`);
    expect(stuck).toEqual([]);
  });

  it('covers the line-number refusal, which used to sit after the number was claimed', () => {
    const released = exits.filter(beforeFirstWrite).map((e) => e.text).join('\n');
    expect(released).toContain('return refuseWithoutWriting(c, { ...b, reason: `Line ${i + 1}: ${b.reason}` }, 400);');
  });

  it('a refusal past the first write releases only with a proof', () => {
    const unexplained = exits
      .filter(isRefusal).filter((e) => !beforeFirstWrite(e)).filter((e) => e.releases)
      .filter((e) => !PAST_A_WRITE[e.text] && !provenRollback(e))
      .map((e) => `${e.lineNo}: ${e.text}`);
    expect(unexplained).toEqual([]);
  });

  it('the refused-line exit the owner hit releases once the header is proven gone, and keeps the key otherwise', () => {
    const itemsExits = exits.filter((e) => e.text.includes('body,') || e.text === 'return c.json(body, 500);');
    expect(itemsExits.filter((e) => e.releases).every(provenRollback)).toBe(true);
    expect(itemsExits.some((e) => e.releases && e.status === '409')).toBe(true);
    expect(itemsExits.some((e) => !e.releases && e.status === '500')).toBe(true);
  });

  it('every written reason still names a live exit', () => {
    const live = new Set(exits.map((e) => e.text));
    expect(Object.keys(PAST_A_WRITE).filter((t) => !live.has(t))).toEqual([]);
  });

  it('the 201 does not release', () => {
    const created = exits.filter((e) => e.status === '201');
    expect(created).toHaveLength(1);
    expect(created[0]!.releases).toBe(false);
  });
});
