// All UI text is English, and nothing in the app uses emoji (icons come from lucide-react).
// Scans code and comments alike: a Chinese note in a comment ends up pasted into a label sooner or later.
import { runCheck, runIfMain, srcFiles, walk, read, lineHits } from './_lib.mjs';

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯　-〿！-｠]/u;
// Extended_Pictographic minus the plain typographic marks (c) (r) TM and the arrows, which are ordinary text.
const EMOJI = /(?![©®™←-⇿])\p{Extended_Pictographic}|\u{FE0F}/u;

export const cjk = {
  name: 'english-only',
  rule: 'no Chinese / Japanese / Korean characters in src/',
  files: () => srcFiles(),
  scan: (text) => lineHits(text, [{ re: CJK, msg: m => `non-English character "${m[0]}"` }]),
  selfTest: {
    bad: [{ path: 'src/pages/X.tsx', text: "<h1>用户管理</h1>" }, { path: 'src/pages/Y.tsx', text: "label: '保存'," }],
    good: [{ path: 'src/pages/X.tsx', text: "<h1>Users and roles</h1> <span>16 Sep – 29 Sep · RM 1,250.00 → next</span>" }],
  },
};

export const emoji = {
  name: 'no-emoji',
  rule: 'no emoji in src/ or functions/ (use lucide icons)',
  files: () => [...srcFiles(), ...walk('functions')],
  scan: (text) => lineHits(text, [{ re: EMOJI, msg: m => `emoji "${m[0]}"` }]),
  selfTest: {
    bad: [{ path: 'src/pages/X.tsx', text: "toast({ title: 'Saved ✅' })" }, { path: 'functions/api/x.ts', text: "const msg = 'Booking confirmed \u{1F389}';" }],
    good: [{ path: 'src/pages/X.tsx', text: "<span>© The Conts → next · 16 Sep – 29 Sep ✓</span>" }],
  },
};

if (process.argv[1] && process.argv[1].endsWith('english-only.mjs')) process.exit(runCheck(cjk) + runCheck(emoji) ? 1 : 0);
void runIfMain; void read;
