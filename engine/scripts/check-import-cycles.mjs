#!/usr/bin/env node
// Import-cycle ratchet. Existing runtime import cycles are known debt, recorded in
// import-cycles-baseline.json. A file that newly enters a cycle fails the check;
// cycles may shrink but never grow. Type-only and dynamic imports are ignored
// because they do not create a load-time cycle.
//
// Usage, from inside engine/backend or engine/frontend:
//   node ../scripts/check-import-cycles.mjs            # gate
//   node ../scripts/check-import-cycles.mjs --update   # rewrite this package's baseline entry
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
const SKIPPED_PATH_PATTERN = /node_modules|[\\/]vendor[\\/]|[\\/]dist[\\/]|\.test\.|\.spec\./;
const FROM_IMPORT_PATTERN = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s+['"](\.[^'"]+)['"]/gm;
const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'import-cycles-baseline.json');

function listSourceFiles(directory, collected = []) {
  for (const entryName of readdirSync(directory)) {
    const fullPath = join(directory, entryName);
    if (SKIPPED_PATH_PATTERN.test(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) listSourceFiles(fullPath, collected);
    else if (SOURCE_EXTENSIONS.some((extension) => entryName.endsWith(extension)) && !entryName.endsWith('.d.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function resolveRelativeImport(importerPath, specifier) {
  const basePath = resolve(dirname(importerPath), specifier.replace(/\.js$/, ''));
  const candidates = [
    basePath,
    ...SOURCE_EXTENSIONS.map((extension) => basePath + extension),
    ...SOURCE_EXTENSIONS.map((extension) => join(basePath, `index${extension}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function buildImportGraph(sourceFiles) {
  const graph = new Map();
  for (const importerPath of sourceFiles) {
    const sourceText = readFileSync(importerPath, 'utf8');
    const importedPaths = new Set();
    for (const pattern of [FROM_IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN]) {
      for (const match of sourceText.matchAll(pattern)) {
        const importedPath = resolveRelativeImport(importerPath, match[1]);
        if (importedPath) importedPaths.add(importedPath);
      }
    }
    graph.set(importerPath, [...importedPaths]);
  }
  return graph;
}

function findStronglyConnectedGroups(graph) {
  let nextIndex = 0;
  const stack = [];
  const isOnStack = new Set();
  const discoveryIndex = new Map();
  const lowLink = new Map();
  const groups = [];

  function visit(node) {
    discoveryIndex.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    isOnStack.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (!discoveryIndex.has(neighbor)) {
        visit(neighbor);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(neighbor)));
      } else if (isOnStack.has(neighbor)) {
        lowLink.set(node, Math.min(lowLink.get(node), discoveryIndex.get(neighbor)));
      }
    }
    if (lowLink.get(node) === discoveryIndex.get(node)) {
      const group = [];
      let member;
      do {
        member = stack.pop();
        isOnStack.delete(member);
        group.push(member);
      } while (member !== node);
      if (group.length > 1) groups.push(group);
    }
  }

  for (const node of graph.keys()) if (!discoveryIndex.has(node)) visit(node);
  return groups;
}

function toPortablePath(packageDir, absolutePath) {
  return relative(packageDir, absolutePath).split(sep).join('/');
}

export function findImportCycleGroups(packageDir) {
  const sourceFiles = listSourceFiles(join(packageDir, 'src'));
  return findStronglyConnectedGroups(buildImportGraph(sourceFiles))
    .map((group) => group.map((filePath) => toPortablePath(packageDir, filePath)).sort())
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function filesOf(groups) {
  return new Set(groups.flat());
}

export function compareToBaseline(currentGroups, baselineGroups) {
  const baselineFiles = filesOf(baselineGroups);
  const currentFiles = filesOf(currentGroups);
  return {
    offendingGroups: currentGroups.filter((group) => group.some((filePath) => !baselineFiles.has(filePath))),
    slackGroups: baselineGroups.filter((group) => group.every((filePath) => !currentFiles.has(filePath))),
  };
}

export function runCycleCheck({ packageDir, baselinePath = BASELINE_PATH, shouldUpdate = false, log = console }) {
  const packageKey = basename(packageDir);
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const hasPackageBaseline = packageKey in baseline;
  const baselineGroups = baseline[packageKey] ?? [];
  const currentGroups = findImportCycleGroups(packageDir);
  const { offendingGroups, slackGroups } = compareToBaseline(currentGroups, baselineGroups);
  const cyclicFileCount = filesOf(currentGroups).size;

  if (shouldUpdate) {
    const addedFiles = hasPackageBaseline ? offendingGroups.flat().filter((filePath) => !filesOf(baselineGroups).has(filePath)) : [];
    if (addedFiles.length) {
      log.error(`[cycles] ${packageKey}: REFUSING to write, ${addedFiles.length} file(s) would be added to the baseline:`);
      for (const filePath of addedFiles) log.error(`         ${filePath}`);
      return 1;
    }
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, [packageKey]: currentGroups }, null, 2)}\n`);
    log.log(`[cycles] ${packageKey}: wrote ${currentGroups.length} group(s), ${cyclicFileCount} file(s) to ${basename(baselinePath)}`);
    return 0;
  }

  if (slackGroups.length) {
    log.log(`[cycles] ${packageKey}: ${slackGroups.length} baseline group(s) are no longer cyclic (slack). Run with --update and commit to lock it in.`);
    for (const group of slackGroups) log.log(`         ${group.join(', ')}`);
  }

  if (offendingGroups.length) {
    log.error(`[cycles] ${packageKey}: ${offendingGroups.length} import cycle(s) include files not in the baseline:`);
    for (const group of offendingGroups) {
      log.error(`  cycle of ${group.length} file(s):`);
      for (const filePath of group) log.error(`    ${filePath}`);
    }
    log.error('  Break the cycle by moving the shared code down a layer so imports flow one way.');
    return 1;
  }

  log.log(`[cycles] ${packageKey}: OK, ${currentGroups.length} group(s), ${cyclicFileCount} file(s), all in the baseline.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCycleCheck({ packageDir: process.cwd(), shouldUpdate: process.argv.includes('--update') }));
}
