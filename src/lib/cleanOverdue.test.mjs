// node --test src/lib/cleanOverdue.test.mjs. When a cleaning job is overdue, and its next check-in (src/lib/cleanOverdue.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nextCheckIn, cleanDeadline, isCleanOverdue, daysPast, openToTake } = await import('./cleanOverdue.ts');

const at = iso => Date.parse(iso);

test('with a check-in, overdue from the check-in time itself (17:00 and not clean at 17:00)', () => {
  const job = { day: '2026-11-02', checkIn: '17:00', done: false };
  assert.equal(isCleanOverdue(job, at('2026-11-02T16:59:59+08:00')), false);
  assert.equal(isCleanOverdue(job, at('2026-11-02T17:00:00+08:00')), true);
  assert.equal(isCleanOverdue(job, at('2026-11-02T23:00:00+08:00')), true);
});

test('with no check-in, overdue only after midnight at the end of the day', () => {
  const job = { day: '2026-11-02', checkIn: null, done: false };
  assert.equal(isCleanOverdue(job, at('2026-11-02T23:59:59+08:00')), false);
  assert.equal(isCleanOverdue(job, at('2026-11-03T00:00:00+08:00')), true);
});

test('the deadline is Malaysia time, whatever the clock zone', () => {
  assert.equal(new Date(cleanDeadline('2026-11-02', '13:00')).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(cleanDeadline('2026-11-02', null)).toISOString(), '2026-11-02T16:00:00.000Z');
  assert.equal(new Date(cleanDeadline('2026-12-31', null)).toISOString(), '2026-12-31T16:00:00.000Z');
});

test('a finished job is never overdue; checkout time does not matter', () => {
  assert.equal(isCleanOverdue({ day: '2026-10-01', checkIn: '12:00', done: true }, at('2026-11-02T12:00:00+08:00')), false);
  // The old rule flagged a job at its due time (the checkout, 11:00). Not any more.
  assert.equal(isCleanOverdue({ day: '2026-11-02', checkIn: '15:00', done: false }, at('2026-11-02T11:30:00+08:00')), false);
});

test('a job from an earlier day is overdue', () => {
  assert.equal(isCleanOverdue({ day: '2026-11-01', checkIn: null, done: false }, at('2026-11-02T08:00:00+08:00')), true);
  assert.equal(isCleanOverdue({ day: '2026-11-01', checkIn: '20:00', done: false }, at('2026-11-02T08:00:00+08:00')), true);
});

test('a bad day or time never throws: a bad time counts as no check-in, a bad day is never overdue', () => {
  assert.equal(isCleanOverdue({ day: '2026-11-02', checkIn: '3pm', done: false }, at('2026-11-02T16:00:00+08:00')), false);
  assert.equal(isCleanOverdue({ day: 'soon', checkIn: '12:00', done: false }, at('2026-11-02T16:00:00+08:00')), false);
});

test('next check-in: no booking arriving means no check-in, whatever the job says', () => {
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: null, taskNextGuestAt: '2026-11-02T13:00:00+08:00' }), null);
});

test('next check-in: the job time beats the booking default (HostPlatform says 13:00, booking still 15:00)', () => {
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '15:00', taskNextGuestAt: '2026-11-02T13:00:00+08:00' }), '13:00');
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '15:00', taskNextGuestAt: '2026-11-02T05:00:00.000Z' }), '13:00');
});

test('next check-in: a time set on the booking beats the job', () => {
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '12:30', taskNextGuestAt: '2026-11-02T13:00:00+08:00' }), '12:30');
});

test('next check-in: a job time on another day is ignored; the standard follows the setting', () => {
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '15:00', taskNextGuestAt: '2026-11-03T13:00:00+08:00' }), '15:00');
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '14:00', standard: '14:00', taskNextGuestAt: null }), '14:00');
  assert.equal(nextCheckIn({ day: '2026-11-02', reservationTime: '', taskNextGuestAt: null }), '15:00');
});

test('days past', () => {
  assert.equal(daysPast('2026-10-31', at('2026-11-02T00:30:00+08:00')), 2);
  assert.equal(daysPast('2026-11-02', at('2026-11-02T23:30:00+08:00')), 0);
  assert.equal(daysPast('2026-11-05', at('2026-11-02T10:00:00+08:00')), 0);
});

test('an overdue clean is not offered to take on /portal/today; one not yet due is', () => {
  const now = at('2026-11-11T15:00:00+08:00');
  const jobs = [
    { id: 'yesterday', day: '2026-11-10', next: null, done: false },
    { id: 'past-check-in', day: '2026-11-11', next: { checkInTime: '14:00' }, done: false },
    { id: 'later-check-in', day: '2026-11-11', next: { checkInTime: '16:00' }, done: false },
    { id: 'no-check-in', day: '2026-11-11', next: null, done: false },
    { id: 'tomorrow', day: '2026-11-12', next: null, done: false },
  ];
  assert.deepEqual(openToTake(jobs, now).map(j => j.id), ['later-check-in', 'no-check-in', 'tomorrow']);
});
