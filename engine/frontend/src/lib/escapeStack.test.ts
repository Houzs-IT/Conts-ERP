import { afterEach, describe, expect, test, vi } from 'vitest';
import { pushEscape } from './escapeStack';

const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

describe('escapeStack', () => {
  const pops: Array<() => void> = [];
  afterEach(() => { while (pops.length) pops.pop()!(); });

  test('Esc closes only the newest layer, and the next Esc the one under it', () => {
    const form = vi.fn();
    const confirm = vi.fn();
    pops.push(pushEscape(form));
    const popConfirm = pushEscape(confirm);
    esc();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(form).not.toHaveBeenCalled();
    popConfirm();
    esc();
    expect(form).toHaveBeenCalledTimes(1);
  });

  test('a page listener that has not joined the stack does not see an Esc the top layer took', () => {
    const pageListener = vi.fn();
    window.addEventListener('keydown', pageListener);
    const pop = pushEscape(() => {});
    esc();
    expect(pageListener).not.toHaveBeenCalled();
    pop();
    esc();
    expect(pageListener).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageListener);
  });
});
