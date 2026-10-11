// Business dates are Kuala Lumpur dates. The Worker, the database session and most browsers here run on UTC, so
// "today" taken from a UTC clock is yesterday from midnight to 08:00 MYT: a form defaults to the wrong day, a report
// opens on last month on the 1st, a number gets last year's prefix on 1 January (Houzs HZ-31, Hookka HK-13).
// Use todayMyt() (src/lib/format.ts) in the app and mytToday() (functions/_lib/db.ts) on the server, and
// now() AT TIME ZONE 'Asia/Kuala_Lumpur' in SQL.
import { runCheck, runIfMain, walk, stripComments, lineHits } from './_lib.mjs';

const PATTERNS = [
  { re: /new Date\(\)\.toISOString\(\)\.(?:slice|substring|substr)\(0,\s*(?:4|7|10)\)/, msg: 'today / this month / this year read from a UTC clock: use todayMyt() or mytToday()' },
  { re: /new Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)/, msg: 'today read from a UTC clock: use todayMyt() or mytToday()' },
  { re: /\bnowIso\(\)\.(?:slice|substring|substr)\(0,\s*(?:4|7|10)\)/, msg: 'today / this month / this year read from a UTC clock: use mytToday()' },
  { re: /\bnow\.(?:slice|substring|substr)\(0,\s*(?:4|7|10)\)/, msg: 'the date part of a UTC timestamp (now = nowIso()): use mytToday()' },
  { re: /new Date\(\)\.get(?:FullYear|Month|Date|Day)\(\)/, msg: "a date part read from the device's own clock: use todayMyt()" },
  { re: /to_char\(\s*now\(\)\s*,/i, msg: "SQL now() is UTC: use to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', ...)" },
  { re: /\bCURRENT_DATE\b|now\(\)::date\b/i, msg: "SQL CURRENT_DATE / now()::date is the UTC day: use (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date" },
];

export const allow = {
  'src/lib/export.ts': 'The zip writer stamps each file with the time it was written on this device; it is file metadata, not a business date.',
};

export const def = {
  name: 'myt-dates',
  rule: 'no business date taken from a UTC clock; use todayMyt() / mytToday() / AT TIME ZONE',
  files: () => [...walk('src'), ...walk('functions')],
  allow,
  scan: (text) => lineHits(stripComments(text), PATTERNS),
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "const [d, setD] = useState(new Date().toISOString().slice(0, 10));" },
      { path: 'functions/api/x.ts', text: "const year = nowIso().slice(0, 4);" },
      { path: 'functions/api/z.ts', text: "const now = nowIso(); const day = strOrNull(b.day) ?? now.slice(0, 10);" },
      { path: 'functions/api/y.ts', text: "const sql = `WHERE r.check_out >= to_char(now(), 'YYYY-MM-DD')`;" },
      { path: 'src/pages/Y.tsx', text: "const no = `PO-${new Date().getFullYear()}-NEW`;" },
    ],
    good: [
      { path: 'src/pages/X.tsx', text: "const [d, setD] = useState(todayMyt()); const t = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);" },
      { path: 'functions/api/y.ts', text: "const sql = `WHERE r.check_out >= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`; const at = nowIso();" },
    ],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
