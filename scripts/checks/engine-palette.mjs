// The engine's status colours come from The Conts tokens: engine/frontend/conts/palette.mjs swaps Houzs's values when the
// engine is built. Two files hold those hex values, so this keeps them equal: change a status colour in tokens.json and
// this fails until the engine's table follows, so "success" and "critical" cannot drift apart between the two builds.
import { runCheck, runIfMain, read } from './_lib.mjs';

const hex = (v) => v.replace('#', '').toLowerCase();
const wanted = () => {
  const { success, warning, critical } = JSON.parse(read('tokens.json')).semantic;
  return [
    ['2f8a5b', hex(success.fg), 'success text'], ['e2f0e9', hex(success.bg), 'success tint'],
    ['b23a3a', hex(critical.fg), 'critical text'], ['f8eaea', hex(critical.bg), 'critical tint'],
    ['6e4d12', hex(warning.fg), 'warning text'], ['f6efd9', hex(warning.bg), 'warning tint'],
  ];
};

export const def = {
  name: 'engine-palette',
  rule: 'the engine status colours in palette.mjs equal the tokens',
  files: () => ['engine/frontend/conts/palette.mjs'],
  scan(text) {
    return wanted().filter(([from, to]) => !new RegExp(`'${from}':\\s*'${to}'`).test(text))
      .map(([from, to, name]) => ({ line: 0, msg: `${name}: palette.mjs must map ${from} to ${to}, the value in tokens.json` }));
  },
  selfTest: {
    bad: [{ path: 'engine/frontend/conts/palette.mjs', text: "'2f8a5b': '000000'," }],
    good: [{ path: 'engine/frontend/conts/palette.mjs', text: wanted().map(([f, t]) => `'${f}': '${t}',`).join('\n') }],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
