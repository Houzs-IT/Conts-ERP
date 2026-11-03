// Messages and Reviews against a pretend Channex served by this script (no real Channex, no network): paging through
// threads and reviews, the call budget and its catch-up, a review the guest edited and a reply written on the site,
// the "Messages & Reviews app not installed" answer (403), a new message making a conversation unread, an inquiry
// before booking, replies that fail and are retried, saved replies, and the Reviews views.
//
// Needs, on this machine only:
//   1. node scripts/dev-pglite.mjs (PORT=55451) or any local Postgres with the migrations and demo data
//   2. a local server on it with the pretend Channex, e.g.
//        npx wrangler pages dev dist --port 8812 --binding CHANNEX_API_KEY=mock --binding CHANNEX_BASE_URL=http://127.0.0.1:8799
//   3. API_BASE=http://localhost:8812 DB_URL=postgres://pos_app:local@127.0.0.1:55451/postgres node scripts/api-checks/messages-reviews.mjs
// Run it on a fresh database: it adds its own unit, reservations, conversations and reviews (ids start mr-).
import { createServer } from 'node:http';
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL ?? 'postgres://pos_app:local@127.0.0.1:55451/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Refusing: DB_URL must be a local database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

/* ---------------------------------------------------------------- the pretend Channex ---------------------------- */
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8799);
const iso = (minAgo) => new Date(Date.now() - minAgo * 60e3).toISOString();
const mock = {
  forbidden: false,
  threads: [],           // { id, provider, title, booking, property, updated_at, messages: [...] }
  reviews: [],           // Channex review objects
  sendFails: 0,          // the next N message sends answer 500
  replyFails: 0,         // the next N review replies answer 500
  sent: [], replies: [], hits: [],
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    mock.hits.push(`${req.method} ${u.pathname}${u.search}`);
    const page = Number(u.searchParams.get('pagination[page]') ?? 1), limit = Number(u.searchParams.get('pagination[limit]') ?? 10);
    const slice = list => list.slice((page - 1) * limit, page * limit);
    const p = u.pathname.replace(/^\/api\/v1/, '');
    if (mock.forbidden && /^\/(message_threads|reviews)/.test(p)) return json(res, 403, { errors: { code: 'forbidden' } });
    if (p === '/message_threads' && req.method === 'GET') {
      return json(res, 200, { data: slice(mock.threads).map(t => ({ id: t.id, type: 'message_thread',
        attributes: { provider: t.provider, title: t.title, updated_at: t.updated_at, last_message_received_at: t.updated_at, inserted_at: t.updated_at },
        relationships: { ...(t.booking ? { booking: { data: { id: t.booking } } } : {}), ...(t.property ? { property: { data: { id: t.property } } } : {}) } })),
        meta: { page, limit, total: mock.threads.length } });
    }
    let m = /^\/message_threads\/([^/]+)\/messages$/.exec(p);
    if (m && req.method === 'GET') {
      const t = mock.threads.find(x => x.id === m[1]);
      return json(res, 200, { data: (t?.messages ?? []).map(x => ({ id: x.id, type: 'message', attributes: { message: x.message, sender: x.sender, inserted_at: x.at, attachments: x.attachments ?? [] } })) });
    }
    if (m && req.method === 'POST') {
      if (mock.sendFails > 0) { mock.sendFails--; return json(res, 500, { errors: { title: 'boom' } }); }
      const id = `cx-sent-${tag}-${mock.sent.length + 1}`;
      mock.sent.push({ thread: m[1], body: JSON.parse(body || '{}')?.message?.message });
      return json(res, 200, { data: { id, type: 'message' } });
    }
    if (p === '/reviews' && req.method === 'GET') return json(res, 200, { data: slice(mock.reviews), meta: { page, limit, total: mock.reviews.length } });
    m = /^\/reviews\/([^/]+)\/reply$/.exec(p);
    if (m && req.method === 'POST') {
      if (mock.replyFails > 0) { mock.replyFails--; return json(res, 500, { errors: { title: 'boom' } }); }
      mock.replies.push({ review: m[1], body: JSON.parse(body || '{}')?.reply?.reply });
      return json(res, 200, { data: { id: m[1] } });
    }
    return json(res, 200, { data: [] });
  });
});
await new Promise(r => server.listen(MOCK_PORT, '127.0.0.1', r));
const sync = async () => { const r = await call('POST', '/api/integrations/sync', {}); if (r.status !== 200) console.log('sync answered', r.status, r.text.slice(0, 200)); return r; };
const review = (id, o = {}) => ({ id, type: 'review', attributes: { ota: 'BookingCom', overall_score: 8, content: `Review ${id}`, guest_name: `Guest ${id}`, inserted_at: iso(600), received_at: iso(600), updated_at: iso(600), reply: null, scores: [], ...o.attributes }, relationships: o.relationships ?? {} });

/* ---------------------------------------------------------------- setup -------------------------------------------- */
const tag = Date.now().toString().slice(-6);
const owner = (await call('GET', '/api/owners')).json?.data?.[0]?.id;
const building = (await call('POST', '/api/properties', { name: `MR Building ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' })).json?.id;
const unitRes = await call('POST', '/api/units', { buildingId: building, ownerId: owner, unitCode: `MR-${tag}`, unitNumber: `MR-${tag}`, listingName: `MR Studio ${tag}` });
const UID = unitRes.json?.id;
check('test unit made', !!UID, unitRes.text);
await db(`UPDATE units SET channex_property_id = $1 WHERE id = $2`, `cx-prop-${tag}`, UID);
const RES = `mr-res-${tag}`;
await db(`INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, channex_booking_id, created_at, updated_at)
  VALUES ($1, $2, NULL, 'airbnb', 'HMMR', 'checked_out', to_char(current_date - 5, 'YYYY-MM-DD'), to_char(current_date - 2, 'YYYY-MM-DD'), 2, 30000, 3000, 27000, $3, now()::text, now()::text)`, RES, UID, `cx-book-${tag}`);

/* 1. Paging and the call budget: 102 conversations need more than one pull; every one arrives in the end. */
for (let i = 0; i < 102; i++) {
  mock.threads.push({ id: `cx-t-${tag}-${i}`, provider: 'AirBNB', title: `Paged ${tag} guest ${i}`, property: null, booking: null, updated_at: iso(1000 + i),
    messages: [{ id: `cx-m-${tag}-${i}`, message: `Hello ${tag} ${i}`, sender: 'guest', at: iso(1000 + i) }] });
}
let pulls = 0, have = 0;
for (; pulls < 12; pulls++) {
  await sync();
  have = Number((await db(`SELECT count(*)::int AS n FROM message_threads WHERE channex_thread_id LIKE $1`, `cx-t-${tag}-%`))[0].n);
  if (have === 102) break;
}
check('all 102 conversations arrived', have === 102, `${have} after ${pulls + 1} pulls`);
check('more than one pull was needed (20 outside calls each)', pulls >= 1, `pulls ${pulls + 1}`);
check('page 2 of the conversation list was read', mock.hits.some(h => h.includes('/message_threads?pagination[page]=2')));
const msgs = Number((await db(`SELECT count(*)::int AS n FROM messages WHERE channex_message_id LIKE $1`, `cx-m-${tag}-%`))[0].n);
check('each conversation has its message, none twice', msgs === 102, String(msgs));
mock.hits = [];
await sync();
check('a pull with nothing new reads one page of conversations and asks for no messages',
  mock.hits.filter(h => h.startsWith('GET /api/v1/message_threads?')).length === 1 && !mock.hits.some(h => /\/messages/.test(h)), mock.hits.join(' | '));

/* 2. The Messages list pages through every conversation with no duplicates. */
const seen = new Set(); let cursor = null, pages = 0;
do {
  const r = await call('GET', `/api/messages/threads?q=${encodeURIComponent(`Paged ${tag} guest`)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  for (const t of r.json?.threads ?? []) seen.add(t.id);
  cursor = r.json?.nextCursor ?? null; pages++;
} while (cursor && pages < 10);
check('Messages pages 40 at a time through all 102, no duplicates', seen.size === 102 && pages === 3, `${seen.size} in ${pages} pages`);
const s1 = await call('GET', `/api/messages/threads?q=${encodeURIComponent(`Hello ${tag} 7`)}`);
check('search finds words inside a message', s1.json?.threads?.some(t => t.guestName === `Paged ${tag} guest 7`), JSON.stringify(s1.json?.threads?.map(t => t.guestName)));

/* 3. Unread: a new conversation from a guest is unread; a read one with a new guest message turns unread. */
const NEW = `cx-new-${tag}`;
mock.threads.unshift({ id: NEW, provider: 'BookingCom', title: 'Brand new guest', booking: `cx-book-${tag}`, property: null, updated_at: iso(1),
  messages: [{ id: `cx-mn-${tag}`, message: 'Is parking free?', sender: 'guest', at: iso(1) }] });
await sync();
const fresh = await db(`SELECT id, is_read, reservation_id FROM message_threads WHERE channex_thread_id = $1`, NEW);
check('a brand-new conversation from a guest is unread', fresh[0]?.is_read === 0, JSON.stringify(fresh));
check('it is linked to its reservation', fresh[0]?.reservation_id === RES, JSON.stringify(fresh));
await call('PATCH', `/api/messages/threads/${fresh[0].id}`, { isRead: true });
// The guest's next message carries an older time than the conversation's last one (clocks differ): still unread.
await db(`UPDATE message_threads SET last_message_at = $1 WHERE id = $2`, iso(-60), fresh[0].id);
mock.threads[0].messages.push({ id: `cx-mn2-${tag}`, message: 'Hello again', sender: 'guest', at: iso(0.5) });
mock.threads[0].updated_at = iso(0.5);
await sync();
check('a new guest message makes it unread again, whatever its time', (await db(`SELECT is_read FROM message_threads WHERE id = $1`, fresh[0].id))[0]?.is_read === 0);
// A message staff sent from the Airbnb app does not make it unread.
await call('PATCH', `/api/messages/threads/${fresh[0].id}`, { isRead: true });
mock.threads[0].messages.push({ id: `cx-mn3-${tag}`, message: 'Yes, free parking.', sender: 'property', at: iso(0.2) });
mock.threads[0].updated_at = iso(0.2);
await sync();
check('a reply from the host side keeps it read', (await db(`SELECT is_read FROM message_threads WHERE id = $1`, fresh[0].id))[0]?.is_read === 1);

/* 4. An inquiry before booking: kept, tied to the unit by its listing, shown and repliable; attachments kept. */
const INQ = `cx-inq-${tag}`;
mock.threads.unshift({ id: INQ, provider: 'AirBNB', title: `Inquiry guest ${tag}`, booking: null, property: `cx-prop-${tag}`, updated_at: iso(0.1),
  messages: [{ id: `cx-mi-${tag}`, message: 'Free 20-24 Dec?', sender: 'guest', at: iso(0.1), attachments: ['https://example.com/files/plan.pdf', 'javascript:alert(1)'] }] });
await sync();
const inq = (await call('GET', `/api/messages/threads?kind=inquiry&unitId=${UID}`)).json?.threads?.find(t => t.guestName === `Inquiry guest ${tag}`);
check('the inquiry is listed under Inquiries, with its unit', inq?.inquiry === true && inq?.unitId === UID && inq?.reservationId === null, JSON.stringify(inq));
const inqDetail = await call('GET', `/api/messages/threads/${inq?.id}`);
check('its file is shown; a non-web link is dropped', inqDetail.json?.messages?.[0]?.attachments?.length === 1 && inqDetail.json.messages[0].attachments[0].name === 'plan.pdf', JSON.stringify(inqDetail.json?.messages?.[0]));
let r = await call('POST', '/api/messages', { threadId: inq?.id, body: 'Yes, those dates are free.' });
check('a reply to the inquiry reaches Airbnb', r.status === 201 && r.json?.delivery === 'sent' && mock.sent.at(-1)?.thread === INQ, r.text);

/* 5. A reply that fails is marked not delivered and can be sent again. */
mock.sendFails = 1;
r = await call('POST', '/api/messages', { threadId: inq?.id, body: 'Check-in is from 15:00.' });
check('a refused reply is saved and marked failed', r.status === 201 && r.json?.delivery === 'failed' && /refused|status 500/.test(r.json?.reason ?? ''), r.text);
const failedId = r.json?.id;
let d = await call('GET', `/api/messages/threads/${inq?.id}`);
check('after a reload it still says not delivered, with the reason', d.json?.messages?.find(m => m.id === failedId)?.delivery === 'failed', JSON.stringify(d.json?.messages?.at(-1)));
r = await call('POST', `/api/messages/${failedId}/retry`, {});
check('Retry sends it', r.status === 200 && r.json?.delivery === 'sent', r.text);
r = await call('POST', `/api/messages/${failedId}/retry`, {});
check('a delivered reply cannot be sent twice', r.status === 409, r.text);
r = await call('POST', `/api/messages/${failedId}/retry`, {}, 'finance_admin');
check('someone without Messages cannot retry', r.status === 403, r.text);
await sync();
check('the sent replies are not pulled back in as copies', Number((await db(`SELECT count(*)::int AS n FROM messages WHERE thread_id = $1`, inq?.id))[0].n) === 3);

/* 6. Reviews: paging, no booking matched, an edit and a reply written on the site, and the 403. */
for (let i = 0; i < 103; i++) mock.reviews.push(review(`cx-r-${tag}-${i}`));
mock.reviews.push(review(`cx-rb-${tag}`, { attributes: { ota: 'AirBNB', overall_score: 4, content: 'Noisy', guest_name: 'Booked guest' }, relationships: { booking: { data: { id: `cx-book-${tag}` } } } }));
mock.reviews.push(review(`cx-rp-${tag}`, { attributes: { ota: 'BookingCom', overall_score: 9, guest_name: `Listing guest ${tag}`, scores: [{ category: 'clean', score: 9 }, { category: 'value_for_money', score: 7 }] }, relationships: { property: { data: { id: `cx-prop-${tag}` } } } }));
await sync();
const rv = Number((await db(`SELECT count(*)::int AS n FROM reviews WHERE channex_review_id LIKE $1`, `cx-r%-${tag}%`))[0].n);
check('105 reviews over two pages all arrive', rv === 105, String(rv));
const booked = (await db(`SELECT id, reservation_id, unit_id, rating FROM reviews WHERE channex_review_id = $1`, `cx-rb-${tag}`))[0];
check('a review is linked to its reservation and unit', booked?.reservation_id === RES && booked?.unit_id === UID && Number(booked?.rating) === 2, JSON.stringify(booked));
const byListing = await call('GET', `/api/reviews?unitId=${UID}&q=${encodeURIComponent(`Listing guest ${tag}`)}`);
const lr = byListing.json?.data?.[0];
check('a review with no reservation is kept, tied to the unit by its listing', lr && lr.reservationId === null && lr.unitId === UID, JSON.stringify(lr));
check('Booking.com category scores come through (under our names: value for money is Value)', lr?.scores?.length === 2 && lr.scores[1].category === 'Value', JSON.stringify(lr?.scores));
const unmatched = await call('GET', `/api/reviews?matched=no&q=${encodeURIComponent(`Guest cx-r-${tag}-5`)}`);
check('reviews with no unit at all are kept too', unmatched.json?.data?.some(x => x.unitId === null), JSON.stringify(unmatched.json?.data?.[0]));

const rb = mock.reviews.find(x => x.id === `cx-rb-${tag}`);
rb.attributes = { ...rb.attributes, overall_score: 6, content: 'Noisy, but the host fixed it', reply: 'Sorry, fixed now.', updated_at: iso(0) };
await sync();
const edited = (await db(`SELECT rating, comment, channel_reply, reply FROM reviews WHERE channex_review_id = $1`, `cx-rb-${tag}`))[0];
check('the guest edit is pulled in', Number(edited?.rating) === 3 && edited?.comment === 'Noisy, but the host fixed it', JSON.stringify(edited));
check('a reply written on the site is stored and counts as replied', edited?.channel_reply === 'Sorry, fixed now.' && edited?.reply === 'Sorry, fixed now.', JSON.stringify(edited));

/* 7. A review reply that does not reach the channel says so, and Retry posts it. */
const rp = (await db(`SELECT id FROM reviews WHERE channex_review_id = $1`, `cx-rp-${tag}`))[0];
mock.replyFails = 1;
r = await call('POST', `/api/reviews/${rp.id}/reply`, { body: 'Thank you!' });
check('a failed post is saved here and reported', r.status === 200 && r.json?.post?.state === 'failed', r.text);
let card = (await call('GET', `/api/reviews?q=${encodeURIComponent(`Listing guest ${tag}`)}`)).json?.data?.[0];
check('the card says it was not posted, after a reload', card?.replyPost?.state === 'failed' && card?.reply === 'Thank you!', JSON.stringify(card));
check('Saved, not posted filter finds it', (await call('GET', '/api/reviews?reply=not_posted')).json?.data?.some(x => x.id === rp.id));
r = await call('POST', `/api/reviews/${rp.id}/reply`, { body: 'Thank you!' });
card = (await call('GET', `/api/reviews?q=${encodeURIComponent(`Listing guest ${tag}`)}`)).json?.data?.[0];
check('Retry posts it', r.json?.post?.state === 'sent' && card?.replyPost?.state === 'sent' && mock.replies.at(-1)?.body === 'Thank you!', r.text);

/* 8. 403: the Messages & Reviews app is not installed. The pull still answers, and nothing is lost or written. */
mock.forbidden = true;
const before = Number((await db(`SELECT count(*)::int AS n FROM reviews`))[0].n);
r = await sync();
check('a 403 from Channex does not fail the Sync button', r.status === 200 && r.json?.messages === 0 && r.json?.reviews === 0, r.text);
check('nothing is removed', Number((await db(`SELECT count(*)::int AS n FROM reviews`))[0].n) === before);
const noisy = Number((await db(`SELECT count(*)::int AS n FROM audit_log WHERE action IN ('channex.message_sync_failed','channex.review_sync_failed') AND occurred_at > $1`, iso(1)))[0].n);
check('and the audit trail is not filled with failures', noisy === 0, String(noisy));
mock.forbidden = false;

/* 9. Saved replies. */
r = await call('POST', '/api/messages/saved-replies', { title: '', body: '' });
check('a saved reply needs a name and text', r.status === 422 && r.json?.error?.fields?.title && r.json?.error?.fields?.body, r.text);
r = await call('POST', '/api/messages/saved-replies', { title: `Wifi ${tag}`, body: 'The wifi password is on the fridge.' });
const sid = r.json?.id;
check('saved reply added', r.status === 201 && !!sid, r.text);
r = await call('PATCH', `/api/messages/saved-replies/${sid}`, { title: `Wifi ${tag}`, body: 'The wifi password is on the router.' });
check('saved reply changed', r.status === 200 && r.json?.body.includes('router'), r.text);
check('it is listed', (await call('GET', '/api/messages/saved-replies')).json?.data?.some(x => x.id === sid && x.body.includes('router')));
r = await call('POST', '/api/messages/saved-replies', { title: 'x', body: 'y' }, 'finance_admin');
check('someone without Messages cannot add one', r.status === 403, r.text);
r = await call('DELETE', `/api/messages/saved-replies/${sid}`);
check('saved reply deleted', r.status === 200 && !(await call('GET', '/api/messages/saved-replies')).json?.data?.some(x => x.id === sid), r.text);

/* 10. The Reviews views. */
const units = await call('GET', '/api/reviews/units');
const mine = units.json?.data?.find(x => x.unitId === UID);
check('By unit lists the test unit with its reviews and its reservation', mine?.reviews === 2 && mine?.staysCheckedOut === 1 && mine?.staysReviewed === 1 && mine?.staysWithoutReview === 0, JSON.stringify(mine));
const blds = await call('GET', '/api/reviews/units?by=building');
check('By building adds its units up', blds.json?.data?.find(x => x.propertyId === building)?.reviews === 2, JSON.stringify(blds.json?.data?.find(x => x.propertyId === building)));
const bad = await call('GET', `/api/reviews?bad=1&unitId=${UID}`);
check('Bad reviews holds the 3-star review only', bad.json?.total === 1 && bad.json.data[0].rating === 3, JSON.stringify(bad.json?.data?.map(x => x.rating)));
await db(`INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, created_at, updated_at) VALUES
  ($1, $3, NULL, 'airbnb', 'HMOLD', 'checked_out', to_char(current_date - 40, 'YYYY-MM-DD'), to_char(current_date - 30, 'YYYY-MM-DD'), 2, 1, 0, 1, now()::text, now()::text),
  ($2, $3, NULL, 'booking_com', 'BDCNEW', 'checked_out', to_char(current_date - 6, 'YYYY-MM-DD'), to_char(current_date - 3, 'YYYY-MM-DD'), 2, 1, 0, 1, now()::text, now()::text)`, `mr-old-${tag}`, `mr-new-${tag}`, UID);
const out = await call('GET', `/api/reviews/unreviewed?unitId=${UID}`);
const o = Object.fromEntries((out.json?.data ?? []).map(x => [x.bookingRef, x]));
check('Outstanding lists the two reservations with no review', out.json?.total === 2 && o.HMOLD && o.BDCNEW, JSON.stringify(out.json?.data));
check('days since checkout and the review window', [30, 31].includes(o.HMOLD?.daysSinceCheckout) && o.HMOLD?.windowClosed === true && o.BDCNEW?.windowClosed === false, JSON.stringify(o));
check('the count tiles add up', out.json?.totals?.checkedOut === 3 && out.json.totals.reviewed === 1 && out.json.totals.notReviewed === 2 && out.json.totals.reviewRate === 33 && out.json.totals.windowClosed === 1, JSON.stringify(out.json?.totals));
check('Window closed filter', (await call('GET', `/api/reviews/unreviewed?unitId=${UID}&window=closed`)).json?.total === 1);
const drawer = await call('GET', `/api/reservations/${RES}`);
check('the reservation shows its review and conversation', drawer.json?.review?.rating === 3 && !!drawer.json?.threadId, JSON.stringify({ review: drawer.json?.review, threadId: drawer.json?.threadId }));

server.close();
done();
