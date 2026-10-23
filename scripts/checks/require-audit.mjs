// Every handler that changes data writes an audit_log row (audit(), or a _lib function that does).
// A handler that only reads, or whose write is not a business change, is listed below with its reason.
import { runCheck, runIfMain, stripComments } from './_lib.mjs';
import { handlerFiles, exportedHandlers, handlerReaches, MUTATING } from './_handlers.mjs';

const AUDIT = /\baudit\w*\s*\(|INSERT\s+INTO\s+audit_log/i;

export const allow = {
  'functions/api/[[path]].ts': 'Catch-all 404; changes nothing.',
  'functions/api/auth/logout.ts': 'Only clears the browser cookie; no stored record changes.',
  'functions/api/auth/login.ts': 'Sign-in attempts are counted on the user row for lock-out, not business changes.',
  'functions/api/auth/login-2fa.ts': 'Sign-in attempts are written to the login log (logLogin), not business records.',
  'functions/api/auth/login-pin.ts': 'Phone and PIN sign-in: attempts are counted on the user row and written to the login log, as for login.ts.',
  'functions/api/auth/forgot-password.ts': 'Sends a reset email; no record the business reads changes.',
  'functions/api/messages/threads/[id].ts': 'Only flips a conversation\'s read / unread flag for the inbox view.',
  'functions/api/notifications/index.ts': 'Only marks bell notifications as seen.',
  'functions/api/rate-cards/compute.ts': 'POST carries the inputs of a price calculation; nothing is stored.',
  'functions/api/supply-chain/engine-session.ts': 'Issues a sign-in for the supply chain engine, like login; nothing in Conts changes.',
  'functions/api/units/[id]/channels/airbnb-link.ts': 'Asks Channex for an Airbnb sign-in link; the connection is stored and audited when Airbnb sends the person back.',
  'functions/api/units/[id]/channels/lookup.ts': 'Read-only check of a Hotel ID with Channex, sent as POST; nothing is stored.',
  'functions/api/properties/[id]/channels/lookup.ts': 'Read-only check of a Hotel ID with Channex for a building, sent as POST; nothing is stored.',
  'functions/api/system/health/hub-report.ts': 'Reads the live health and sends it to the IT Hub, every 5 minutes; nothing in Conts is stored or changed.',
};

export const def = {
  name: 'require-audit',
  rule: 'every POST / PUT / PATCH / DELETE handler records an audit_log row, or is allow-listed with a reason',
  files: () => handlerFiles(),
  allow,
  scan(text, rel) {
    const code = stripComments(text);
    const names = exportedHandlers(code);
    const mutates = names.some(n => MUTATING.has(n))
      || (names.includes('onRequest') && /method\s*[!=]==?\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(code));
    if (!mutates) return [];
    return handlerReaches(code, rel, AUDIT) ? [] : [{ line: 0, msg: 'changes data but never calls audit() (directly or through a _lib function)' }];
  },
  selfTest: {
    bad: [{ path: 'functions/api/x.ts', text: "export const onRequestPost = async ({ env }) => { await run(env, 'DELETE FROM units'); };\n// audit(\n" }],
    good: [
      { path: 'functions/api/x.ts', text: "export const onRequestPost = async ({ env }) => { await run(env, 'x'); await audit(env, {}); };\n" },
      { path: 'functions/api/y.ts', text: "export const onRequestGet = async () => json({});\n" },
    ],
  },
};

runIfMain(import.meta.url, def);
void runCheck;
