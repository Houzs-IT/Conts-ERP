// What the shared inputs make of typed text: node scripts/checks/input-parsing.mjs (Node 22.6+ strips the TS types).
import { cleanNumberText, parseScaled, formatScaled, caretAfterClean } from '../../src/components/inputs/numberText.ts';
import { parsePhone, formatLocalAsTyped, readInternationalAsTyped } from '../../src/lib/phone.ts';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// format.ts imports without file extensions, as the app does; bundle it so Node can load it.
const fmtOut = await build({ entryPoints: [join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/format.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const fmtDir = mkdtempSync(join(tmpdir(), 'fmt-'));
writeFileSync(join(fmtDir, 'format.mjs'), fmtOut.outputFiles[0].text);
const { phone, phoneDigits, phoneHref } = await import(pathToFileURL(join(fmtDir, 'format.mjs')).href);

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

// Phones as they arrive: bare digits with the country code (booking sites, the HostPlatform import), +code with
// spaces (typed or pasted), and Malaysian local numbers with their 0. Each reads in its country's own grouping.
const PHONES = [
  ['60189800069', '+60 18-980 0069'],       // MY, booking-site shape
  ['0189800069', '+60 18-980 0069'],        // MY local
  ['0123456789', '+60 12-345 6789'],
  ['01123456789', '+60 11-2345 6789'],      // MY 011 mobile, one digit longer
  ['0312345678', '+60 3-1234 5678'],        // KL landline
  ['082123456', '+60 82-123 456'],          // Sarawak landline
  ['+60 18-980 0069', '+60 18-980 0069'],
  ['0060123456789', '+60 12-345 6789'],     // 00 international prefix
  ['+60 0189800069', '+60 18-980 0069'],    // trunk 0 kept after +60
  ['1123456789', '+60 11-2345 6789'],       // MY 011 number without its 0 is not +1 123...
  ['6596532231', '+65 9653 2231'],          // SG
  ['+65 9653 2231', '+65 9653 2231'],
  ['6281234567890', '+62 812-3456-7890'],   // ID
  ['639171234567', '+63 917 123 4567'],     // PH
  ['66812345678', '+66 81 234 5678'],       // TH
  ['+66 2 123 4567', '+66 2 123 4567'],
  ['84912345678', '+84 912 345 678'],       // VN
  ['8613812345678', '+86 138 1234 5678'],   // CN
  ['85291234567', '+852 9123 4567'],        // HK
  ['85361234567', '+853 6123 4567'],        // MO
  ['886912345678', '+886 912 345 678'],     // TW
  ['821012345678', '+82 10-1234-5678'],     // KR
  ['+82 10-1234-5678', '+82 10-1234-5678'],
  ['819012345678', '+81 90-1234-5678'],     // JP
  ['919876543210', '+91 98765 43210'],      // IN
  ['9607771234', '+960 777-1234'],          // MV
  ['966558607042', '+966 55 860 7042'],     // SA
  ['+966 55 860 7042', '+966 55 860 7042'],
  ['971501234567', '+971 50 123 4567'],     // AE
  ['79123456789', '+7 912 345-67-89'],      // RU
  ['+7 912 345-67-89', '+7 912 345-67-89'],
  ['447700900123', '+44 7700 900123'],      // GB mobile
  ['+44 20 7123 4567', '+44 20 7123 4567'], // GB London
  ['33612345678', '+33 6 12 34 56 78'],     // FR
  ['4915112345678', '+49 1511 2345678'],    // DE
  ['61412345678', '+61 412 345 678'],       // AU
  ['12125551234', '+1 212 555-1234'],       // US
  ['+1 416 555 0199', '+1 416 555-0199'],   // CA
  ['6421234567', '+64 21 234 567'],         // NZ
  ['85512345678', '+855 12 345 678'],       // KH
  ['6737123456', '+673 712 3456'],          // BN
  ['94771234567', '+94 77 123 4567'],       // LK
  ['880171234567', '+880 1712-34567'],      // BD
  ['31612345678', '+31 6 12345678'],        // NL
  ['34612345678', '+34 612 34 56 78'],      // ES
  ['393123456789', '+39 312 345 6789'],     // IT
  ['5511987654321', '+55 11 98765-4321'],   // BR
  ['27821234567', '+27 82 123 4567'],       // ZA
];
for (const [raw, want] of PHONES) eq(`phone(${raw})`, phone(raw), want);
// The company phone on guest invoices, receipts and {contact} in guest messages.
for (const [raw, want] of [['011-6133 3289', '+60 11-6133 3289'], ['0116133 3289', '+60 11-6133 3289'], ['+60 17-465 8868', '+60 17-465 8868'], ['60123456789', '+60 12-345 6789'], ['', '']]) eq(`company phone ${JSON.stringify(raw)}`, phone(raw), want);
eq('phone digits for links', phoneDigits('0189800069'), '60189800069');
eq('tel link', phoneHref('+44 7700 900123'), 'tel:+447700900123');
eq('too few digits shows as typed', phone('12345'), '12345');
eq('no digits shows as typed', phone('No Contact from Airbnb'), 'No Contact from Airbnb');
eq('wrong length keeps every digit', phone('+60 12'), '+60 12');
eq('empty', phone(null), '');
eq('+60 12 is not possible', parsePhone('+60 12')?.possible, false);
eq('possible: SA bare', parsePhone('966558607042')?.possible, true);
// As-you-type, one key at a time.
const typed = (digits, c) => Array.from(digits, (_, i) => formatLocalAsTyped(digits.slice(0, i + 1), c)).at(-1);
eq('typing MY local', typed('0189800069', 'MY'), '018-980 0069');
eq('typing MY without 0', typed('189800069', 'MY'), '18-980 0069');
eq('typing SG', typed('96532231', 'SG'), '9653 2231');
eq('typing UK with 0', typed('07700900123', 'GB'), '07700 900123');
eq('typing RU', typed('9123456789', 'RU'), '912 345-67-89');
eq('+82 picks Korea', readInternationalAsTyped('82')?.country, 'KR');
eq('+44 picks the UK', readInternationalAsTyped('44')?.country, 'GB');
eq('+7 picks Russia', readInternationalAsTyped('7')?.country, 'RU');
eq('+6 is not a code yet', readInternationalAsTyped('6'), null);

console.log(`input-parsing: ${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
