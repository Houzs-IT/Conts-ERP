import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTokensMatchLight, roleOf, transformCss, transformTsx } from './hex-to-tokens.mjs';

test('every token resolves to the colour it replaces in light', () => {
  assert.doesNotThrow(assertTokensMatchLight);
});

test('a property maps to the fill, edge or ink role, and others to none', () => {
  assert.equal(roleOf('backgroundColor'), 'fill');
  assert.equal(roleOf('border-bottom'), 'edge');
  assert.equal(roleOf('borderLeftColor'), 'edge');
  assert.equal(roleOf('color'), 'ink');
  assert.equal(roleOf('scrollbar-color'), 'edge');
  assert.equal(roleOf('box-shadow'), null);
});

test('a css card swaps its fill, edge and ink for tokens', () => {
  const result = transformCss('.card { background: #fff; border: 1px solid #d6d9d2; color: #11140f; }');
  assert.equal(result.text, '.card { background: rgb(var(--eng-surface)); border: 1px solid rgb(var(--eng-border)); color: rgb(var(--eng-ink)); }');
  assert.equal(result.swaps, 3);
});

test('a chosen pill (near-black fill, pale text) flips as a pair through the chosen-pill variables', () => {
  const source = "const pill = <button style={{ border: '1px solid #11140f', background: '#11140f', color: '#f4f6f3' }} />;";
  assert.equal(transformTsx(source).text, "const pill = <button style={{ border: '1px solid var(--badge-pill-chosen-line, #11140f)', background: 'var(--badge-pill-chosen-bg, #11140f)', color: 'var(--badge-pill-chosen-fg, #f4f6f3)' }} />;");
});

test('white text and a petrol fill stay as they are, since night would split the pair', () => {
  const css = '.pill { background: #16695f; color: #fff; }';
  assert.equal(transformCss(css).text, css);
});

test('a light fill the table cannot swap keeps every fill and ink in the file, and edges still swap', () => {
  const result = transformCss('.note { background: #fff8e1; } .card { background: #fff; border: 1px solid #d6d9d2; } .value { color: #11140f; }');
  assert.equal(result.text, '.note { background: #fff8e1; } .card { background: #fff; border: 1px solid rgb(var(--eng-border)); } .value { color: #11140f; }');
});

test('a dark ink the table cannot swap keeps every fill and ink in the file', () => {
  const result = transformCss('.box { background: #fff; } .title { color: #333; } .label { color: #767b6e; }');
  assert.match(result.text, /background: #fff;/);
  assert.match(result.text, /color: #767b6e/);
  assert.equal(result.swapsFill, false);
  assert.equal(result.swapsInk, false);
});

test('inline style objects swap, including both branches of a conditional', () => {
  const source = "const tile = <div style={{ color: '#767b6e', border: `1px solid ${active ? '#16695f' : '#d6d9d2'}` }} />;";
  const { text, swaps } = transformTsx(source);
  assert.equal(text, "const tile = <div style={{ color: 'var(--fg-muted)', border: `1px solid ${active ? 'var(--c-orange)' : 'rgb(var(--eng-border))'}` }} />;");
  assert.equal(swaps, 3);
});

test('a colour outside a style, such as a chart series, stays, and holds back the inks beside it', () => {
  const source = "const series = { color: '#767b6e' }; const tile = <div style={{ color: '#11140f' }} />;";
  assert.equal(transformTsx(source).text, source);
});

test('an object typed as CSSProperties counts as a style', () => {
  const source = "const label: React.CSSProperties = { color: '#11140f' };";
  assert.equal(transformTsx(source).text, "const label: React.CSSProperties = { color: 'rgb(var(--eng-ink))' };");
});
