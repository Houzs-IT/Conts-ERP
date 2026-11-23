// node --test src/lib/meetings.test.mjs. Meetings page helpers (src/lib/meetings.ts: lanes, usual hours, colours and how
// a 409 from the IT Hub becomes the conflict dialog; the same rules as Houzs ERP and Hookka ERP) and the staff list
// Conts sends the hub (functions/_lib/meetingsHub.ts directoryPeople, companyOf, mayManageRooms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const { busySentences, inUsualHours, layoutDay, meetingColor, readConflict } = await import('./meetings.ts');
const { directoryPeople, companyOf, mayManageRooms } = await import('../../functions/_lib/meetingsHub.ts');
const room = (o = {}) => ({ id: 1, name: "Boardroom", location: "", floor: "", seats: 12, equipment: [], open_days: [1, 2, 3, 4, 5], open_from: 9, open_to: 18, color: "#0b8043", buffer_min: 0, max_hours: 0, advance_days: 0, active: true, closures: [], ...o });
const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
const meeting = (o) => ({ id: 1, title: "M", start: new Date(at("2026-11-23", 10)).toISOString(), end: new Date(at("2026-11-23", 11)).toISOString(), roomId: 1, organizer: "lim@x", bookedBy: "lim@x", attendees: [], notes: "", video: { type: "none", url: "" }, reminders: [], status: "scheduled", startedAt: null, endedAt: null, seriesId: null, createdIn: "CONTS", linkId: null, guest: null, ...o });

test("overlapping meetings sit side by side; a later one starts its own cluster", () => {
  const out = layoutDay([{ start: 0, end: 60 }, { start: 30, end: 90 }, { start: 100, end: 120 }]);
  assert.deepEqual(out.map((o) => [o.lane, o.lanes]), [[0, 2], [1, 2], [0, 1]]);
  assert.notEqual(out[2].cluster, out[0].cluster);
});

test("usual hours: weekday 9-18 inside, evening and Sunday outside", () => {
  assert.equal(inUsualHours(room(), at("2026-11-23", 10), at("2026-11-23", 11)), true);
  assert.equal(inUsualHours(room(), at("2026-11-23", 18), at("2026-11-23", 20)), false);
  assert.equal(inUsualHours(room(), at("2026-11-22", 10), at("2026-11-22", 11)), false);
});

test("colours by room, by company, or by me; guests are grey", () => {
  const people = new Map([["lim@x", { key: "lim@x", name: "Lim", email: "lim@x", company: "Hookka", department: "Sales" }]]);
  assert.equal(meetingColor(meeting({}), "room", "lim@x", [room()], people, ["Hookka"]), "#0b8043");
  assert.equal(meetingColor(meeting({}), "me", "someone@x", [room()], people, []), "#9aa0a6");
  assert.equal(meetingColor(meeting({ guest: { name: "G", phone: "1", email: "g@x", company: "" } }), "company", "x", [], people, ["Hookka"]), "#616161");
});

test("a 409 with a conflict body opens the dialog; anything else does not", () => {
  const err = Object.assign(new Error("x"), { status: 409, rawBody: JSON.stringify({ error: "conflict", conflict: { room: null, people: [{ key: "adrian@x", meeting: { id: 3, title: "Supplier visit", start: at("2026-11-23", 13, 30), end: at("2026-11-23", 15) } }], rules: [] }, suggestTime: null, suggestRooms: [] }) });
  const c = readConflict(err);
  const people = new Map([["adrian@x", { key: "adrian@x", name: "Adrian", email: null, company: "", department: "" }]]);
  assert.deepEqual(busySentences(c.conflict, people), ["Adrian is in Supplier visit from 1:30pm to 3pm."]);
  assert.equal(readConflict(Object.assign(new Error("x"), { status: 500, rawBody: "{}" })), null);
});

test('the staff list: The Conts or Dream Crafter by side, department kept, name falls back to the email', () => {
  const out = directoryPeople([
    { id: 'u1', email: 'yh@theconts.com', full_name: 'YH', side: 'conts', department: 'Operations' },
    { id: 'u2', email: 'dc@theconts.com', full_name: '', side: 'dream_crafter', department: null },
  ]);
  assert.deepEqual(out, [
    { id: 'u1', name: 'YH', email: 'yh@theconts.com', company: 'The Conts', department: 'Operations' },
    { id: 'u2', name: 'dc@theconts.com', email: 'dc@theconts.com', company: 'Dream Crafter', department: '' },
  ]);
  assert.equal(companyOf('both'), 'The Conts');
});

test('Manage meeting rooms: management always, staff only when given it', () => {
  assert.equal(mayManageRooms({ role: 'management', levels: {} }), true);
  assert.equal(mayManageRooms({ role: 'operations_staff', levels: { meetingRooms: 'none' } }), false);
  assert.equal(mayManageRooms({ role: 'operations_staff', levels: { meetingRooms: 'edit' } }), true);
  assert.equal(mayManageRooms({ role: 'operations_staff' }), false);
});
