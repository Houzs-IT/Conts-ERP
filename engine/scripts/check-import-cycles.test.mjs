import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runCycleCheck } from './check-import-cycles.mjs';

const silentLog = { log() {}, error() {} };

describe('check-import-cycles', () => {
  let workDir;
  let packageDir;
  let baselinePath;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cycles-test-'));
    packageDir = join(workDir, 'backend');
    mkdirSync(join(packageDir, 'src'), { recursive: true });
    baselinePath = join(workDir, 'baseline.json');
  });

  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  function check(options = {}) {
    return runCycleCheck({ packageDir, baselinePath, log: silentLog, ...options });
  }

  function writeSource(name, content) {
    writeFileSync(join(packageDir, 'src', name), content);
  }

  it('fails on a new cycle without a baseline and passes once baselined', () => {
    writeSource('a.ts', "import { b } from './b.js';\nexport const a = b;\n");
    writeSource('b.ts', "import { a } from './a';\nexport const b = a;\n");
    assert.equal(check(), 1);
    assert.equal(check({ shouldUpdate: true }), 0);
    assert.equal(check(), 0);
  });

  it('refuses --update when a new file would join an existing baseline', () => {
    writeSource('a.ts', "import './b';\n");
    writeSource('b.ts', "import './a';\n");
    check({ shouldUpdate: true });
    writeSource('c.ts', "import './a';\n");
    writeSource('a.ts', "import './b';\nimport './c';\n");
    assert.equal(check(), 1);
    assert.equal(check({ shouldUpdate: true }), 1);
  });

  it('ignores a type-only back edge', () => {
    writeSource('a.ts', "import { b } from './b';\nexport const a = b;\n");
    writeSource('b.ts', "import type { a } from './a';\nexport const b = 1;\n");
    assert.equal(check(), 0);
  });
});
