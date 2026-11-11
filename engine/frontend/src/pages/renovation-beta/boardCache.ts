/* The last project list this person saw, kept in the browser so the list opens at once and refreshes behind it (owner,
   11 Nov 2026: "loading 很久, 线慢的时候"). Keyed by user and company (lib/storageIdentity), never shared between people.
   Best effort: a full or blocked storage just means the list waits for the server as before. */

import { identityStorageKey } from "../../lib/storageIdentity";

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function readBoardCache<T>(name: string): { data: T; at: number } | null {
  try {
    const key = identityStorageKey(`board-cache:v1:${name}`);
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (!parsed || typeof parsed.at !== "number" || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBoardCache<T>(name: string, data: T): void {
  try {
    const key = identityStorageKey(`board-cache:v1:${name}`);
    if (key) window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full or blocked: the next visit loads from the server */
  }
}
