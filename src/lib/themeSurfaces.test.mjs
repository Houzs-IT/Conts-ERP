// node --test src/lib/themeSurfaces.test.mjs. Token pairs in src/styles/tokens.css and theme-dark.css that must stay apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

test('no element draws the soft border on the sunken fill, where line-soft and sunken are the same colour', () => {
  const offenders = sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8').split('\n')
      .filter((line) => /\bbg-sunken\b/.test(line) && /--color-line-soft|border-line-soft/.test(line))
      .map((line) => `${file}: ${line.trim().slice(0, 80)}`));
  assert.deepEqual(offenders, []);
});

test('theme.ts falls back to the same faint ink tokens.css defines', () => {
  const faint = /--color-faint:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)?.[1];
  const theme = readFileSync(join(SRC, 'theme.ts'), 'utf8');
  assert.ok(faint);
  assert.match(theme, new RegExp(`var\\(--color-faint, ${faint}\\)`));
});
