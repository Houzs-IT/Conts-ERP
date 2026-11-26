import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { countHexColours, runHexColourCheck } from './check-hex-colours.mjs';

const silentLog = { log() {}, error() {} };

describe('check-hex-colours', () => {
  let workDir;
  let packageDir;
  let baselinePath;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hex-test-'));
    packageDir = join(workDir, 'frontend');
    mkdirSync(join(packageDir, 'src'), { recursive: true });
    baselinePath = join(workDir, 'baseline.json');
  });

  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  function check(options = {}) {
    return runHexColourCheck({ packageDir, baselinePath, log: silentLog, ...options });
  }

  function writeSource(name, content) {
    writeFileSync(join(packageDir, 'src', name), content);
  }

  it('counts real colours and skips record ids and anchors', () => {
    assert.equal(countHexColours("color: '#A8352F'; bg: #fff; border: #333;"), 3);
    assert.equal(countHexColours('Unit #105, order #2207, <a href="#/guests">'), 0);
  });

  it('fails when a file gains a hex colour', () => {
    writeSource('a.tsx', "const tone = '#ffffff';\n");
    assert.equal(check({ shouldUpdate: true }), 0);
    writeSource('a.tsx', "const tone = '#ffffff';\nconst edge = '#000000';\n");
    assert.equal(check(), 1);
    assert.equal(check({ shouldUpdate: true }), 1);
  });

  it('fails when a new file has a hex colour', () => {
    assert.equal(check({ shouldUpdate: true }), 0);
    writeSource('b.css', '.x { color: #abc; }\n');
    assert.equal(check(), 1);
  });

  it('passes when a hex colour is removed and lets the ceiling fall', () => {
    writeSource('a.tsx', "const tone = '#ffffff';\nconst edge = '#000000';\n");
    check({ shouldUpdate: true });
    writeSource('a.tsx', "const tone = '#ffffff';\n");
    assert.equal(check(), 0);
    assert.equal(check({ shouldUpdate: true }), 0);
    writeSource('a.tsx', "const tone = '#ffffff';\nconst edge = '#000000';\n");
    assert.equal(check(), 1);
  });
});
