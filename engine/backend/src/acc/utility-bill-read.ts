// Conts only (not part of Houzs's code): read ONE page of a utility bill (TNB, water, Indah Water, internet) for the
// Property OS "Scan bills" screen (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md; spec
// docs/superpowers/specs/2026-10-27-utility-bills-design.md §5.2). Every page is read once with Sonnet 5.5 (chew, 2 Nov
// 2026: "直接用 sonnet"). The model returns JSON to a schema; money is coerced to sen here, in plain code, and anything
// not printed stays null, so an unreadable amount never arrives as RM 0.00. Matching the page to a unit happens in
// Property OS, which holds the utility accounts.
import { BILL_IMAGE_MIMES } from './bill-extract';

/** One place for the model id, so it can be changed without touching anything else. */
export const UTILITY_READ_MODEL = 'claude-sonnet-5-5';

export const UTILITY_KINDS = ['electricity', 'water', 'sewerage', 'internet', 'other'] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

export type UtilityRead = {
  kind: UtilityKind;
  provider: string | null;
  billMonth: string | null;          // YYYY-MM; for a period bill the month it starts in
  periodFrom: string | null;         // YYYY-MM-DD as printed
  periodTo: string | null;
  amountDueSen: number | null;
  currentChargesSen: number | null;
  accountNoVisible: string | null;   // as printed, masked digits as X
  accountNoFull: string | null;      // only where it is printed whole (barcode line, Indah Water, Maxis)
  depositSen: number | null;
  invoiceNo: string | null;
  premiseAddress: string | null;
  buildingName: string | null;
  unitText: string | null;
  ownerName: string | null;
  meterPrevious: number | null;
  meterCurrent: number | null;
  confidenceNotes: string | null;
};

/* Every field is a plain string, "" when it is not printed: the API refuses a schema with more than a few nullable
   (union) fields ("too many parameters with union types", live run 3 Nov 2026). Money and readings are read as printed
   text and coerced here: the model copies "1,311.18", we do the arithmetic, and "" becomes null, never 0. */
const str = { type: 'string' };
const FIELDS: Record<string, unknown> = {
  kind: { type: 'string', enum: [...UTILITY_KINDS] }, provider: str, billMonth: str, periodFrom: str, periodTo: str,
  amountDue: str, currentCharges: str, accountNoVisible: str, accountNoFull: str, deposit: str, invoiceNo: str,
  premiseAddress: str, buildingName: str, unitText: str, ownerName: str, meterPrevious: str, meterCurrent: str, confidenceNotes: str,
};
export const UTILITY_READ_SCHEMA = { type: 'object', properties: FIELDS, required: Object.keys(FIELDS), additionalProperties: false };

const PROMPT = `You are reading ONE page of a Malaysian utility bill for a property manager's finance clerk. Copy what is printed; never guess.
- kind: electricity (TNB), water (Air Selangor, SYABAS, or a building management water bill), sewerage (Indah Water), internet (TIME, Maxis, Unifi, U Mobile…), other.
- billMonth: YYYY-MM of the bill. When a period is printed, the month the period starts in. periodFrom / periodTo: YYYY-MM-DD as printed ("Tempoh Bil", "Billing period").
- amountDue: the amount to pay now ("Jumlah Perlu Dibayar", "Amount due"), as printed, e.g. "1,311.18". currentCharges: this period's charges ("Caj Semasa"). Use "" when not printed; never 0 for a figure you cannot read.
- accountNoVisible: the account number exactly as printed, masked digits as X (TNB prints e.g. 2104010945XX02). accountNoFull: only when the whole number is printed somewhere (barcode text, Indah Water, Maxis).
- deposit: the security deposit ("Deposit", "Cagaran") when printed.
- premiseAddress, buildingName, unitText (e.g. "C-37-13A"), ownerName (the account holder) as printed.
- meterPrevious / meterCurrent: the meter readings as printed (management water bills carry these and no account number).
- TNB pages are often rotated 90 degrees: read them turned.
- confidenceNotes: one short line on anything unclear.
- Any field that is not printed on this page: "" (an empty string).`;

const rmToSen = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/RM|MYR|\s/gi, '').replace(/,/g, '').match(/^-?\d+(\.\d{1,2})?$/);
  return m ? Math.round(Number(m[0]) * 100) : null;
};
const text = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isoDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const reading = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.replace(/,/g, '')) ? Number(v.replace(/,/g, '')) : null);

/** Whatever the model said, in the strict shape. */
export function coerceUtilityRead(raw: unknown): UtilityRead {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = UTILITY_KINDS.includes(o.kind as UtilityKind) ? (o.kind as UtilityKind) : 'other';
  const month = typeof o.billMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(o.billMonth) ? o.billMonth : null;
  const mask = (v: unknown) => text(v, 40)?.replace(/[*x•]/g, 'X') ?? null;
  return {
    kind, provider: text(o.provider, 100), billMonth: month, periodFrom: isoDate(o.periodFrom), periodTo: isoDate(o.periodTo),
    amountDueSen: rmToSen(o.amountDue), currentChargesSen: rmToSen(o.currentCharges),
    accountNoVisible: mask(o.accountNoVisible), accountNoFull: text(o.accountNoFull, 40), depositSen: rmToSen(o.deposit),
    invoiceNo: text(o.invoiceNo, 60), premiseAddress: text(o.premiseAddress), buildingName: text(o.buildingName, 120),
    unitText: text(o.unitText, 40), ownerName: text(o.ownerName, 120), meterPrevious: reading(o.meterPrevious), meterCurrent: reading(o.meterCurrent),
    confidenceNotes: text(o.confidenceNotes),
  };
}

/** A page with no amount or no month cannot be recorded as it is: it shows red and the clerk types the figures. */
export const readFailed = (r: UtilityRead): boolean => r.amountDueSen == null || r.billMonth == null;

/** One page → one call. No reading time limit (chew: "别限制读的时间"); transient errors are retried by the caller's
    fetch wrapper. fetchImpl is injectable so tests never touch the network. */
export async function readUtilityPage(
  apiKey: string,
  page: { mime: string; dataBase64: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ read: UtilityRead; model: string } | { error: string }> {
  const block = BILL_IMAGE_MIMES.has(page.mime)
    ? { type: 'image', source: { type: 'base64', media_type: page.mime, data: page.dataBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: page.dataBase64 } };
  let res: Response;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: UTILITY_READ_MODEL,
        /* Thinking counts against max_tokens; the JSON itself is well under 1,000. */
        max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: UTILITY_READ_SCHEMA } },
        messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
      }),
    });
  } catch (e) {
    return { error: `The reader could not be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { error: `The reader refused (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}` };
  let data: { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
  try { data = await res.json(); } catch { return { error: "The reader's answer was unreadable." }; }
  if (data.stop_reason === 'refusal') return { error: 'The reader declined this page.' };
  if (data.stop_reason === 'max_tokens') return { error: 'The reader ran out of room on this page.' };
  const out = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { return { error: 'The reader answered, but not with a bill.' }; }
  return { read: coerceUtilityRead(parsed), model: UTILITY_READ_MODEL };
}
