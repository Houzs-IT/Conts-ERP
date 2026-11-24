// node --test src/lib/meetingsUnread.test.mjs. The Meetings menu count (lib/meetingsUnread.ts) and where it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the count is read from the relay answer and is never negative or garbage', async () => {
  // meetingsCount is pure; read it out of the module text so the test needs no React or browser.
  const src = readFileSync(new URL('./meetingsUnread.ts', import.meta.url), 'utf8');
  const body = src.match(/export function meetingsCount\(r: unknown\): number \{([\s\S]*?)\n\}/)[1]
    .replace('(r as { count?: unknown } | null)', 'r');
  const meetingsCount = new Function('r', body);
  assert.equal(meetingsCount({ count: 3 }), 3);
  assert.equal(meetingsCount({ count: 0 }), 0);
  assert.equal(meetingsCount({ count: -2 }), 0);
  assert.equal(meetingsCount({ count: 'x' }), 0);
  assert.equal(meetingsCount(null), 0);
  assert.equal(meetingsCount({ count: 120 }), 120);
});

test('the Meetings menu row carries the meetings count on desk and phone', () => {
  const nav = readFileSync(new URL('./navigation.ts', import.meta.url), 'utf8');
  assert.match(nav, /key: 'meetings', label: 'Meetings'[^}]*badge: 'meetings'/);
  const desk = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(desk, /k === 'meetings' \? meetingsUnread/);
  const phone = readFileSync(new URL('../components/MobileTabBar.tsx', import.meta.url), 'utf8');
  assert.match(phone, /b === 'meetings' \? meetingsUnread/);
});
