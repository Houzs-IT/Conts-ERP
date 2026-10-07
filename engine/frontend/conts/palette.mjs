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
  // dark slab (sidebar, sign-in page): ink-green -> black
  '13201c': '151515',
  'e7eae4': 'dedad3',
  '8c968a': '8a8680',
  '6f786d': '6e6a64',
  '1d2519': '1e1e1e',
  '141b13': '151515',
  '0c110b': '0d0d0d',
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
