// What the shared inputs make of typed text: node scripts/checks/input-parsing.mjs (Node 22.6+ strips the TS types).
import { cleanNumberText, parseScaled, formatScaled, caretAfterClean } from '../../src/components/inputs/numberText.ts';

let pass = 0, failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const money = t => parseScaled(cleanNumberText(t, 2, false).text, 2);

eq('12.30 -> 1230 sen', money('12.30'), 1230);
eq('0.29 -> 29 sen (float would give 28.999)', money('0.29'), 29);
eq('1,234.50', money('1,234.50'), 123450);
eq('1234.5', money('1234.5'), 123450);
eq('.5', money('.5'), 50);
eq('RM 300', money('RM 300'), 30000);
eq('rm300.00 pasted', money('rm300.00'), 30000);
eq('leading zero 007', money('007'), 700);
eq('empty is null, not 0', money(''), null);
eq('lone point is null', money('.'), null);
eq('third decimal dropped', cleanNumberText('12.345', 2, false), { text: '12.34', notice: 'decimals' });
eq('negative refused', cleanNumberText('-50', 2, false), { text: '50', notice: 'negative' });
eq('negative allowed', parseScaled(cleanNumberText('-50', 2, true).text, 2), -5000);
eq('second point dropped', cleanNumberText('1.2.3', 2, false).text, '1.23');
eq('whole numbers drop the fraction', cleanNumberText('4.5', 0, false), { text: '4', notice: 'whole' });
eq('format money', formatScaled(123450, 2, { grouping: true, fixed: true }), '1,234.50');
eq('format negative money', formatScaled(-5, 2, { grouping: true, fixed: true }), '-0.05');
eq('format count', formatScaled(12000, 0, { grouping: true, fixed: false }), '12,000');
eq('format percent', formatScaled(2250, 2, { grouping: false, fixed: false }), '22.5');
eq('caret after stripping commas', caretAfterClean('1,2345.50', 6, 2, false), 5);
eq('caret after RM prefix', caretAfterClean('RM 30', 5, 2, false), 2);
eq('every sen from 0.00 to 99.99 round-trips', (() => {
  for (let s = 0; s < 10000; s++) {
    const t = formatScaled(s, 2, { grouping: true, fixed: true });
    if (parseScaled(t, 2) !== s) return t;
  }
  return 'ok';
})(), 'ok');

console.log(`input-parsing: ${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
