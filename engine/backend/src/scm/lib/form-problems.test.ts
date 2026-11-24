import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldWords, zodProblems, zodValidationFailedBody } from './form-problems';
import { soCreatePaymentsSchema } from './so-create-payment-slips';

describe('zodProblems: a rejected form body as plain sentences (audit 20 Nov 2026)', () => {
  it('names the row and the field: "Payment 2: amount must be more than 0."', () => {
    const parsed = soCreatePaymentsSchema.safeParse([
      { method: 'cash', amountSen: 100 },
      { method: 'cash', amountSen: 0 },
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const problems = zodProblems(parsed.error, { rowNoun: 'Payment' });
    expect(problems.map((p) => p.message)).toContain('Payment 2: amount must be more than 0.');
    expect(problems[0]!.field).toBe('amountSen');
  });

  it('missing, wrong type, enum and text length each read as a sentence', () => {
    const schema = z.object({
      paidAt: z.string().min(1),
      method: z.enum(['cash', 'card']),
      note: z.string().max(3),
      qty: z.number().int().min(1),
      stops: z.array(z.object({ address: z.string().min(1) })),
    });
    const parsed = schema.safeParse({ method: 'cheque', note: 'abcd', qty: 'x', stops: [{ address: '' }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const msgs = zodProblems(parsed.error, { labels: { paidAt: 'payment date' } }).map((p) => p.message);
    expect(msgs).toContain('Payment date is missing.');
    expect(msgs).toContain('Method must be one of: cash, card.');
    expect(msgs).toContain('Note must be at most 3 characters.');
    expect(msgs).toContain('Qty must be a number.');
    expect(msgs).toContain('Stop 1: address cannot be empty.');
  });

  it('the body is the validation_failed problems list the browser already renders', () => {
    const parsed = z.object({ amountSen: z.number().nonnegative() }).safeParse({ amountSen: -1 });
    if (parsed.success) throw new Error('expected a failure');
    const body = zodValidationFailedBody(parsed.error);
    expect(body.error).toBe('validation_failed');
    expect(body.problems).toHaveLength(1);
    expect(body.message).toBe('Amount must be at least 0.');
    expect(JSON.stringify(body)).not.toMatch(/"issues"/);
  });

  it('fieldWords turns keys into words', () => {
    expect(fieldWords('amountSen')).toBe('amount');
    expect(fieldWords('collectedBy')).toBe('collected by');
    expect(fieldWords('uploadSessionId')).toBe('upload session ID');
    expect(fieldWords('trip_date')).toBe('trip date');
  });
});
