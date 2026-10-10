// Every status pill is <StatusBadge> (src/components/StatusBadge.tsx) and every status word and colour lives in
// src/lib/status.ts, so "Checked in" is the same green pill on Bookings, Calendar, Units and Guests, and no screen
// prints a raw code such as checked_in.
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const TONE_BG = /\bbg-(?:success|warning|danger|critical|info|neutral|accent)-bg\b|\bTONE(?:_STYLE)?\[[^\]]+\]\.bg\b|\bt\.bg\b/;
const PATTERNS = [
  { re: /\bfunction\s+(?:StatusPill|Pill|StateBadge|StatusChip|StatusMenu)\b/, msg: m => `private ${m[0].replace('function ', '')}: use StatusBadge / StatusMenu from components/StatusBadge` },
  { re: /<Badge[\s>/]/, msg: '<Badge>: use <StatusBadge entity value> (or tone + label for a one-off flag)' },
  { re: /<Chip\s+tone=/, msg: '<Chip tone>: use <StatusBadge>' },
  { re: /\b(?:STATUS_TONE|STATUS_LABEL|STATE_TONE|STATE_LABEL|READY_TONE|TASK_TONE|RES_TONE|COND_TONE|V_TONE|D_TONE|CLEAN_STATUS)\b/, msg: m => `local status map ${m[0]}: status words and colours live in src/lib/status.ts` },
  { re: /\b(?:RESERVATION|READINESS|TASK|STATEMENT|PAYOUT|INTEGRATION|SYNC|STATUS)\[[^\]]+\]\.(?:label|tone)\b/, msg: m => `${m[0]}: use <StatusBadge entity value> or statusLabel()` },
];

export const allow = {
  'src/components/StatusBadge.tsx': 'The status pill itself.',
  'src/lib/status.ts': 'The status vocabulary itself.',
};

export const def = {
  name: 'status-pills',
  rule: 'status pills only through <StatusBadge>, words and colours only from src/lib/status.ts',
  files: () => srcFiles(),
  allow,
  scan(text) {
    const code = stripComments(text);
    const hits = lineHits(code, PATTERNS);
    code.split('\n').forEach((line, i) => {
      // A tinted rounded button (a step or a filter) is a control, not a status pill.
      if (/\brounded-(?:full|pill)\b|borderRadius:\s*'var\(--radius-pill\)'/.test(line) && TONE_BG.test(line) && !/cursor-pointer/.test(line)) {
        hits.push({ line: i + 1, msg: 'hand-rolled status pill (rounded + status tint): use <StatusBadge>', text: line.trim().slice(0, 160) });
      }
    });
    return hits;
  },
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "function StatusPill({ status }) { return <span className={cx('rounded-full px-2', TONE[t].bg)}>{STATUS_LABEL[status]}</span>; }" },
      { path: 'src/pages/Y.tsx', text: '<Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} />' },
      { path: 'src/pages/Z.tsx', text: '<span className="rounded-pill bg-warning-bg text-warning px-2">Pending</span>' },
    ],
    good: [{ path: 'src/pages/X.tsx', text: '<StatusBadge entity="statement" value={s.state} size="sm" /> <StatusBadge tone="danger" label="Missing ID" />' }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
