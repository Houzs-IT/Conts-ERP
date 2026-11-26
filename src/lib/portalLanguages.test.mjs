// node --test src/lib/portalLanguages.test.mjs. The languages a worker can pick on the portal's Me screen (src/lib/portalI18n.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { OFFERED_PORTAL_LANGS, LANG_LABEL } = await import('./portalI18n.ts');

test('Me offers English, Bahasa Melayu, Chinese and Burmese', () => {
  assert.deepEqual([...OFFERED_PORTAL_LANGS], ['en', 'ms', 'zh', 'my']);
});

test('Chinese is named in its own script', () => {
  assert.equal(LANG_LABEL.zh, '中文');
});

test('every language words the reno review status and the reno hand-in note', async () => {
  const { STRINGS } = await import('./portalI18n.ts');
  for (const lang of OFFERED_PORTAL_LANGS) {
    const text = STRINGS[lang];
    assert.ok(text.receipts.status.RENO_REVIEW, `${lang} status`);
    assert.ok(text.claimPay.renoSent, `${lang} renoSent`);
    assert.ok(text.receipts.requestStatus.RENO_REVIEW, `${lang} request status`);
  }
});
