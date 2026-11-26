#!/usr/bin/env node
// Swaps raw hex colours in engine screens for the theme token whose light value is that same colour, so light renders
// unchanged and the night skin (conts/embed.css) reaches them. A colour is swapped only for the role of the property
// it sits on (fill, edge or ink). Night turns fills dark and inks light, so fills and inks only move together: a file
// that holds a light or dark colour the table cannot swap keeps all its fills and inks (a kept dark ink on a swapped
// fill, or a swapped ink on a kept light fill, would vanish on night) and swaps only its edges.
//
// Usage, from inside engine/frontend:
//   node ../scripts/hex-to-tokens.mjs src/pages/scm-v2            # report what would change
//   node ../scripts/hex-to-tokens.mjs --write src/pages/scm-v2    # change the files
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend');
const requireFromFrontend = createRequire(join(FRONTEND_DIR, 'package.json'));
const ts = requireFromFrontend('typescript');
const postcss = requireFromFrontend('postcss');

const TOKEN_BY_ROLE = {
  fill: {
    ffffff: 'rgb(var(--eng-surface))', f4f6f3: 'rgb(var(--eng-surface-2))', e3e6e0: 'rgb(var(--eng-surface-dim))',
    eef0ec: 'rgb(var(--eng-bg))', e1efed: 'rgb(var(--eng-primary-soft))',
  },
  edge: {
    d6d9d2: 'rgb(var(--eng-border))', e3e6e0: 'rgb(var(--eng-border-subtle))', c2c6bd: 'rgb(var(--eng-border-strong))',
    '0c3f39': 'rgb(var(--eng-primary-ink))', '16695f': 'var(--c-orange)',
  },
  ink: {
    '11140f': 'rgb(var(--eng-ink))', '414539': 'rgb(var(--eng-ink-secondary))', '767b6e': 'var(--fg-muted)',
    '9aa093': 'var(--fg-soft)', '0c3f39': 'rgb(var(--eng-primary-ink))', '16695f': 'var(--c-orange)',
    b8331f: 'var(--c-festive-b)', '2f5d4f': 'var(--c-secondary-a)',
  },
};
const EDGE_PROPERTY = /^(border(-(top|right|bottom|left))?(-color)?|outline(-color)?)$/;
const HEX_IN_VALUE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const LIGHT_LUMINANCE = 0.5;
const DARK_LUMINANCE = 0.2;

const normaliseHex = (digits) => (digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits).toLowerCase();

function luminance(hexDigits) {
  const [red, green, blue] = [0, 2, 4].map((at) => parseInt(hexDigits.slice(at, at + 2), 16) / 255)
    .map((unit) => (unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function roleOf(propertyName) {
  const kebab = propertyName.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (kebab === 'background' || kebab === 'background-color') return 'fill';
  if (EDGE_PROPERTY.test(kebab)) return 'edge';
  if (kebab === 'color') return 'ink';
  return null;
}

// Every token must resolve to its key in light, read from the files that define it, or the swap would change light.
export function assertTokensMatchLight() {
  const engineRoot = readFileSync(join(FRONTEND_DIR, 'src/index.css'), 'utf8');
  const designTokens = readFileSync(join(FRONTEND_DIR, 'src/vendor/design-system/tokens.css'), 'utf8');
  const lightValueOf = (token) => {
    const channels = /^rgb\(var\((--eng-[a-z0-9-]+)\)\)$/.exec(token);
    if (channels) {
      const triple = new RegExp(`${channels[1]}:\\s*(\\d+) (\\d+) (\\d+);`).exec(engineRoot);
      return triple ? triple.slice(1).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('') : null;
    }
    const name = /^var\((--[a-z0-9-]+)\)$/.exec(token)?.[1];
    return name ? normaliseHex(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(designTokens)?.[1] ?? '') : null;
  };
  const mismatches = Object.values(TOKEN_BY_ROLE).flatMap((tokens) =>
    Object.entries(tokens).filter(([hexDigits, token]) => lightValueOf(token) !== hexDigits).map(([hexDigits, token]) => `${hexDigits} ${token}`));
  if (mismatches.length) throw new Error(`tokens whose light value differs from the colour they replace: ${mismatches.join(', ')}`);
}

function blockersIn(colourUses) {
  let hasLoneLight = false;
  let hasLoneDark = false;
  for (const { hexDigits, role } of colourUses) {
    if (role && TOKEN_BY_ROLE[role][hexDigits]) continue;
    if (role !== 'ink' && luminance(hexDigits) > LIGHT_LUMINANCE) hasLoneLight = true;
    if (role !== 'fill' && luminance(hexDigits) < DARK_LUMINANCE) hasLoneDark = true;
  }
  const swapsBoth = !hasLoneLight && !hasLoneDark;
  return { swapsInk: swapsBoth, swapsFill: swapsBoth };
}

function swapIn(value, role, allowed) {
  if (!role || (role === 'ink' && !allowed.swapsInk) || (role === 'fill' && !allowed.swapsFill)) return { value, swaps: 0 };
  let swaps = 0;
  const next = value.replace(HEX_IN_VALUE, (whole, digits) => {
    const token = TOKEN_BY_ROLE[role][normaliseHex(digits)];
    if (!token) return whole;
    swaps += 1;
    return token;
  });
  return { value: next, swaps };
}

const usesIn = (value, role) => [...value.matchAll(HEX_IN_VALUE)].map((match) => ({ hexDigits: normaliseHex(match[1]), role }));

export function transformCss(sourceText) {
  const root = postcss.parse(sourceText);
  const uses = [];
  root.walkDecls((declaration) => uses.push(...usesIn(declaration.value, roleOf(declaration.prop))));
  const allowed = blockersIn(uses);
  let swaps = 0;
  root.walkDecls((declaration) => {
    const result = swapIn(declaration.value, roleOf(declaration.prop), allowed);
    swaps += result.swaps;
    declaration.value = result.value;
  });
  return { text: root.toString(), swaps, ...allowed };
}

const isStyleScope = (node) => {
  for (let current = node; current; current = current.parent) {
    if (ts.isJsxAttribute(current) && current.name.getText() === 'style') return true;
    if (current.type && /CSSProperties/.test(current.type.getText())) return true;
    if (ts.isSatisfiesExpression?.(current) && /CSSProperties/.test(current.type.getText())) return true;
  }
  return false;
};

function propertyRoleOf(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isPropertyAssignment(current)) {
      if (current.name === node) return null;
      const name = ts.isIdentifier(current.name) || ts.isStringLiteral(current.name) ? current.name.text : '';
      return roleOf(name);
    }
    if (ts.isJsxAttribute(current) || ts.isFunctionLike(current)) return null;
  }
  return null;
}

export function transformTsx(sourceText, fileName = 'screen.tsx') {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const literals = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const raw = sourceText.slice(node.getStart(sourceFile), node.end);
      if (HEX_IN_VALUE.test(raw)) {
        HEX_IN_VALUE.lastIndex = 0;
        const role = isStyleScope(node) ? propertyRoleOf(node) : null;
        literals.push({ start: node.getStart(sourceFile), end: node.end, raw, role });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const allowed = blockersIn(literals.flatMap(({ raw, role }) => usesIn(raw, role)));
  let swaps = 0;
  let text = sourceText;
  for (const literal of [...literals].reverse()) {
    const result = swapIn(literal.raw, literal.role, allowed);
    swaps += result.swaps;
    text = text.slice(0, literal.start) + result.value + text.slice(literal.end);
  }
  return { text, swaps, ...allowed };
}

function listFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).flatMap((name) => listFiles(join(target, name)))
    .filter((path) => /\.(tsx|css)$/.test(path) && !/\.test\.|[\\/]__tests__[\\/]/.test(path));
}

function main(argv) {
  assertTokensMatchLight();
  const shouldWrite = argv.includes('--write');
  const targets = argv.filter((argument) => argument !== '--write');
  let totalSwaps = 0;
  for (const file of targets.flatMap((target) => listFiles(resolve(target)))) {
    const sourceText = readFileSync(file, 'utf8');
    const result = file.endsWith('.css') ? transformCss(sourceText) : transformTsx(sourceText, file);
    if (!result.swaps) continue;
    totalSwaps += result.swaps;
    const heldBack = [!result.swapsInk && 'inks', !result.swapsFill && 'fills'].filter(Boolean).join(' and ');
    console.log(`${result.swaps}\t${file}${heldBack ? `\t(kept ${heldBack})` : ''}`);
    if (shouldWrite) writeFileSync(file, result.text);
  }
  console.log(`${shouldWrite ? 'swapped' : 'would swap'} ${totalSwaps} colour(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
