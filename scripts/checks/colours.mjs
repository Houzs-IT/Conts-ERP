// Colour comes from the theme only. Pages use meaning-based utilities (text-success, bg-warning-bg, border-danger-line,
// text-accent ...) or the named surface/ink tokens; never a raw hex, a Tailwind palette shade, or a status variable
// pasted into an arbitrary class.
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const PALETTE = 'red|green|blue|yellow|amber|emerald|orange|rose|slate|gray|grey|zinc|neutral|stone|sky|indigo|violet|purple|pink|lime|teal|cyan|fuchsia';
const PATTERNS = [
  // Short forms count when they hold a letter or repeat one digit (#fff, #333); "#2207" and "#105" are unit numbers.
  { re: /(?:^|[\s'"`(,:[{=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,4}|([0-9])\1\1\1?)(?![\w-])/, msg: m => `raw colour ${m[0].trim().replace(/^[^#]*/, '')}: use a theme token` },
  { re: new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|decoration|accent|caret|shadow)-(?:${PALETTE})-\\d{2,3}\\b`), msg: m => `Tailwind palette colour ${m[0]}: use a meaning-based token` },
  { re: /\[var\(--color-(?:success|warning|critical|info|neutral)(?:-fg|-line|-bg|-solid)?\b/, msg: m => `status colour as an arbitrary value (${m[0]}...): use text-success / bg-success-bg / border-success-line (and danger, warning, info, neutral, accent)` },
];

export const allow = {
  'src/theme.ts': 'Theme source: the hex values every token is built from.',
  'src/lib/design-tokens.ts': 'Theme source: channel identity colours for third-party brands.',
  'src/lib/vocabulary.ts': 'Theme source: booking channel colours (Airbnb, Booking.com, Agoda brand marks).',
  'src/components/ChannelMark.tsx': 'Draws the Airbnb, Booking.com and Agoda logo marks in their own brand colours.',
  'src/components/Logo.tsx': 'The Conts logo artwork.',
  'src/pages/OwnerIncomeReportPage.tsx': 'A printed A4 replica of the owner\'s paper income report (black rules, workbook header blue); print colours, not screen theme.',
};

export const def = {
  name: 'colours',
  rule: 'no raw hex, palette shades or status variables in arbitrary classes; use the theme tokens',
  files: () => srcFiles(),
  allow,
  scan: (text) => lineHits(stripComments(text), PATTERNS),
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: '<div className="bg-[#F4F1EB] p-2" />' },
      { path: 'src/pages/Y.tsx', text: "<span style={{ color: '#A8352F' }} />" },
      { path: 'src/pages/Z.tsx', text: '<span className="text-red-600" />' },
      { path: 'src/pages/W.tsx', text: '<span className="text-[var(--color-critical-fg)]" />' },
    ],
    good: [{ path: 'src/pages/X.tsx', text: '<a href="#/reservations/guests">x</a><span className="text-danger bg-warning-bg border-success-line">Unit #A-12-03</span>' }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
