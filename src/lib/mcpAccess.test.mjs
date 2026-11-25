// node --test src/lib/mcpAccess.test.mjs. The AI Connector's pure rules: which paths it may read, credential fields
// stripped from replies, PKCE, the redirect URI rule, the in-process secret, and Pages-style route matching
// (functions/_lib/mcpAccess.ts, mcpInner.ts, mcpRoutes.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The functions code imports its siblings without an extension (the bundler adds it); let Node try `.ts`.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { classifyPath, redactSecrets, pkceS256, validRedirectUri, readablePaths, moduleCatalog, leakCheckPaths, analyseBody, appLabel } = await import('../../functions/_lib/mcpAccess.ts');
const { isMcpInner, mcpInnerSecret } = await import('../../functions/_lib/mcpInner.ts');
const { matchRoute } = await import('../../functions/_lib/mcpRoutes.ts');

test('PKCE S256 matches the RFC 7636 appendix B vector', async () => {
  assert.equal(await pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('paths: ordinary reads pass, normalised', () => {
  assert.deepEqual(classifyPath('/api/reservations'), { ok: true, path: '/api/reservations' });
  assert.deepEqual(classifyPath('/api/units/detail/?x=1'), { ok: true, path: '/api/units/detail' });
  assert.equal(classifyPath('/api/owners/abc/statements').ok, true);
});

test('paths: sign-in, security, credentials, webhooks, public pages and the connector are never read', () => {
  for (const p of ['/api/auth/session', '/api/auth', '/api/account', '/api/account/2fa', '/api/access-credentials', '/api/access-credentials/1',
    '/api/connect/verify-login', '/api/public/meetings/x', '/api/mcp', '/api/mcp/oauth/token', '/api/ai-connector/admin/overview', '/api/demo',
    '/api/integrations/channex-webhook', '/api/integrations/channex-webhook-setup', '/api/import/hostplatform', '/api/system/health/hub-report',
    '/api/supply-chain/engine-session', '/api/owners/1/reveal', '/api/owners/1/accounts/2/reveal', '/API/AUTH/session']) {
    assert.equal(classifyPath(p).ok, false, p);
  }
  // Prefix match is by whole segment: /api/authority would not be /api/auth.
  assert.equal(classifyPath('/api/authors').ok, true);
});

test('paths: traversal, encoding tricks and non-API paths are refused', () => {
  for (const p of ['/api/../auth/session', '/api//units', '/api/%2e%2e/auth', '/api/units%2fx', '/api\\units', 'api/units', '/units', '', `/api/${'x'.repeat(300)}`]) {
    assert.equal(classifyPath(p).ok, false, p);
  }
});

test('secrets: credential-shaped keys are removed at any depth, the rest kept', () => {
  const { value, removed } = redactSecrets({
    id: 1, password_hash: 'x', nested: [{ apiKey: 'k', name: 'A', totpSecret: 's', sub: { webhookSecret: 'w', accessToken: 't', amountSen: 5 } }],
    pin_hash: 'p', backupCodes: ['1'], refresh_token: 'r', ok: true,
  });
  assert.deepEqual(value, { id: 1, nested: [{ name: 'A', sub: { amountSen: 5 } }], ok: true });
  assert.deepEqual([...removed].sort(), ['accessToken', 'apiKey', 'backupCodes', 'password_hash', 'pin_hash', 'refresh_token', 'totpSecret', 'webhookSecret'].sort());
  assert.deepEqual(redactSecrets([1, 'a', null]).value, [1, 'a', null]);
});

test('redirect URIs: https anywhere, http only on loopback, no fragments', () => {
  assert.equal(validRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(validRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'), true);
  assert.equal(validRedirectUri('http://localhost:6274/oauth/callback'), true);
  assert.equal(validRedirectUri('http://127.0.0.1/cb'), true);
  assert.equal(validRedirectUri('http://[::1]:3000/cb'), true);
  assert.equal(validRedirectUri('http://evil.example/cb'), false);
  assert.equal(validRedirectUri('https://claude.ai/cb#frag'), false);
  assert.equal(validRedirectUri('javascript:alert(1)'), false);
  assert.equal(validRedirectUri('not a url'), false);
});

test('inner secret: only this isolate\'s own value matches', () => {
  assert.equal(isMcpInner(null), false);
  assert.equal(isMcpInner(''), false);
  const s = mcpInnerSecret();
  assert.equal(s.length, 48);
  assert.equal(mcpInnerSecret(), s, 'stable within the isolate');
  assert.equal(isMcpInner(s), true);
  assert.equal(isMcpInner(s.slice(0, -1) + (s.endsWith('0') ? '1' : '0')), false);
  assert.equal(isMcpInner(s + '0'), false);
  assert.equal(isMcpInner('x'.repeat(48)), false);
});

const h = () => new Response('');
const ROUTES = [
  { path: '/api/units/:id/channels', method: 'GET', handler: h },
  { path: '/api/units/detail', method: 'GET', handler: h },
  { path: '/api/units/:id', method: 'GET', handler: h },
  { path: '/api/claims/:path*', method: '', handler: h },
  { path: '/api/units', method: 'GET', handler: h },
  { path: '/api/:path*', method: '', handler: h },
];

test('routes: matched like Pages, static before :param, the catch-all last', () => {
  assert.equal(matchRoute(ROUTES, '/api/units/detail').route.path, '/api/units/detail');
  const one = matchRoute(ROUTES, '/api/units/u-1');
  assert.equal(one.route.path, '/api/units/:id');
  assert.deepEqual(one.params, { id: 'u-1' });
  assert.deepEqual(matchRoute(ROUTES, '/api/units/u-1/channels').params, { id: 'u-1' });
  assert.equal(matchRoute(ROUTES, '/api/units/').route.path, '/api/units');
  assert.deepEqual(matchRoute(ROUTES, '/api/claims/requests/7').params, { path: ['requests', '7'] });
  assert.deepEqual(matchRoute(ROUTES, '/api/claims').params, {});
  assert.equal(matchRoute(ROUTES, '/api/nothing/here').route.path, '/api/:path*');
  assert.equal(matchRoute(ROUTES.slice(0, 5), '/api/nothing'), null);
});

test('modules and leak-check paths come from the readable GET routes', () => {
  const routes = [
    { method: 'GET', path: '/api/units' }, { method: 'GET', path: '/api/units/:id' }, { method: '', path: '/api/claims/:path*' },
    { method: 'GET', path: '/api/auth/session' }, { method: 'GET', path: '/api/owners/:id/reveal' }, { method: 'GET', path: '/api/reservations' },
  ];
  assert.deepEqual(readablePaths(routes, null), ['/api/reservations', '/api/units', '/api/units/:id']);
  assert.deepEqual(readablePaths(routes, '/api/units'), ['/api/units', '/api/units/:id']);
  assert.deepEqual(moduleCatalog(routes), [{ prefix: '/api/reservations', endpoints: 1 }, { prefix: '/api/units', endpoints: 2 }]);
  assert.deepEqual(leakCheckPaths(routes), ['/api/reservations', '/api/units']);
});

test('leak check reports field names, never values, and refusals as refused', () => {
  const r = analyseBody('/api/employees', 200, false, { data: [{ name: 'A', salarySen: 100, icNo: 'x', bankAccountRef: 'y', apiToken: 'z' }] }, ['apiToken']);
  assert.equal(r.outcome, 'opened');
  assert.deepEqual(r.sensitive, ['bankAccountRef', 'icNo', 'salarySen']);
  assert.deepEqual(r.hidden, ['apiToken']);
  assert.equal(JSON.stringify(r).includes('100'), false);
  assert.equal(analyseBody('/api/x', 403, true, null, []).outcome, 'refused');
  assert.equal(analyseBody('/api/x', 422, true, null, []).outcome, 'error');
});

test('app labels', () => {
  assert.equal(appLabel('Claude'), 'Claude');
  assert.equal(appLabel('ChatGPT connector'), 'ChatGPT');
  assert.equal(appLabel(''), 'AI app');
  assert.equal(appLabel('Cursor'), 'Cursor');
});
