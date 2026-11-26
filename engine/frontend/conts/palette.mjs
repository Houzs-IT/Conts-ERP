// Conts's colours for the supply chain engine. The copied screens keep Houzs's colour values in their
// source (about 80 files hard-code them); this one table swaps them when the app is built, so the copied
// code stays as Houzs wrote it and a newer copy can replace it without redoing the colours.
// Used by tailwind.config.js (theme), postcss.config.js (all compiled CSS) and vite.config.ts (inline
// colours in components). Values on the right are The Conts tokens (tokens.css at the repository root).

/** Houzs hex -> Conts hex, lower case, no leading '#'. */
export const PALETTE = {
  // functional accent: Houzs petrol -> Conts black
  '16695f': '151515',
  '0c3f39': '2b2b2b',
  'e1efed': 'f6efe2',
  // brand accent: Houzs brass -> Conts champagne gold
  'a16a2e': '8a6a2f',
  'f3ece0': 'fbf7f0',
  'd8a85a': 'c8a46a',
  '8a5a26': '75581f',
  '5a3a14': '5a4520',
  // canvas, borders, ink: cool green-grey -> warm white
  'eef0ec': 'faf9f6',
  'f4f6f3': 'f5f4f0',
  'e3e6e0': 'edeae4',
  'd6d9d2': 'dedad3',
  'c2c6bd': 'c7c1b6',
  '11140f': '151515',
  '414539': '4a4844',
  '767b6e': '706d67',
  // soft grey (meta text, empty values, 195 uses): 2.68:1 on white, under AA. The muted ink is the lightest warm grey
  // that passes on the page (4.7:1 on #F5F4F0), so soft text shares it.
  '9aa093': '706d67',
  // dark slab (sidebar, sign-in page): ink-green -> black
  '13201c': '151515',
  'e7eae4': 'dedad3',
  '8c968a': '8a8680',
  '6f786d': '6e6a64',
  '1d2519': '1e1e1e',
  '141b13': '151515',
  '0c110b': '0d0d0d',
  // status colours: the same meaning reads the same in both builds. scripts/checks/engine-palette.mjs keeps these equal
  // to tokens.json (success, critical, warning: text, then tint).
  '2f8a5b': '11694a',
  'e2f0e9': 'e9f5ef',
  'b23a3a': 'a8352f',
  'f8eaea': 'fceceb',
  '6e4d12': '8a5a12',
  'f6efd9': 'fff4d8',
};

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const HEX_KEYS = Object.keys(PALETTE).join('|');
// A colour inside a Tailwind arbitrary value, e.g. bg-[#16695f], is part of a class NAME: the name must stay
// as written so it still matches its generated rule, whose declared value is recoloured in CSS instead.
const HEX_IN_SOURCE = new RegExp(`(?<!\\[[^\\]\\s"'\`]*)#(${HEX_KEYS})(?![0-9a-fA-F])`, 'gi');
const HEX_IN_CSS = new RegExp(`#(${HEX_KEYS})(?![0-9a-fA-F])`, 'gi');
// Written as channels, Houzs's petrol is always a translucent tint (active rows, glows on the dark slab),
// where black would vanish: those become gold. As a solid hex it stays the black functional accent.
const TINTS = { '16695f': 'c8a46a' };
const TRIPLES = Object.entries({ ...PALETTE, ...TINTS }).map(([from, to]) => {
  const [r, g, b] = rgb(from);
  return { re: new RegExp(`(?<![\\d.])${r}(\\s*,\\s*|\\s+)${g}(\\s*,\\s*|\\s+)${b}(?![\\d.])`, 'g'), to: rgb(to) };
});
const swapHex = (m, hex) => '#' + PALETTE[hex.toLowerCase()];
// Petrol at full strength (no alpha, or Tailwind's opacity variable, which is 1) is still the solid accent.
const SOLID_PETROL = /22(\s*,\s*|\s+)105(\s*,\s*|\s+)95(\s*\)|\s*\/\s*var\()/g;
const swapTriples = (s) => TRIPLES.reduce(
  (acc, t) => acc.replace(t.re, (_m, a, b) => `${t.to[0]}${a}${t.to[1]}${b}${t.to[2]}`),
  s.replace(SOLID_PETROL, (_m, a, b, tail) => `21${a}21${b}21${tail}`),
);

/** A CSS declaration value: hex colours and rgb()/rgba() channel triples. */
export const recolourCssValue = (value) => swapTriples(value.replace(HEX_IN_CSS, swapHex));

/** Component source: hex colours outside class names, and channel triples inside rgb()/rgba(). */
export const recolourSource = (code) =>
  code.replace(HEX_IN_SOURCE, swapHex).replace(/rgba?\([^)]*\)/g, (m) => swapTriples(m));

/** Any nested object of colour strings (the Tailwind theme). */
export const recolourTheme = (v) =>
  typeof v === 'string' ? recolourCssValue(v)
    : Array.isArray(v) ? v.map(recolourTheme)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recolourTheme(x)]))
    : v;

/** PostCSS plugin: recolours every declaration value in the compiled CSS. */
export const contsPalettePostcss = () => ({
  postcssPlugin: 'conts-palette',
  Declaration(decl) {
    const next = recolourCssValue(decl.value);
    if (next !== decl.value) decl.value = next;
  },
});
contsPalettePostcss.postcss = true;

// Night for the copied CSS: a Houzs literal never changes on the night skin, so before the swap above this step points
// the common ones at a theme variable whose light value is that same literal (engineThemeVars.test.ts,
// nightCss.test.ts), so light is unchanged and night (src/conts/embed.css) recolours them. The role comes from the
// property: white is a surface as a background but stays white as text.
const eng = (name) => `rgb(var(--eng-${name}))`;
const token = (name, hex) => `var(--${name}, #${hex})`;
const INK = {
  '11140f': eng('ink'),
  '0c3f39': eng('primary-ink'),
  '767b6e': token('fg-muted', '767b6e'),
  '9aa093': token('fg-soft', '9aa093'),
  '16695f': token('c-orange', '16695f'),
  'b8331f': token('c-festive-b', 'b8331f'),
  '2f5d4f': token('c-secondary-a', '2f5d4f'),
};
const SURFACE = {
  fff: eng('surface'),
  ffffff: eng('surface'),
  'f4f6f3': eng('surface-2'),
  'e3e6e0': eng('surface-dim'),
  'd6d9d2': eng('border'),
};
const LINE = { ...INK, ...SURFACE, 'e3e6e0': eng('border-subtle') };
// A dark accent fill with white text (a chosen pill, a main button) turns into the night chosen-pill pair together, so
// the text never ends up light on light.
const PICK = {
  '16695f': token('conts-pick-fill', '16695f'),
  '0c3f39': token('conts-pick-fill', '0c3f39'),
  fff: token('conts-pick-ink', 'fff'),
  ffffff: token('conts-pick-ink', 'ffffff'),
};
const DARK_ACCENTS = new Set(['16695f', '0c3f39']);
const HEX_LITERAL = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi;
const URL_PART = /(url\([^)]*\))/i;
const VAR_FALLBACK_BEFORE = /var\(\s*--[\w-]+\s*,\s*$/;
const roleOf = (prop) =>
  /^(color|fill|stroke|caret-color|text-decoration-color)$/.test(prop) ? 'ink'
    : /^background(-color|-image)?$/.test(prop) ? 'surface'
    : /^(border|outline)(-|$)/.test(prop) ? 'line'
    : null;
const TABLE_BY_ROLE = { ink: INK, surface: SURFACE, line: LINE };
const hexesIn = (value) => value.split(URL_PART).filter((part) => !URL_PART.test(part))
  .flatMap((part) => [...part.matchAll(HEX_LITERAL)].map((match) => match[1].toLowerCase()));
const isNightScoped = (rule) => {
  for (let node = rule; node; node = node.parent) {
    if (node.type === 'rule' && node.selector.includes('data-beta-skin')) return true;
    if (node.type === 'atrule' && node.params.includes('prefers-color-scheme')) return true;
  }
  return false;
};

const ownDecls = (rule) => rule.nodes.filter((node) => node.type === 'decl' && !node.prop.startsWith('--'));
const isOwnPick = (decls) =>
  decls.some((decl) => roleOf(decl.prop) === 'surface' && hexesIn(decl.value).some((hex) => DARK_ACCENTS.has(hex)))
  && decls.some((decl) => decl.prop === 'color' && /^#f{3}(f{3})?$/i.test(decl.value.trim()));
const STATE_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|not\([^)]*\))/g;
const selectorBases = (selector) => selector.split(',').map((part) => part.replace(STATE_PSEUDO, '').trim());

/** Selectors of the rules that pair a dark accent fill with white text: their hover and their insides follow them. */
export const pickSelectorsIn = (root) => {
  const picks = new Set();
  root.walkRules((rule) => {
    if (!isNightScoped(rule) && isOwnPick(ownDecls(rule))) selectorBases(rule.selector).forEach((base) => picks.add(base));
  });
  return picks;
};

/** Maps one rule's own declarations; returns the known literals it left and why. */
export const mapRuleForNight = (rule, picks = new Set()) => {
  const decls = ownDecls(rule);
  const isInsidePick = selectorBases(rule.selector).some((base) =>
    [...picks].some((pick) => base === pick || base.startsWith(`${pick} `) || base.startsWith(`${pick}::`)));
  const isPick = isOwnPick(decls) || isInsidePick;
  const left = [];
  for (const decl of decls) {
    const role = roleOf(decl.prop);
    const leftReason = (hex) =>
      role === null ? 'property has no colour role'
        : role === 'ink' ? 'white or pale text keeps its own fill'
        : role === 'surface' && DARK_ACCENTS.has(hex) ? 'dark accent fill without white text in the same rule'
        : 'dark fill';
    decl.value = decl.value.split(URL_PART).map((part) => URL_PART.test(part) ? part : part.replace(HEX_LITERAL, (literal, digits, offset) => {
      const hex = digits.toLowerCase();
      if (VAR_FALLBACK_BEFORE.test(part.slice(0, offset))) {
        left.push({ prop: decl.prop, hex, reason: 'already a variable fallback' });
        return literal;
      }
      const mapped = (isPick && role ? PICK[hex] : undefined)
        ?? (role ? TABLE_BY_ROLE[role][hex] : undefined);
      if (mapped) return mapped;
      if (KNOWN_NIGHT_LITERALS.has(hex)) left.push({ prop: decl.prop, hex, reason: leftReason(hex) });
      return literal;
    })).join('');
  }
  return left;
};
const KNOWN_NIGHT_LITERALS = new Set([...Object.keys(INK), ...Object.keys(SURFACE)]);

const ENGINE_CSS = /\/engine\/frontend\/src\/(.+\.css)$/;
// These define the theme variables (light and night) rather than read them.
const NIGHT_SKIPPED_FILES = ['conts/embed.css', 'index.css', 'vendor/design-system/tokens.css'];
export const isNightMappedFile = (file) => {
  const pathInSrc = ENGINE_CSS.exec((file ?? '').replace(/\\/g, '/').replace(/\?.*$/, ''))?.[1];
  return pathInSrc !== undefined && !NIGHT_SKIPPED_FILES.includes(pathInSrc);
};

/** PostCSS plugin: runs before contsPalettePostcss, so the fallbacks it writes are swapped too. */
export const contsNightPostcss = () => ({
  postcssPlugin: 'conts-night',
  Once(root) {
    if (!isNightMappedFile(root.source?.input.file)) return;
    const picks = pickSelectorsIn(root);
    root.walkRules((rule) => {
      if (!isNightScoped(rule)) mapRuleForNight(rule, picks);
    });
  },
});
contsNightPostcss.postcss = true;

/** The product and company names written into the copied screens (titles, prompts, placeholders).
 *  Longest first. The company's legal details are not here: they come from the branding settings. */
const WORDING = [
  ['Houzs Century ERP', 'The Conts'],
  ['Houzs ERP', 'The Conts'],
  ['you@houzscentury.com', 'you@theconts.com'],
];
export const rewordSource = (code) => WORDING.reduce((acc, [from, to]) => acc.split(from).join(to), code);

/** Vite plugin: recolours inline colours and swaps the product name in the copied components. */
export const contsPaletteVite = () => ({
  name: 'conts-palette',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('node_modules') || !/\.(tsx?|jsx?)(\?|$)/.test(id)) return null;
    const next = rewordSource(recolourSource(code));
    return next === code ? null : { code: next, map: null };
  },
  transformIndexHtml: (html) => recolourCssValue(html),
});
