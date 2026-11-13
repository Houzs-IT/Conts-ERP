// Menu links (chew, 11 Nov 2026: right-click on the menu had no "Open link in new tab"): a plain click opens the page in the app; a click
// meant for a new tab or window is left to the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensInPlace } from './linkClick.ts';

const click = (over = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });

test('a plain left click opens the page in the app', () => {
  assert.equal(opensInPlace(click()), true);
});

test('Ctrl, Cmd, Shift or Alt with the click, or the middle button, is left to the browser (new tab, new window, download)', () => {
  assert.equal(opensInPlace(click({ ctrlKey: true })), false);
  assert.equal(opensInPlace(click({ metaKey: true })), false);
  assert.equal(opensInPlace(click({ shiftKey: true })), false);
  assert.equal(opensInPlace(click({ altKey: true })), false);
  assert.equal(opensInPlace(click({ button: 1 })), false);
});

test('a click something else already handled is left alone', () => {
  assert.equal(opensInPlace(click({ defaultPrevented: true })), false);
});
