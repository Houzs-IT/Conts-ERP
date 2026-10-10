// Every /api handler checks who is signed in (requireSession, directly or through a _lib gate such as
// linkedUnitFor). Endpoints that must answer without a session are listed below, each with its reason.
import { runCheck, runIfMain, read, stripComments } from './_lib.mjs';
import { handlerFiles, exportedHandlers, handlerReaches } from './_handlers.mjs';

const SESSION = /\brequireSession\s*\(/;

export const allow = {
  'functions/api/[[path]].ts': 'Catch-all 404 for unknown /api paths; it returns no data.',
  'functions/api/auth/login.ts': 'Signing in is how a session is made.',
  'functions/api/auth/forgot-password.ts': 'Asked for by someone who cannot sign in; answers the same whether or not the email exists.',
  'functions/api/auth/reset-password.ts': 'Used from the emailed one-time link by someone who cannot sign in; the token is the credential.',
  'functions/api/auth/logout.ts': 'Only clears the cookie; works even when the session has already expired.',
  'functions/api/auth/session.ts': 'Reads and verifies the cookie itself (readSession) to answer "who am I", including 401 when signed out.',
  'functions/api/auth/view-as.ts': 'Staging account switcher: verifies the signed-in and original sessions itself with readSession.',
  'functions/api/integrations/channex-webhook.ts': 'Called by Channex, not a person; authenticated by the shared webhook secret instead of a cookie.',
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
