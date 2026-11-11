// Dates, times, money and counts are formatted only in src/lib/format.ts, so every screen prints
// "2026/09/16", "14:06", "RM 1,250.00" and "4,290" the same way (never "16 Sep 2026" since 3 Nov 2026, never 2:06 pm,
// never RM1250). Year-first numeric dates are the owner's rule for the whole system, the engine included.
// The Dream Crafter side reads them day first (16-09-2026, YH 11 Nov 2026): the same helpers, switched by setDayFirst().
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const PATTERNS = [
  { re: /\.toLocale(?:Date|Time)?String\s*\(/, msg: 'toLocale*String: use date() / time() / dateTime() / count() / rm() from src/lib/format.ts' },
  { re: /\bIntl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\b/, msg: 'Intl formatter: use src/lib/format.ts' },
  { re: /\bRM\s?(?:\$\{|\{)/, msg: 'hand-built "RM" amount: use rm() / rmShort() / <MoneyText>' },
  { re: /['"`]RM ['"`]\s*\+/, msg: 'hand-built "RM" amount: use rm() / rmShort() / <MoneyText>' },
  { re: /\$\{[^}]+\} \$\{MONTHS\[/, msg: 'hand-built day-and-month-name date: use date() / dateShort() from src/lib/format.ts (2026/09/16, 09/16)' },
];

export const allow = {
  'src/lib/format.ts': 'The one place formatting lives.',
  'src/lib/statementPdf.ts': 'Runs under node --test, which cannot import format.ts without an extension; same rule as amount().',
};

export const def = {
  name: 'formatting',
  rule: 'dates, times, money and counts go through src/lib/format.ts',
  files: () => srcFiles(),
  allow,
  scan: (text) => lineHits(stripComments(text), PATTERNS),
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "const d = new Date(x).toLocaleDateString('en-MY', { month: 'short' });" },
      { path: 'src/pages/Y.tsx', text: 'const s = `now RM ${Math.round(p / 100)}`;' },
      { path: 'src/pages/Z.tsx', text: '<span>{n.toLocaleString()}</span>' },
      { path: 'src/pages/W.tsx', text: 'const d = `${day} ${MONTHS[m]} ${y}`;' },
    ],
    good: [{ path: 'src/pages/X.tsx', text: "import { date, rm } from '../lib/format';\nconst s = `${date(iso)} ${rm(sen)}`; // toLocaleDateString( in a comment is fine" }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
