// The first download every page waits for: the entry script dist/index.html loads. It was 1,265 KB (283 KB
// gzipped) because Icon imported all of lucide-react; on a phone on 3G that alone is over two seconds before
// anything shows. Houzs keeps the same ceiling (frontend/scripts/check-bundle-size.mjs). Runs on the built
// dist/ (CI builds before it checks); with no build it measures nothing and says so.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { runCheck, runIfMain, ROOT } from './_lib.mjs';

/** Gzipped KB the entry script may weigh. 152 KB on 11 Oct 2026, 173 KB by 21 Oct (the phone library had crept
 *  in through format.ts), 129 KB once it moved out; raise it only with a reason in the PR. */
export const BUDGET_KB = 150;

const SAMPLE = { 'assets/index-fat.js': 283 * 1024, 'assets/index-slim.js': 150 * 1024 };
const gzipKB = (src, rel) => {
  if (rel.startsWith('selftest/')) return SAMPLE[src] / 1024;
  const file = path.join(ROOT, 'dist', src);
  return fs.existsSync(file) ? zlib.gzipSync(fs.readFileSync(file)).length / 1024 : 0;
};

export const def = {
  name: 'entry-bundle',
  rule: `the entry script is at most ${BUDGET_KB} KB gzipped: import heavy libraries lazily, and icons by name`,
  files: () => (fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? ['dist/index.html'] : ['index.html']),
  scan(text, rel) {
    const hits = [];
    for (const m of text.matchAll(/<script[^>]*type="module"[^>]*src="\/?(assets\/[^"]+\.js)"/g)) {
      const kb = gzipKB(m[1], rel);
      if (kb > BUDGET_KB) hits.push({ line: 0, msg: `${m[1]} is ${kb.toFixed(0)} KB gzipped, over the ${BUDGET_KB} KB budget` });
    }
    return hits;
  },
  selfTest: {
    bad: [{ path: 'selftest/index.html', text: '<script type="module" crossorigin src="/assets/index-fat.js"></script>' }],
    good: [{ path: 'selftest/index.html', text: '<script type="module" crossorigin src="/assets/index-slim.js"></script>' }],
  },
};

runIfMain(import.meta.url, def);
