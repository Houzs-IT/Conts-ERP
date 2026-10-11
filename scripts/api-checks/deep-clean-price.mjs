// A unit's deep clean price: saved on the unit, read back, and charged when a deep clean is finished; the standard
// price is untouched. Needs a local server on demo data (see harness.mjs).
//
// Run: API_BASE=http://localhost:8788 node scripts/api-checks/deep-clean-price.mjs
import { call, check, done, cookieFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const units = await call('GET', '/api/units?pageSize=5');
const unitId = (units.json?.data ?? units.json?.rows ?? [])[2]?.id;
check('a demo unit', !!unitId, units.text);

const set = await call('PATCH', `/api/units/${unitId}`, { cleaningPrice: 9000, deepCleaningPrice: 15800 });
check('both prices saved', set.status < 300, set.text);
const bad = await call('PATCH', `/api/units/${unitId}`, { deepCleaningPrice: -1 });
check('a negative deep price is refused', bad.status === 422, bad.text);
const got = await call('GET', '/api/properties');
const u = (got.json?.units ?? got.json?.data?.units ?? []).find(x => x.id === unitId) ?? JSON.stringify(Object.keys(got.json ?? {}));
check('the unit reads back RM 90 standard, RM 158 deep', u?.cleaningPrice === 9000 && u?.deepCleaningPrice === 15800, got.text.slice(0, 300));

const made = await call('POST', '/api/housekeeping/tasks', { unitId, date: today, kind: 'deep_clean', title: 'Deep clean' });
const id = made.json?.id ?? made.json?.task?.id;
check('deep clean job added', !!id, made.text);
const detail = await call('GET', `/api/housekeeping/tasks/${id}`);
check('the job shows the deep price as the unit rate', detail.json?.cost?.amount === 15800 && detail.json?.cost?.source === 'unit', JSON.stringify(detail.json?.cost));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'proof.png');
const up = await fetch(`${BASE}/api/tasks/${id}/photos`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: form });
check('proof photo added', up.status < 300, await up.text());
const fin = await call('POST', `/api/tasks/${id}/complete`, { photoIds: [] });
check('the deep clean is charged RM 158', fin.json?.cost?.amount === 15800 && fin.json?.cost?.created === true, fin.text);

done();
