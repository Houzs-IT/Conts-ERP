// ----------------------------------------------------------------------------
// A database rule failure, as a plain sentence instead of a raw 500.
//
// Several writes answered every failed insert/update with
// `{ error: 'insert_failed', reason: error.message }` and status 500. For the
// failures the database refuses by rule (a duplicate number, a link to a row
// that is gone, a check such as qty > 0, a required value left empty, text
// where a number belongs) that is the wrong answer twice: 500 says "the system
// broke, try again", and the raw Postgres text is filtered out by the browser,
// so the operator read "The system hit a problem." for something they can fix.
// These five codes now come back as 400/409 with a sentence that says what to
// do (audit 20 Nov 2026). Anything else keeps the old 500.
//
// The sentences must survive authed-fetch.ts isPlain: under 200 characters, no
// "column", "constraint", "violates" or five-digit number.
// ----------------------------------------------------------------------------

export type PgLikeError = { code?: unknown; message?: unknown; details?: unknown } | null | undefined;

export type PgRuleRefusal = {
  status: 400 | 409;
  body: { error: string; message: string; pgCode: string };
};

/** `null value in column "unit_price_sen" ...` -> "unit price". Null when the name cannot be read. */
function notNullField(err: { message?: unknown; details?: unknown }): string | null {
  const m = /column "([a-z0-9_]+)"/i.exec(String(err.message ?? ''));
  if (!m) return null;
  return m[1]!.replace(/_(sen|id)$/, '').replace(/_/g, ' ').trim() || null;
}

/**
 * The refusal for a database rule failure, or null when the error is not one of them (the caller keeps its 500).
 * `subject` names the thing being saved, e.g. "line" or "payment voucher".
 */
export function pgRuleRefusal(err: PgLikeError, subject = 'record'): PgRuleRefusal | null {
  if (!err) return null;
  const code = String(err.code ?? '');
  switch (code) {
    case '23505':
      return {
        status: 409,
        body: {
          error: 'duplicate_record',
          message: `This ${subject} would duplicate one that already exists (the same number or code is taken). Refresh the page and try again.`,
          pgCode: code,
        },
      };
    case '23503': {
      const stillUsed = /still referenced/i.test(String(err.details ?? '')) || /still referenced/i.test(String(err.message ?? ''));
      return {
        status: 409,
        body: stillUsed
          ? {
            error: 'still_in_use',
            message: `This ${subject} is still used by other records, so it cannot be changed this way. Remove those first.`,
            pgCode: code,
          }
          : {
            error: 'linked_record_missing',
            message: `Something this ${subject} points to no longer exists (an item, warehouse or document may have been removed). Refresh, pick it again and save.`,
            pgCode: code,
          },
      };
    }
    case '23514':
      return {
        status: 400,
        body: {
          error: 'value_not_allowed',
          message: `A value on this ${subject} is outside what is allowed, such as a quantity or amount below zero. Check the numbers and try again.`,
          pgCode: code,
        },
      };
    case '23502': {
      const field = notNullField(err);
      return {
        status: 400,
        body: {
          error: 'required_value_missing',
          message: field
            ? `This ${subject} is missing its ${field}. Fill it in and save again.`
            : `A required detail is missing on this ${subject}. Fill in every required box and save again.`,
          pgCode: code,
        },
      };
    }
    case '22P02':
      return {
        status: 400,
        body: {
          error: 'invalid_value',
          message: `A value on this ${subject} is not in the right format, such as text where a number or date belongs. Check what was entered and try again.`,
          pgCode: code,
        },
      };
    default:
      return null;
  }
}

/**
 * The response for a failed write: the plain refusal for a rule failure, else the caller's own 500 code with the
 * driver's reason (unchanged from before, so a real fault is still reported as one).
 */
export function dbWriteFailure(
  c: { json: (body: unknown, status: number) => Response },
  err: NonNullable<PgLikeError>,
  fallbackCode: string,
  subject = 'record',
): Response {
  const r = pgRuleRefusal(err, subject);
  if (r) return c.json(r.body, r.status);
  return c.json({ error: fallbackCode, reason: String(err.message ?? '') }, 500);
}
