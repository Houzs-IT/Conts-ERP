// Every /api handler checks who is signed in (requireSession, directly or through a _lib gate such as
// linkedUnitFor). Endpoints that must answer without a session are listed below, each with its reason.
import { runCheck, runIfMain, read, stripComments } from './_lib.mjs';
import { handlerFiles, exportedHandlers, handlerReaches } from './_handlers.mjs';

const SESSION = /\brequireSession\s*\(/;

export const allow = {
  'functions/api/[[path]].ts': 'Catch-all 404 for unknown /api paths; it returns no data.',
  'functions/api/auth/login.ts': 'Signing in is how a session is made.',
  'functions/api/auth/login-2fa.ts': 'Second sign-in step; the short-lived challenge from login is the credential.',
  'functions/api/connect/verify-login.ts': 'Houzs Connect checking a Conts account, server to server; the CONNECT_LOGIN_KEY Bearer token is the credential.',
  'functions/api/auth/login-pin.ts': 'Signing in with phone number and PIN is how a field session is made.',
  'functions/api/auth/forgot-password.ts': 'Asked for by someone who cannot sign in; answers the same whether or not the email exists.',
  'functions/api/auth/reset-password.ts': 'Used from the emailed one-time link by someone who cannot sign in; the token is the credential.',
  'functions/api/auth/logout.ts': 'Only clears the cookie; works even when the session has already expired.',
  'functions/api/auth/session.ts': 'Reads and verifies the cookie itself (readSession) to answer "who am I", including 401 when signed out.',
  'functions/api/auth/view-as.ts': 'Staging account switcher: verifies the signed-in and original sessions itself with readSession.',
  'functions/api/settings/public.ts': 'The sign-in page shows the support phone before anyone is signed in; it returns that one value only.',
  'functions/api/integrations/channex-webhook.ts': 'Called by Channex, not a person; authenticated by the shared webhook secret instead of a cookie.',
  'functions/api/integrations/hostplatform-webhook.ts': 'Called by HostPlatform, not a person; authenticated by the shared webhook secret header instead of a cookie.',
  'functions/api/public/meetings/[[path]].ts': 'A guest booking a meeting room through a link someone sent them; the link code (or the private booking token) is the only credential, and the IT Hub shows a guest only when rooms are taken, never what or by whom.',
  'functions/api/system/health/hub-report.ts': 'Called by the cron worker, not a person; authenticated by Conts\'s IT Hub key (compared in constant time) instead of a cookie.',
  'functions/api/mcp/index.ts': 'The AI Connector (MCP), called by Claude or ChatGPT with no cookie; the connector token is the credential (resolveAccessToken: live, not revoked, the person active and allowed), and every read runs as that person through the session middleware.',
  'functions/api/mcp/export.ts': 'A PDF the AI Connector made (get_pdf), opened from the AI app chat with no cookie; the link is the credential: an HMAC over the file key and a 15-minute expiry, signed only after the own read of the document by the person succeeded, and it serves only files under mcp-exports/.',
  'functions/api/mcp/proactive/tick.ts': 'Called by the cron worker every 15 minutes, not a person; authenticated by the IT Hub key of Conts (compared in constant time) instead of a cookie. Each brief and alert is then read AS its person on a short-lived connector token of their own.',
  'functions/api/mcp/proactive/unsubscribe.ts': 'The unsubscribe link in a morning brief / alert email, opened from a mail client with no cookie; the 32-character random token in the link is the credential, and it can only turn the emails of that one person off (GET only shows the button).',
  'functions/api/mcp/oauth/register.ts': 'OAuth client registration for the AI Connector, called by the AI app before anyone signs in; registering grants nothing.',
  'functions/api/mcp/oauth/authorize.ts': 'OAuth authorize step for the AI Connector: checks the AI app and sends the browser to /ai-connect, where the person signs in and presses Allow (api/ai-connector/consent, signed in).',
  'functions/api/mcp/oauth/token.ts': 'OAuth token step for the AI Connector, called by the AI app; the one-time code with its PKCE verifier, or a refresh token, is the credential, and the person must still be active and allowed.',
};

export const def = {
  name: 'require-session',
  rule: 'every functions/api handler calls requireSession first, or is allow-listed with a reason',
  files: () => handlerFiles(),
  allow,
  scan(text, rel) {
    const code = stripComments(text);
    if (exportedHandlers(code).length === 0) return [];
    return handlerReaches(code, rel, SESSION) ? [] : [{ line: 0, msg: 'handler never calls requireSession (directly or through a _lib gate)' }];
  },
  selfTest: {
    bad: [{ path: 'functions/api/x.ts', text: "import { json } from '../_lib/db';\nexport const onRequestGet = async () => json({ secret: 1 });\n// requireSession(\n" }],
    good: [{ path: 'functions/api/x.ts', text: "export const onRequestGet = async ({ request, env }) => {\n  const { session, response } = await requireSession(request, env);\n};\n" }],
  },
};

runIfMain(import.meta.url, def);
void read;
