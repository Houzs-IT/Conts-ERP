#!/usr/bin/env node
/** Generates a password hash in the same format functions/_lib/auth.ts verifies.
 *  Usage: node scripts/hash-password.mjs "YourPassword1"
 *  Paste the output into scripts/seed-d1.sql in place of REPLACE_WITH_HASH. */

import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "YourPassword1"');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
console.log(`pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`);
