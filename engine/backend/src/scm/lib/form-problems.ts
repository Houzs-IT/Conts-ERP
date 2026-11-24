// ----------------------------------------------------------------------------
// A rejected form body, as the problems list the browser already shows.
//
// Routes used to answer a failed schema check with `issues: parsed.error.issues`
// or `reason: parsed.error.message` (zod's raw JSON). The browser cannot show
// either, so the operator read "The details you entered were not accepted" and
// had to guess which box was wrong. The same refusal now carries the aggregated
// `validation_failed` + `problems[]` shape (shared/so-save-problems.ts) that
// authed-fetch.ts parseSaveProblems renders one line per problem, e.g.
// "Payment 2: amount must be more than 0" (audit 20 Nov 2026).
// ----------------------------------------------------------------------------

import type { ZodError, ZodIssue } from 'zod';
import { validationFailedBody, type SaveProblem } from '../shared/so-save-problems';

export type FormProblemOptions = {
  /** What one row of an array is called, for paths that start with an index ("Payment" -> "Payment 2"). */
  rowNoun?: string;
  /** Plain names for fields whose key does not read well on its own ({ paidAt: 'payment date' }). */
  labels?: Record<string, string>;
};

/** `amountSen` -> "amount", `paymentMethod` -> "payment method", `trip_date` -> "trip date". */
export function fieldWords(key: string, labels: Record<string, string> = {}): string {
  if (Object.hasOwn(labels, key)) return labels[key]!;
  const words = key
    .replace(/(Sen|_sen)$/, '')
    .replace(/Id$/, ' ID')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.replace(/\bid\b/g, 'ID') || 'value';
}

const TYPE_WORDS: Record<string, string> = {
  string: 'text', number: 'a number', integer: 'a whole number', boolean: 'yes or no',
  date: 'a date', array: 'a list', object: 'a set of details',
};

function issueWords(i: ZodIssue): string {
  switch (i.code) {
    case 'invalid_type':
      if (i.received === 'undefined' || i.received === 'null') return 'is missing';
      return `must be ${TYPE_WORDS[i.expected] ?? i.expected}`;
    case 'too_small': {
      const min = Number(i.minimum);
      if (i.type === 'string') return min <= 1 ? 'cannot be empty' : `must be at least ${min} characters`;
      if (i.type === 'array') return `needs at least ${min} ${min === 1 ? 'entry' : 'entries'}`;
      if (i.type === 'number' || i.type === 'bigint') return i.inclusive ? `must be at least ${min}` : `must be more than ${min}`;
      return 'is too small';
    }
    case 'too_big': {
      const max = Number(i.maximum);
      if (i.type === 'string') return `must be at most ${max} characters`;
      if (i.type === 'array') return `can have at most ${max} ${max === 1 ? 'entry' : 'entries'}`;
      if (i.type === 'number' || i.type === 'bigint') return i.inclusive ? `must be at most ${max}` : `must be less than ${max}`;
      return 'is too big';
    }
    case 'invalid_enum_value':
      return `must be one of: ${i.options.map(String).join(', ')}`;
    case 'invalid_literal':
      return `must be ${String(i.expected)}`;
    case 'invalid_string':
      return typeof i.validation === 'string' ? `is not a valid ${i.validation === 'uuid' ? 'reference' : i.validation}` : 'is not in the right format';
    case 'invalid_date':
      return 'is not a valid date';
    case 'not_multiple_of':
      return `must be a multiple of ${String(i.multipleOf)}`;
    case 'unrecognized_keys':
      return `has fields this form does not take (${i.keys.join(', ')})`;
    case 'custom':
      return i.message && i.message !== 'Invalid input' ? i.message : 'is not valid';
    default:
      return 'is not valid';
  }
}

/** Where the problem is, in words: ['payments', 1, 'amountSen'] with rowNoun "Payment" -> "Payment 2: amount". */
function placeWords(path: ReadonlyArray<string | number>, opts: FormProblemOptions): string {
  const parts: string[] = [];
  let field: string | null = null;
  for (const seg of path) {
    if (typeof seg === 'number') parts.push(`${opts.rowNoun ?? (field ? capitalise(singular(field)) : 'Row')} ${seg + 1}`);
    else field = seg;
  }
  const last = path[path.length - 1];
  const name = typeof last === 'string' ? fieldWords(last, opts.labels) : null;
  if (parts.length === 0) return name ? capitalise(name) : 'This form';
  return name ? `${parts.join(', ')}: ${name}` : parts.join(', ');
}

const capitalise = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const singular = (s: string): string => fieldWords(s).replace(/ies$/, 'y').replace(/s$/, '');

/** Every issue of a failed schema check as one plain sentence each. */
export function zodProblems(error: ZodError, opts: FormProblemOptions = {}): SaveProblem[] {
  return error.issues.map((i) => {
    const last = i.path[i.path.length - 1];
    return {
      code: i.code,
      message: `${placeWords(i.path, opts)} ${issueWords(i)}.`,
      ...(typeof last === 'string' ? { field: last } : {}),
    };
  });
}

/** The refusal body for a failed schema check: the same `validation_failed` shape as the SO save gates, which
    authed-fetch.ts renders one line per problem. */
export function zodValidationFailedBody(error: ZodError, opts: FormProblemOptions = {}): ReturnType<typeof validationFailedBody> {
  return validationFailedBody(zodProblems(error, opts));
}
