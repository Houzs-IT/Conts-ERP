// The browser's own confirm / alert / prompt boxes are banned: they cannot say what an action affects, cannot ask for
// a reason, and look like a scam pop-up on a phone. Use <ConfirmDialog> (or useConfirm()) and toasts.
import { runCheck, runIfMain, srcFiles, stripComments, lineHits } from './_lib.mjs';

const PATTERNS = [
  { re: /\bwindow\.(?:confirm|alert|prompt)\s*\(/, msg: m => `${m[0].replace(/\s*\($/, '')}(): use ConfirmDialog / useConfirm() or a toast` },
  { re: /(?<![.\w$])(?<!function )(?:confirm|alert|prompt)\(/, msg: m => `${m[0].replace(/\s*\($/, '')}(): use ConfirmDialog / useConfirm() or a toast` },
];

export const def = {
  name: 'no-browser-dialogs',
  rule: 'no window.confirm / alert / prompt; use ConfirmDialog',
  files: () => srcFiles(),
  scan: (text) => lineHits(stripComments(text), PATTERNS),
  selfTest: {
    bad: [
      { path: 'src/pages/X.tsx', text: "if (!window.confirm('Delete?')) return;" },
      { path: 'src/pages/Y.tsx', text: "if (confirm('Delete?')) go();" },
    ],
    good: [{ path: 'src/pages/X.tsx', text: "const ok = await askConfirm({ title: 'Delete?' }); spec.onConfirm(); async function confirmStep() {}" }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
