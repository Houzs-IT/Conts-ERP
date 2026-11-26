// Prints which of the common Houzs literals in the engine's CSS the night step maps and which it leaves, and why.
// Run from engine/frontend: node conts/night-css-report.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { isNightMappedFile, mapRuleForNight, pickSelectorsIn } from './palette.mjs';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const KNOWN = /#(fff|ffffff|11140f|d6d9d2|f4f6f3|e3e6e0|0c3f39|767b6e|9aa093|16695f|b8331f|2f5d4f)(?![0-9a-f])/gi;
const countKnown = (root) => {
  let known = 0;
  root.walkDecls((decl) => { known += decl.value.match(KNOWN)?.length ?? 0; });
  return known;
};

let knownTotal = 0;
let leftTotal = 0;
const leftByReason = new Map();
const addLeft = (reason, where, count = 1) => {
  leftTotal += count;
  leftByReason.set(reason, [...(leftByReason.get(reason) ?? []), `${where} (${count})`]);
};
for (const path of readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.css'))) {
  const file = join(SRC_DIR, path);
  const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
  const known = countKnown(root);
  knownTotal += known;
  if (!isNightMappedFile(file)) {
    if (known) addLeft('theme file, skipped', path, known);
    continue;
  }
  root.walkDecls(/^--/, (decl) => {
    const count = decl.value.match(KNOWN)?.length ?? 0;
    if (count) addLeft('custom property, role unknown', `${path} ${decl.prop}`, count);
  });
  const picks = pickSelectorsIn(root);
  root.walkRules((rule) => {
    const isNight = /data-beta-skin/.test(rule.selector);
    const left = isNight ? [] : mapRuleForNight(rule, picks);
    if (isNight) rule.walkDecls((decl) => { const count = decl.value.match(KNOWN)?.length ?? 0; if (count) addLeft('night-only rule', `${path} ${rule.selector}`, count); });
    for (const literal of left) addLeft(literal.reason, `${path} ${rule.selector} { ${literal.prop}: #${literal.hex} }`);
  });
}

console.log(`common literals: ${knownTotal}, mapped: ${knownTotal - leftTotal}, left: ${leftTotal}`);
for (const [reason, places] of leftByReason) {
  console.log(`\n${reason}: ${places.length} place(s)`);
  for (const place of places) console.log(`  ${place}`);
}
