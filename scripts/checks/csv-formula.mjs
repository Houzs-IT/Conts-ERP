// A CSV opened in Excel or Google Sheets runs any cell that starts with = + - @ as a formula. Guest names, notes and
// references come from booking sites and guests themselves, so every CSV writer passes text cells through the guard:
// toCsv / csvSafe (src/lib/export.ts) in the app, csvCell / csvSafe (functions/_lib/csv.ts) on the server.
import { runCheck, runIfMain, walk, stripComments } from './_lib.mjs';

const WRITES_CSV = /new Blob\(.{0,200}?text\/csv|['"]content-type['"]\s*:\s*['"]text\/csv/i;
const GUARDED = /\b(?:csvSafe|csvCell|toCsv|downloadTable)\b/;

export const allow = {
  'src/lib/export.ts': 'Defines the guard (csvSafe) and the writer every table export uses (toCsv).',
  'functions/_lib/csv.ts': 'Defines the server guard (csvSafe, csvCell).',
};

export const def = {
  name: 'csv-formula',
  rule: 'every CSV writer guards text cells against spreadsheet formulas (csvSafe / csvCell / toCsv)',
  files: () => [...walk('src'), ...walk('functions')],
  allow,
  scan(text) {
    const code = stripComments(text);
    if (!WRITES_CSV.test(code) || GUARDED.test(code)) return [];
    const line = code.split('\n').findIndex(l => /text\/csv/i.test(l)) + 1;
    return [{ line, msg: 'writes a CSV without the formula guard: pass text cells through csvSafe / csvCell' }];
  },
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "const url = URL.createObjectURL(new Blob([rows.join('\\n')], { type: 'text/csv' }));" },
      { path: 'functions/api/x.ts', text: "return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8' } });" },
    ],
    good: [
      { path: 'src/pages/X.tsx', text: "const esc = (v) => csvSafe(v); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));" },
      { path: 'functions/api/x.ts', text: "const q = csvCell; return new Response(body, { headers: { 'content-type': 'text/csv' } });" },
    ],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
