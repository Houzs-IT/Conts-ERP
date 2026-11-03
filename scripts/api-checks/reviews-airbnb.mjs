// Reviews, Airbnb's way (migration 0203), against a pretend Channex served by this script (no real Channex, no
// network): native scales (Airbnb out of 5, Booking.com out of 10), Airbnb's category scores and tags, reviews Airbnb
// hides until the guest is reviewed, new-review notices, the host's review of the guest (send, fail, retry, waiting for
// Airbnb), the 14-day countdown and window, auto rules, the Bad guest hold to day 13, tag figures, unit health,
// the link from low cleanliness to the clean before the stay and its cleaner, the owner's reviews and AI drafting
// switched off.
//
// Needs, on this machine only:
//   1. PORT=55487 node scripts/dev-pglite.mjs  (or any local Postgres with the migrations and demo data)
//   2. a local server on it with the pretend Channex, e.g.
//        npx wrangler pages dev dist --port 8847 --binding CHANNEX_API_KEY=mock --binding CHANNEX_BASE_URL=http://127.0.0.1:8848
//   3. API_BASE=http://localhost:8847 MOCK_PORT=8848 DB_URL=postgres://pos_app:local@127.0.0.1:55487/postgres node scripts/api-checks/reviews-airbnb.mjs
// It adds its own unit, reservations, reviews, cleaners and jobs (ids start ra-). Safe to run again on the same database.
import { createServer } from 'node:http';
import postgres from 'postgres';
import { call, callAsUser, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL ?? 'postgres://pos_app:local@127.0.0.1:55487/postgres';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Refusing: DB_URL must be a local database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

/* ---------------------------------------------------------------- the pretend Channex ---------------------------- */
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8848);
const mock = { reviews: [], guestReviews: [], guestFails: 0, hits: [] };
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    mock.hits.push(`${req.method} ${u.pathname}`);
    const p = u.pathname.replace(/^\/api\/v1/, '');
    if (p === '/reviews' && req.method === 'GET') {
      const page = Number(u.searchParams.get('pagination[page]') ?? 1);
      return send(res, 200, { data: page === 1 ? mock.reviews : [] });
    }
    const m = /^\/reviews\/([^/]+)\/guest_review$/.exec(p);
    if (m && req.method === 'POST') {
      if (mock.guestFails > 0) { mock.guestFails--; return send(res, 422, { errors: { title: 'refused' } }); }
      mock.guestReviews.push({ review: m[1], body: JSON.parse(body || '{}') });
      return send(res, 200, { meta: { message: 'Success' } });
    }
    if (/^\/reviews\/[^/]+\/reply$/.test(p)) return send(res, 200, { data: {} });
    return send(res, 200, { data: [] });
  });
});
await new Promise(r => server.listen(MOCK_PORT, '127.0.0.1', r));
const sync = async () => { const r = await call('POST', '/api/integrations/sync', {}); if (r.status !== 200) console.log('sync answered', r.status, r.text.slice(0, 200)); return r; };

/* ---------------------------------------------------------------- setup -------------------------------------------- */
const tag = Date.now().toString().slice(-6);
const day = n => { const d = new Date(Date.now() + 8 * 3600e3 + n * 864e5); return d.toISOString().slice(0, 10); };
const owner = (await db(`SELECT id, user_id FROM owners WHERE user_id IS NOT NULL ORDER BY id LIMIT 1`))[0];
const building = (await call('POST', '/api/properties', { name: `RA Building ${tag}`, state: 'Kuala Lumpur', city: 'Kuala Lumpur' })).json?.id;
const unitRes = await call('POST', '/api/units', { buildingId: building, ownerId: owner?.id, unitCode: `RA-${tag}`, unitNumber: `RA-${tag}`, listingName: `RA Studio ${tag}` });
const UID = unitRes.json?.id;
check('test unit made', !!UID, unitRes.text);
const G = `ra-guest-${tag}`;
await db(`INSERT INTO guests (id, full_name, created_at) VALUES ($1, 'Rina Aziz', now()::text), ($1 || '-b', 'Blake Lister', now()::text)`, G);
await db(`UPDATE guests SET tags = 'blacklist' WHERE id = $1`, `${G}-b`);
const res = async (key, channel, ciAgo, coAgo, guest = G) => {
  const id = `ra-${key}-${tag}`;
  await db(`INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, channex_booking_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'checked_out', $6, $7, 2, 30000, 3000, 27000, $8, now()::text, now()::text)`, id, UID, guest, channel, `RA${key}`, day(-ciAgo), day(-coAgo), `cx-b-${key}-${tag}`);
  return id;
};
// Airbnb stays checked out 2, 5, 9, 12 and 20 days ago; a Booking.com one; one by a guest on the Blacklist.
const R2 = await res('a2', 'airbnb', 4, 2), R5 = await res('a5', 'airbnb', 8, 5), R9 = await res('a9', 'airbnb', 11, 9);
const R12 = await res('a12', 'airbnb', 14, 12), R20 = await res('a20', 'airbnb', 23, 20), RB = await res('b7', 'booking_com', 10, 7);
const RBL = await res('bl3', 'airbnb', 6, 3, `${G}-b`);
// A cleaner and the clean before stay a9 (on its check-in day).
// Rules from the demo data stay off while this runs, so only this test's rule writes reviews.
await db(`UPDATE guest_review_rules SET is_active = 0`);
await db(`INSERT INTO cleaners (id, full_name, employment_type, is_active, created_at, updated_at) VALUES ($1, 'Ra Cleaner', 'internal', 1, now()::text, now()::text)`, `ra-cl-${tag}`);
await db(`INSERT INTO tasks (id, unit_id, kind, state, title, scheduled_for, cleaner_id, requires_photo, created_at, updated_at)
  VALUES ($1, $2, 'turnover', 'resolved', 'Turnover', $3, $4, 1, now()::text, now()::text)`, `ra-task-${tag}`, UID, `${day(-11)}T11:00:00+08:00`, `ra-cl-${tag}`);
await db(`INSERT INTO task_cleaners (id, task_id, cleaner_id, position, assigned_at) VALUES ($1, $2, $3, 0, now()::text)`, `ra-tc-${tag}`, `ra-task-${tag}`, `ra-cl-${tag}`);

/* 1. The pull: native scales, Airbnb categories (clean -> cleanliness), tags, hidden, notices. */
const rv = (id, booking, o) => ({ id, type: 'review', attributes: { guest_name: 'Rina Aziz', inserted_at: new Date().toISOString(), received_at: new Date().toISOString(), updated_at: new Date().toISOString(), reply: null, ...o }, relationships: { booking: { data: { id: booking } } } });
mock.reviews = [
  rv(`cx-rv-a9-${tag}`, `cx-b-a9-${tag}`, { ota: 'AirBNB', overall_score: 6, content: `Dusty shelves ${tag}`, is_hidden: false,
    scores: [{ category: 'clean', score: 6 }, { category: 'accuracy', score: 8 }, { category: 'communication', score: 10 }, { category: 'checkin', score: 10 }, { category: 'location', score: 10 }, { category: 'value', score: 8 }],
    tags: ['guest_review_host_negative_dirty_or_dusty', 'guest_review_host_positive_walkable'] }),
  rv(`cx-rv-a2-${tag}`, `cx-b-a2-${tag}`, { ota: 'AirBNB', overall_score: 10, content: `Lovely ${tag}`, is_hidden: true,
    scores: [{ category: 'clean', score: 10 }, { category: 'value', score: 10 }], tags: ['guest_review_host_positive_walkable'] }),
  rv(`cx-rv-b7-${tag}`, `cx-b-b7-${tag}`, { ota: 'BookingCom', overall_score: 9, content: null, raw_content: { positive: 'Pool', negative: 'Lift' },
    scores: [{ category: 'clean', score: 9 }, { category: 'staff', score: 10 }] }),
];
await sync();
const list = await call('GET', `/api/reviews?q=${encodeURIComponent(`RA-${tag}`)}&pageSize=50`);
const byRes = id => list.json?.data?.find(x => x.reservationId === id);
const a9 = byRes(R9), a2 = byRes(R2), b7 = byRes(RB);
check('three reviews pulled for the test unit', list.json?.data?.length === 3, list.text.slice(0, 300));
check('Airbnb shown out of 5 (6/10 is 3 stars)', a9?.native?.max === 5 && a9?.native?.value === 3, JSON.stringify(a9?.native));
check('Booking.com shown out of 10 (9/10)', b7?.native?.max === 10 && b7?.native?.value === 9, JSON.stringify(b7?.native));
check('Airbnb categories kept under our names, in Airbnb order', JSON.stringify(a9?.categories?.map(c => c.key)) === JSON.stringify(['cleanliness', 'accuracy', 'communication', 'checkin', 'location', 'value']), JSON.stringify(a9?.categories));
check('Airbnb category on its own scale (clean 6/10 is 3 / 5)', a9?.categories?.[0]?.native?.value === 3 && a9.categories[0].native.max === 5);
check('Booking.com category stays out of 10', b7?.categories?.find(c => c.key === 'staff')?.native?.max === 10);
check('tags kept as words with their tone', a9?.tags?.some(t => t.label === 'Dirty or dusty' && t.tone === 'negative'), JSON.stringify(a9?.tags));
check('hidden review marked hidden', a2?.hidden === true && a9?.hidden === false);
check('low cleanliness review is linked to the clean before the stay and its cleaner',
  a9?.lowCleanliness === true && a9?.cleanJobs?.[0]?.cleaners?.[0]?.name === 'Ra Cleaner', JSON.stringify(a9?.cleanJobs));
check('a clean review is not flagged low', a2?.lowCleanliness === false);
const hiddenOnly = await call('GET', `/api/reviews?hidden=1&q=${encodeURIComponent(`RA-${tag}`)}`);
check('hidden filter', hiddenOnly.json?.data?.length === 1 && hiddenOnly.json.data[0].reservationId === R2, hiddenOnly.text.slice(0, 200));
const lowOnly = await call('GET', `/api/reviews?lowClean=1&q=${encodeURIComponent(`RA-${tag}`)}`);
// Booking.com 9/10 is 4.5 out of 5, also under 4.7.
check('low cleanliness filter (Airbnb 3/5 and Booking.com 9/10)', lowOnly.json?.data?.length === 2 && lowOnly.json.data.every(x => [R9, RB].includes(x.reservationId)), lowOnly.text.slice(0, 200));
const tagged = await call('GET', `/api/reviews?tag=guest_review_host_negative_dirty_or_dusty&q=${encodeURIComponent(`RA-${tag}`)}`);
check('tag filter', tagged.json?.data?.length === 1, tagged.text.slice(0, 200));
check('summary counts hidden reviews and each channel on its scale', (list.json?.summary?.hidden ?? 0) >= 1 && list.json?.byChannel?.booking_com?.max === 10, JSON.stringify(list.json?.byChannel));
const notes = await db(`SELECT kind, title, dedupe_key FROM user_notifications WHERE dedupe_key IN ($1, $2, $3)`, `review.new:${a9?.id}`, `review.new:${a2?.id}`, `review.new:${b7?.id}`);
check('a notice for each new review', new Set(notes.map(n => n.dedupe_key)).size === 3, JSON.stringify(notes.slice(0, 3)));
check('a bad review notice says so', notes.some(n => n.kind === 'review.bad' && n.title.startsWith('Bad review: 3 / 5')), JSON.stringify(notes.map(n => n.title)));
await sync();
const notes2 = await db(`SELECT count(*)::int AS n FROM user_notifications WHERE dedupe_key = $1`, `review.new:${a9?.id}`);
const notes1 = notes.filter(n => n.dedupe_key === `review.new:${a9?.id}`).length;
check('a pull again does not notify again', notes2[0].n === notes1, `${notes2[0].n} vs ${notes1}`);

/* 2. Figures: categories by unit, health, tags, cleaners. */
const units = await call('GET', '/api/reviews/units');
const row = units.json?.data?.find(x => x.unitId === UID);
check('unit row has category averages out of 5', row?.categories?.cleanliness?.reviews === 3 && Math.abs(row.categories.cleanliness.average - (3 + 5 + 4.5) / 3) < 0.01, JSON.stringify(row?.categories));
check('unit cleanliness under 4.7 is flagged', row?.flagged?.includes('cleanliness'), JSON.stringify(row?.flagged));
check('unit top complaint is the negative tag', row?.topComplaint?.label === 'Dirty or dusty', JSON.stringify(row?.topComplaint));
check('unit counts its hidden review', row?.hidden === 1);
const health = await call('GET', `/api/reviews/health?unitId=${UID}`);
check('health: categories, a month in the trend, tags', health.json?.categories?.checkin?.average === 5 && health.json?.trend?.length >= 1 && health.json?.tags?.negative?.[0]?.count === 1, health.text.slice(0, 300));
const allHealth = await call('GET', '/api/reviews/health');
check('health over everything lists buildings with top complaints', Array.isArray(allHealth.json?.places) && allHealth.json.places.some(p => p.id === building), allHealth.text.slice(0, 200));
const cleaners = await call('GET', '/api/reviews/cleaners?months=3');
const cl = cleaners.json?.data?.find(c => c.cleanerId === `ra-cl-${tag}`);
// The same clean readied stay b7 too (between the previous checkout and its check-in): 3 and 4.5.
check('cleanliness by cleaner: two reviews averaging 3.75, both low', cl?.reviews === 2 && cl?.average === 3.75 && cl?.low === 2, JSON.stringify(cl));
const byCleaner = await call('GET', `/api/reviews?cleaner=ra-cl-${tag}`);
check('reviews of one cleaner', byCleaner.json?.data?.length === 2 && byCleaner.json.data.every(x => [R9, RB].includes(x.reservationId)), byCleaner.text.slice(0, 200));

/* 3. Review guests: the list, the countdown, the window. */
const due = await call('GET', '/api/reviews/guest-reviews?view=due');
const mine = (due.json?.data ?? []).filter(s => s.reservationId.endsWith(tag));
const ids = mine.map(s => s.reservationId);
check('due: Airbnb stays inside 14 days only', ids.includes(R2) && ids.includes(R12) && !ids.includes(R20) && !ids.includes(RB), JSON.stringify(ids));
const s12 = mine.find(s => s.reservationId === R12);
const left12 = Date.parse(s12?.deadline) - Date.now();
check('countdown: checkout 12 days ago leaves about 2 days', left12 > 1.4 * 864e5 && left12 < 2.6 * 864e5, s12?.deadline);
check('their hidden review is shown on the stay', mine.find(s => s.reservationId === R2)?.theirReview?.hidden === true);
const late = await call('POST', '/api/reviews/guest-reviews', { reservationId: R20, cleanliness: 5, communication: 5, respect_house_rules: 5, publicReview: 'Great', recommend: true });
check('a review after the window is refused', late.status === 422 && late.json?.error?.code === 'WINDOW_CLOSED', late.text);
const bad = await call('POST', '/api/reviews/guest-reviews', { reservationId: R2, cleanliness: 7, communication: 5, respect_house_rules: 5, publicReview: '', recommend: 'yes', tags: ['nope'] });
check('form checks stars, text, recommend and tags', bad.status === 422 && ['cleanliness', 'publicReview', 'recommend', 'tags'].every(k => bad.json?.error?.fields?.[k]), bad.text);
const notAirbnb = await call('POST', '/api/reviews/guest-reviews', { reservationId: RB, cleanliness: 5, communication: 5, respect_house_rules: 5, publicReview: 'x', recommend: true });
check('Booking.com stays cannot be reviewed', notAirbnb.status === 422 && notAirbnb.json?.error?.code === 'NOT_AIRBNB', notAirbnb.text);

/* 4. Send, fail, retry. */
mock.guestFails = 1;
const sent1 = await call('POST', '/api/reviews/guest-reviews', { reservationId: R2, cleanliness: 5, communication: 4, respect_house_rules: 5, publicReview: `Great guest ${tag}`, privateNote: 'Thanks', recommend: true, tags: ['host_review_guest_positive_neat_and_tidy'] });
check('a refused send is saved and says not sent', sent1.status === 200 && sent1.json?.send?.state === 'failed' && sent1.json?.stay?.review?.state === 'failed', sent1.text.slice(0, 300));
const retry = await call('POST', `/api/reviews/guest-reviews/${sent1.json?.stay?.review?.id}/retry`, {});
check('Retry sends it', retry.json?.send?.state === 'sent' && retry.json?.stay?.review?.state === 'sent', retry.text.slice(0, 300));
const posted = mock.guestReviews.find(g => g.review === `cx-rv-a2-${tag}`)?.body?.review;
check('Channex got the scores, texts, recommend and tags',
  posted?.scores?.length === 3 && posted.scores.find(s => s.category === 'communication')?.rating === 4 && posted.public_review === `Great guest ${tag}` && posted.private_review === 'Thanks' && posted.is_reviewee_recommended === true && posted.tags?.[0] === 'host_review_guest_positive_neat_and_tidy', JSON.stringify(posted));
const again = await call('POST', '/api/reviews/guest-reviews', { reservationId: R2, cleanliness: 5, communication: 5, respect_house_rules: 5, publicReview: 'x', recommend: true });
check('a sent review cannot be sent twice', again.status === 409, again.text);
const audits = await db(`SELECT action FROM audit_log WHERE entity_id = $1 AND action LIKE 'guest_review.%'`, sent1.json?.stay?.review?.id);
check('send recorded in the audit log', audits.some(a => a.action === 'guest_review.sent'), JSON.stringify(audits));
// No guest review in Channex yet (stay a12 has none): waits as scheduled, goes once it appears.
const wait = await call('POST', '/api/reviews/guest-reviews', { reservationId: R12, cleanliness: 4, communication: 4, respect_house_rules: 4, publicReview: 'Fine guest', recommend: true });
check('with no Airbnb review to answer yet, it waits for Airbnb', wait.json?.send?.state === 'scheduled' && /Waiting for Airbnb/.test(wait.json?.stay?.review?.lastError ?? ''), wait.text.slice(0, 300));
mock.reviews.push(rv(`cx-rv-a12-${tag}`, `cx-b-a12-${tag}`, { ota: 'AirBNB', overall_score: 10, content: 'ok', is_hidden: true }));
await sync();
await call('POST', '/api/reviews/guest-reviews/run', {});
check('the run sends it once Airbnb opened the review', (await db(`SELECT state FROM guest_reviews WHERE reservation_id = $1`, R12))[0]?.state === 'sent');

/* 5. Bad guest: held to day 13, never reviewed by a rule. */
const flag = await call('POST', '/api/reviews/guest-reviews/bad-guest', { reservationId: R5, badGuest: true, note: 'Party' });
check('Bad guest marked', flag.json?.stay?.badGuest === true, flag.text.slice(0, 200));
mock.reviews.push(rv(`cx-rv-a5-${tag}`, `cx-b-a5-${tag}`, { ota: 'AirBNB', overall_score: 4, content: 'meh', is_hidden: true }));
await sync();
const before = mock.guestReviews.length;
const held = await call('POST', '/api/reviews/guest-reviews', { reservationId: R5, cleanliness: 2, communication: 2, respect_house_rules: 1, publicReview: 'Did not follow rules', recommend: false, tags: ['host_review_guest_negative_unapproved_event'] });
const sendAfter = held.json?.stay?.review?.sendAfter;
const expected = Date.parse(`${day(-5)}T11:00:00+08:00`) + 13 * 864e5;
check('Bad guest review is held, not sent', held.json?.send?.state === 'scheduled' && mock.guestReviews.length === before, held.text.slice(0, 300));
check('held to day 13 after checkout', Date.parse(sendAfter) === expected, `${sendAfter} vs ${new Date(expected).toISOString()}`);
await call('POST', '/api/reviews/guest-reviews/run', {});
check('the run does not send it before day 13', (await db(`SELECT state FROM guest_reviews WHERE reservation_id = $1`, R5))[0]?.state === 'scheduled' && mock.guestReviews.length === before);
// Day 13 arrives (moved back in time here).
await db(`UPDATE reservations SET check_out = $1, check_in = $2 WHERE id = $3`, day(-13), day(-15), R5);
await db(`UPDATE guest_reviews SET send_after = $1 WHERE reservation_id = $2`, new Date(Date.now() - 60e3).toISOString(), R5);
await call('POST', '/api/reviews/guest-reviews/run', {});
check('on day 13 the run sends it', (await db(`SELECT state FROM guest_reviews WHERE reservation_id = $1`, R5))[0]?.state === 'sent');

/* 6. Auto rules and templates. */
const t1 = await call('POST', '/api/reviews/guest-templates', { title: `RA one ${tag}`, body: '{guest} was great at {unit}.' });
const t2 = await call('POST', '/api/reviews/guest-templates', { title: `RA two ${tag}`, body: 'Lovely guest, {guest}!' });
check('templates saved', t1.status === 201 && t2.status === 201, t1.text);
const pick = await call('GET', `/api/reviews/guest-templates?pick=${R9}`);
check('a template is picked and filled with the first name', /Rina/.test(pick.json?.text ?? '') && !/\{guest\}/.test(pick.json?.text ?? ''), pick.text);
const badRule = await call('POST', '/api/reviews/guest-rules', { name: '', cleanliness: 9 });
check('rule form checked', badRule.status === 422 && badRule.json?.error?.fields?.name && badRule.json.error.fields.cleanliness, badRule.text);
const rule = await call('POST', '/api/reviews/guest-rules', { name: `RA approve ${tag}`, condition: 'no_issues', mode: 'approval', cleanliness: 5, communication: 5, respect_house_rules: 5, recommend: true });
check('rule saved', rule.status === 201, rule.text);
const usesBefore = (await db(`SELECT COALESCE(sum(use_count), 0)::int AS n FROM guest_review_templates`))[0].n;
await db(`INSERT INTO maintenance_issues (id, unit_id, title, state, reported_at, created_at, updated_at) VALUES ($1, $2, 'Broken lamp', 'open', $3, now()::text, now()::text)`, `ra-mi-${tag}`, UID, `${day(-10)}T05:00:00Z`);
const run1 = await call('POST', '/api/reviews/guest-reviews/run', {});
const st9 = (await db(`SELECT state, source, public_review FROM guest_reviews WHERE reservation_id = $1`, R9))[0];
check('stay with a repair reported during it is not auto reviewed', !st9 || st9.state === null, JSON.stringify(st9));
const stBl = (await db(`SELECT state FROM guest_reviews WHERE reservation_id = $1`, RBL))[0];
check('a guest on the Blacklist is never auto reviewed', !stBl || stBl.state === null, JSON.stringify(stBl));
await db(`UPDATE guest_reviews SET state = NULL WHERE reservation_id = $1`, R9).catch(() => {});
await db(`DELETE FROM maintenance_issues WHERE id = $1`, `ra-mi-${tag}`);
await call('POST', '/api/reviews/guest-reviews/run', {});
const auto9 = (await db(`SELECT id, state, source, public_review FROM guest_reviews WHERE reservation_id = $1`, R9))[0];
check('no issues: the rule writes it for approval from a template', auto9?.state === 'needs_approval' && auto9?.source === 'rule' && /Rina/.test(auto9?.public_review ?? ''), JSON.stringify(auto9));
check('run reports what it did', typeof run1.json?.written === 'number', run1.text.slice(0, 200));
const approve = await call('POST', `/api/reviews/guest-reviews/${auto9?.id}/approve`, {});
check('Approve sends it', approve.json?.send?.state === 'sent', approve.text.slice(0, 300));
await call('PATCH', `/api/reviews/guest-rules/${rule.json?.rule?.id}`, { mode: 'auto' });
const RA = await res('a1', 'airbnb', 3, 1);
mock.reviews.push(rv(`cx-rv-a1-${tag}`, `cx-b-a1-${tag}`, { ota: 'AirBNB', overall_score: 10, content: 'yay', is_hidden: true }));
await sync();
await call('POST', '/api/reviews/guest-reviews/run', {});
check('an auto rule writes and sends by itself', (await db(`SELECT state FROM guest_reviews WHERE reservation_id = $1`, RA))[0]?.state === 'sent');
const usesAfter = (await db(`SELECT COALESCE(sum(use_count), 0)::int AS n FROM guest_review_templates`))[0].n;
check('templates are counted as used (two rule reviews)', usesAfter - usesBefore >= 2, `${usesBefore} -> ${usesAfter}`);
await call('DELETE', `/api/reviews/guest-rules/${rule.json?.rule?.id}`);

/* 7. Badge, owner portal, AI drafting off, permissions. */
const badges = await call('GET', '/api/nav/badges');
check('Reviews badge counts replies and guests to review', typeof badges.json?.reviews === 'number' && badges.json.reviews > 0, JSON.stringify(badges.json?.reviews));
const ownerUser = (await db(`SELECT id, email, full_name FROM users WHERE id = $1`, owner?.user_id))[0];
const ownerView = ownerUser ? await callAsUser({ userId: ownerUser.id, email: ownerUser.email, role: 'owner', fullName: ownerUser.full_name }, 'GET', `/api/owner/reviews?unitId=${UID}`) : { status: 0 };
check('owner sees reviews of their unit, hidden ones left out', ownerView.status === 200 && ownerView.json?.data?.length >= 2 && !ownerView.json.data.some(x => x.comment === `Lovely ${tag}`), ownerView.text?.slice(0, 300));
check('owner view has no cleaner or clean jobs', ownerView.json?.data?.every(x => !('cleanJobs' in x)), '');
check('owner view gives categories for one unit', ownerView.json?.categories?.cleanliness?.reviews >= 1, JSON.stringify(ownerView.json?.categories));
const draft = await call('POST', `/api/reviews/${a9?.id}/draft`, {});
check('Draft reply without an AI key: not set up', draft.status === 501 && draft.json?.error?.code === 'NOT_CONFIGURED', draft.text);
const settings = await call('GET', '/api/reviews/settings');
check('settings say AI is not set up', settings.json?.aiConfigured === false, settings.text);
const staffSet = await call('PUT', '/api/reviews/settings', { aiDrafts: true }, 'housekeeper');
check('a cleaner cannot change Reviews settings', staffSet.status === 403, staffSet.text);
const offSet = await call('PUT', '/api/reviews/settings', { aiDrafts: true });
check('management can turn AI drafts on (still not set up without the key)', offSet.json?.aiDrafts === true && offSet.json?.aiConfigured === false, offSet.text);
await call('PUT', '/api/reviews/settings', { aiDrafts: false });
const cleanerTry = await call('GET', '/api/reviews/guest-reviews', undefined, 'housekeeper');
check('a cleaner cannot open Review guests', cleanerTry.status === 403, cleanerTry.text);
const techWrite = await call('POST', '/api/reviews/guest-reviews/bad-guest', { reservationId: R9, badGuest: true }, 'technician');
check('a technician cannot mark a Bad guest', techWrite.status === 403, techWrite.text);

server.close();
done();
