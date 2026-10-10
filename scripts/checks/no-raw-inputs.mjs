// Number, money, date and time fields go through src/components/inputs, never a raw <input type="number|date|time">.
// A raw type="number" lets the mouse wheel change money, snaps an emptied field back to 0 and refuses "1,234.50";
// raw date/time inputs drift in height, label and range messages. Run alone: node scripts/checks/no-raw-inputs.mjs
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const KINDS = 'number|date|time|datetime-local|month|week';
const PATTERNS = [
  { re: new RegExp(`\\btype\\s*=\\s*(?:\\{\\s*)?["'\`](${KINDS})["'\`]`), msg: m => `raw type="${m[1]}" input: use MoneyInput, NumberInput, PercentInput, DateField, TimeField or DateTimeField` },
  { re: new RegExp(`\\btype\\s*=\\s*\\{[^}\\n]*["'\`](${KINDS})["'\`][^}\\n]*\\}`), msg: m => `raw type="${m[1]}" input chosen at run time: use the shared inputs` },
];

const isRenovation = rel => /(^|\/)reno[^/]*$/i.test(rel);

export const def = {
  name: 'no-raw-inputs',
  rule: 'number/date/time fields use src/components/inputs',
  files: () => srcFiles().filter(rel => !rel.startsWith('src/components/inputs/') && !isRenovation(rel)),
  scan: (text) => {
    const hits = lineHits(stripComments(text), PATTERNS);
    // Both patterns can match one line; report it once.
    return hits.filter((h, i) => hits.findIndex(x => x.line === h.line) === i);
  },
  selfTest: {
    bad: [
      { path: 'src/pages/A.tsx', text: '<input type="number" value={x} />' },
      { path: 'src/pages/B.tsx', text: "<Field label=\"Amount\" type='number' />" },
      { path: 'src/pages/C.tsx', text: "<input type={num ? 'number' : 'text'} />" },
      { path: 'src/pages/D.tsx', text: '<Field label="Day" type="date" />' },
      { path: 'src/pages/E.tsx', text: '<input type="time" />' },
      { path: 'src/pages/F.tsx', text: '<input type="datetime-local" />' },
    ],
    good: [{ path: 'src/pages/G.tsx', text: "<input type=\"text\" inputMode=\"decimal\" />\n// an old note about type=\"number\"\nif (typeof value === 'number') return;\n<MoneyInput valueSen={x} onChangeSen={setX} />" }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
