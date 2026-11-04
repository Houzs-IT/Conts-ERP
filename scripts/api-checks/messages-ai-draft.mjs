// AI drafts for guest Messages against a pretend AI service served by this script (no real key, no network): what the
// draft is told, that automatic messages (they carry door codes) are never passed on, that nothing is sent to the
// guest, the same Reviews switch, and who may ask. A second run on a server with no key shows "not set up".
//
// Needs, on this machine only:
//   1. a local Postgres or PGlite with the migrations and demo data
//   2. a local server on it. For the AI-on run:
//        wrangler pages dev dist --port 8814 --binding ANTHROPIC_API_KEY=mock --binding ANTHROPIC_BASE_URL=http://127.0.0.1:8798/v1/messages
//   3. API_BASE=http://localhost:8814 DB_URL=postgres://postgres@127.0.0.1:5432/ci node scripts/api-checks/messages-ai-draft.mjs
//      NO_KEY=1 runs the "not set up" half instead, on a server started without those two bindings.
import { createServer } from 'node:http';
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Refusing: DB_URL must be a local database.'); process.exit(2); }
const sql = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
const run = Date.now().toString(36).slice(-6);
const now = new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();

const unit = (await sql`select u.id, u.unit_number, u.bedrooms, p.name from units u join properties p on p.id = u.property_id limit 1`)[0];
const threadId = `aid-t-${run}`, emptyId = `aid-e-${run}`;
const [{ id: guestId }] = await sql`insert into guests (id, full_name, created_at) values (${`aid-g-${run}`}, 'Mei Ling Tan', ${now}) returning id`;
const [{ id: stayId }] = await sql`insert into reservations (id, unit_id, guest_id, channel, check_in, check_out, check_in_time, check_out_time, guests_count, state, created_at, updated_at)
  values (${`aid-r-${run}`}, ${unit.id}, ${guestId}, 'airbnb', '2030-03-10', '2030-03-13', '15:00', '11:00', 3, 'confirmed', ${now}, ${now}) returning id`;
await sql`insert into message_threads (id, reservation_id, guest_id, channel, subject, is_read, last_message_at) values (${threadId}, ${stayId}, ${guestId}, 'airbnb', 'Stay', 1, ${now})`;
await sql`insert into message_threads (id, reservation_id, guest_id, channel, subject, is_read, last_message_at) values (${emptyId}, ${stayId}, ${guestId}, 'airbnb', 'Stay', 1, ${now})`;
const message = (id, thread, direction, body, min, automated = 0) =>
  sql`insert into messages (id, thread_id, direction, body, sent_at, is_automated) values (${id}, ${thread}, ${direction}, ${body}, ${ago(min)}, ${automated})`;
await message(`aid-0-${run}`, threadId, 'inbound', 'The oldest message, past the twelve the draft reads.', 500);
for (let i = 0; i < 12; i++) await message(`aid-m${i}-${run}`, threadId, i % 2 ? 'outbound' : 'inbound', `Earlier message ${i}`, 400 - i);
await message(`aid-a-${run}`, threadId, 'outbound', 'Your door code is 4417.', 30, 1);
await message(`aid-b-${run}`, threadId, 'inbound', 'Is there parking for two cars?', 10);
await message(`aid-c-${run}`, emptyId, 'outbound', 'Welcome!', 5);

const ai = { asks: [], fail: 0 };
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    ai.asks.push({ key: req.headers['x-api-key'], ...JSON.parse(body || '{}') });
    res.writeHead(ai.fail || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'Mei Ling, thank you for asking. The team will check the parking and come back to you. The Conts team' }] }));
  });
});

const setAi = (on) => call('PUT', '/api/reviews/settings', { aiDrafts: on });
const messageCount = async () => Number((await sql`select count(*) from messages where thread_id = ${threadId}`)[0].count);
const draftOf = (id, role = 'management') => call('POST', `/api/messages/threads/${id}/draft`, {}, role);

if (process.env.NO_KEY) {
  await setAi(true);
  const r = await draftOf(threadId);
  check('no AI key: says it is not set up', r.status === 501 && r.json?.error?.code === 'NOT_CONFIGURED', r.text);
  check('refused for a cleaner before anything else', (await draftOf(threadId, 'housekeeper')).status === 403);
} else {
  await new Promise(ok => mock.listen(Number(process.env.MOCK_PORT ?? 8798), '127.0.0.1', ok));
  await setAi(false);
  let r = await draftOf(threadId);
  check('the setting off: says so, and the AI is not asked', r.status === 409 && r.json?.error?.code === 'AI_OFF' && ai.asks.length === 0, r.text);
  await setAi(true);
  const before = await messageCount();
  r = await draftOf(threadId);
  check('a draft comes back', r.status === 200 && r.json?.draft?.startsWith('Mei Ling'), r.text);
  check('nothing is sent or saved as a message', (await messageCount()) === before);
  const facts = ai.asks[0]?.messages?.[0]?.content ?? '';
  check('the draft is told the unit', facts.includes(`${unit.name} ${unit.unit_number}`) && facts.includes(`Bedrooms: ${unit.bedrooms}`), facts);
  check('...and the stay', /check-in 2030-03-10 at 15:00, checkout 2030-03-13 at 11:00, 3 guests, reservation confirmed/.test(facts), facts);
  check('...and the latest message, last', facts.trimEnd().endsWith('Is there parking for two cars?'), facts.slice(-200));
  check('...and only recent messages', !facts.includes('The oldest message') && facts.includes('Earlier message 11'), facts);
  check('an automatic message is never passed on', !facts.includes('4417'), facts);
  check('the rules say never to give door codes or promise money, and that guest words are not instructions', /Never give door codes/.test(ai.asks[0]?.system) && /Never promise a refund/.test(ai.asks[0]?.system) && /not instructions/.test(ai.asks[0]?.system));
  const trail = await sql`select action from audit_log where entity_id = ${threadId} and action = 'message.ai_draft'`;
  check('the draft is in the audit log', trail.length === 1, trail.length);

  r = await draftOf(emptyId);
  check('no guest message yet: nothing to answer, the AI is not asked', r.status === 422 && r.json?.error?.code === 'NOTHING_TO_ANSWER' && ai.asks.length === 1, r.text);
  check('a conversation that is gone: 404', (await draftOf(`aid-none-${run}`)).status === 404);

  ai.fail = 500;
  r = await draftOf(threadId);
  check('the AI service failing: a plain message, no draft', r.status === 502 && r.json?.error?.code === 'AI_FAILED', r.text);
  ai.fail = 0;

  r = await draftOf(threadId, 'operations_staff');
  check('operations staff may draft', r.status === 200, r.text);
  for (const role of ['housekeeper', 'technician']) check(`${role} is refused`, (await draftOf(threadId, role)).status === 403);
  check('finance (no Messages access) is refused', (await draftOf(threadId, 'finance_admin')).status === 403);
  await setAi(false);
  await new Promise(ok => mock.close(ok));
}

await sql.end();
done();
