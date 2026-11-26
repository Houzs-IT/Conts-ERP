#!/usr/bin/env node
// Raw hex colour ratchet for engine/frontend/src. Copied Houzs screens keep Houzs hex on purpose
// (conts/palette.mjs swaps them at build), so existing counts are recorded per file in
// hex-colours-baseline.json and may only fall. A file with no entry has a ceiling of zero.
//
// Usage, from inside engine/frontend:
//   node ../scripts/check-hex-colours.mjs            # gate
//   node ../scripts/check-hex-colours.mjs --update   # write ceilings down after removing colours
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.css'];
const SKIPPED_PATH_PATTERN = /node_modules|[\\/]__tests__[\\/]|\.test\.|\.spec\./;
const EXEMPT_FILES = new Set(['src/conts/embed.css', 'src/vendor/design-system/tokens.css']);
// Mirrors scripts/checks/colours.mjs: a 3 or 4 digit hash counts only with a letter or a repeated digit,
// so record ids like "#105" or "#2207" are not colours.
const HEX_COLOUR_PATTERN =
  /(?<=^|[\s'"`(,:[{=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,4}|([0-9])\1\1\1?)(?![\w-])/gm;
const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'hex-colours-baseline.json');

export function countHexColours(sourceText) {
  return [...sourceText.matchAll(HEX_COLOUR_PATTERN)].length;
}

function listSourceFiles(directory, collected = []) {
  for (const entryName of readdirSync(directory)) {
    const fullPath = join(directory, entryName);
    if (SKIPPED_PATH_PATTERN.test(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) listSourceFiles(fullPath, collected);
    else if (SOURCE_EXTENSIONS.some((extension) => entryName.endsWith(extension))) collected.push(fullPath);
  }
  return collected;
}

export function countHexColoursByFile(packageDir) {
  const countsByFile = {};
  for (const filePath of listSourceFiles(join(packageDir, 'src'))) {
    const portablePath = relative(packageDir, filePath).split(sep).join('/');
    if (EXEMPT_FILES.has(portablePath)) continue;
    const hexCount = countHexColours(readFileSync(filePath, 'utf8'));
    if (hexCount) countsByFile[portablePath] = hexCount;
  }
  return Object.fromEntries(Object.entries(countsByFile).sort(([left], [right]) => left.localeCompare(right)));
}

function sumCounts(countsByFile) {
  return Object.values(countsByFile).reduce((total, hexCount) => total + hexCount, 0);
}

export function runHexColourCheck({ packageDir, baselinePath = BASELINE_PATH, shouldUpdate = false, log = console }) {
  const hasBaseline = existsSync(baselinePath);
  const ceilingsByFile = hasBaseline ? JSON.parse(readFileSync(baselinePath, 'utf8')).files : {};
  const currentCounts = countHexColoursByFile(packageDir);
  const raisedFiles = Object.entries(currentCounts).filter(([filePath, hexCount]) => hexCount > (ceilingsByFile[filePath] ?? 0));
  const loweredFiles = Object.entries(ceilingsByFile).filter(([filePath, ceiling]) => (currentCounts[filePath] ?? 0) < ceiling);

  if (shouldUpdate) {
    if (hasBaseline && raisedFiles.length) {
      log.error(`[hex] REFUSING to write, ${raisedFiles.length} ceiling(s) would go up:`);
      for (const [filePath, hexCount] of raisedFiles) log.error(`         ${filePath}: ${ceilingsByFile[filePath] ?? 0} -> ${hexCount}`);
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify({ total: sumCounts(currentCounts), files: currentCounts }, null, 2)}\n`);
    log.log(`[hex] wrote ${Object.keys(currentCounts).length} file ceiling(s), ${sumCounts(currentCounts)} colour(s)`);
    return 0;
  }

  if (loweredFiles.length) {
    log.log(`[hex] ${loweredFiles.length} file(s) are under their ceiling. Run \`npm run lint:hex:update\` and commit to lock it in:`);
    for (const [filePath, ceiling] of loweredFiles) log.log(`         ${filePath}: ${ceiling} -> ${currentCounts[filePath] ?? 0}`);
  }

  if (raisedFiles.length) {
    log.error(`[hex] ${raisedFiles.length} file(s) gained raw hex colours:`);
    for (const [filePath, hexCount] of raisedFiles) log.error(`    ${filePath}: ${hexCount} (ceiling ${ceilingsByFile[filePath] ?? 0})`);
    log.error('  Use a theme token or CSS variable instead. Do not raise the number in hex-colours-baseline.json.');
    return 1;
  }

  log.log(`[hex] OK, ${sumCounts(currentCounts)} raw hex colour(s), all at or under ceiling.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runHexColourCheck({ packageDir: process.cwd(), shouldUpdate: process.argv.includes('--update') }));
}
