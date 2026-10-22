// Dates, times, money and counts are formatted only in src/lib/format.ts, so every screen prints
// "16 Sep 2026", "14:06", "RM 1,250.00" and "4,290" the same way (never "Sept", never 2:06 pm, never RM1250).
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const PATTERNS = [
  { re: /\.toLocale(?:Date|Time)?String\s*\(/, msg: 'toLocale*String: use date() / time() / dateTime() / count() / rm() from src/lib/format.ts' },
  { re: /\bIntl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\b/, msg: 'Intl formatter: use src/lib/format.ts' },
  { re: /\bRM\s?(?:\$\{|\{)/, msg: 'hand-built "RM" amount: use rm() / rmShort() / <MoneyText>' },
  { re: /['"`]RM ['"`]\s*\+/, msg: 'hand-built "RM" amount: use rm() / rmShort() / <MoneyText>' },
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
    ],
    good: [{ path: 'src/pages/X.tsx', text: "import { date, rm } from '../lib/format';\nconst s = `${date(iso)} ${rm(sen)}`; // toLocaleDateString( in a comment is fine" }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
