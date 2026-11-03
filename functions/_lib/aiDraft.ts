import { type Env, one, run, nowIso } from './db';

/**
 * AI draft replies to reviews (owner, 3 Nov 2026). A draft is only ever put in the reply box for a person to read,
 * change and post: nothing here sends anything to a guest. Two things must both be true to draft:
 *   - the Pages secret ANTHROPIC_API_KEY is set (the owner sets it; see TODO.md), and
 *   - Settings: "AI draft replies" is on (settings key reviews.ai_drafts, Reviews > Review guests > Settings).
 * Without the key the screen says "AI drafting is not set up"; with the key but the setting off it says it is off.
 */
export const AI_SETTING_KEY = 'reviews.ai_drafts';
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export const aiConfigured = (env: Env) => !!(env.ANTHROPIC_API_KEY ?? '').trim();
export async function aiEnabled(env: Env): Promise<boolean> {
  return (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', AI_SETTING_KEY))?.value === '1';
}
export const setAiEnabled = (env: Env, on: boolean) => run(env,
  'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
  AI_SETTING_KEY, on ? '1' : '0', nowIso());

export interface DraftInput {
  channel: string; guestName: string; unit: string | null; score: string; comment: string | null;
  categories: { label: string; score: string }[]; tags: string[];
}

const SYSTEM = `You write a host's public reply to a guest review for The Conts, a short-stay rental operator in Malaysia.
Write in plain, warm, professional British English. 40 to 110 words. No greeting line like "Dear", start with the guest's first name.
Thank the guest. If they raised a problem, acknowledge it specifically and say briefly what the team will do, without blaming anyone,
without promising refunds, discounts or compensation, and without inventing facts you were not given. Never mention staff names,
door codes, prices or other guests. No emoji, no hashtags, no sign-off with a person's name; end with "The Conts team".
Return only the reply text.`;

/** Asks the model for a draft. Never throws: { ok: false, reason } when it could not. */
export async function draftReviewReply(env: Env, d: DraftInput): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!aiConfigured(env)) return { ok: false, reason: 'AI drafting is not set up.' };
  const facts = [
    `Channel: ${d.channel === 'booking_com' ? 'Booking.com' : d.channel === 'airbnb' ? 'Airbnb' : d.channel}`,
    `Guest: ${d.guestName}`, d.unit ? `Unit: ${d.unit}` : null, `Overall score: ${d.score}`,
    d.categories.length ? `Category scores: ${d.categories.map(c => `${c.label} ${c.score}`).join(', ')}` : null,
    d.tags.length ? `Tags the guest picked: ${d.tags.join(', ')}` : null,
    `Review text: ${d.comment?.trim() ? d.comment.trim().slice(0, 3000) : '(no text, score only)'}`,
  ].filter(Boolean).join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY!.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: facts }] }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, reason: res.status === 401 ? 'The AI key was refused. Check ANTHROPIC_API_KEY.' : `The AI service did not answer (status ${res.status}). Try again in a moment.` };
    const body = await res.json<{ content?: { type: string; text?: string }[] }>().catch(() => null);
    const text = (body?.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim();
    return text ? { ok: true, text: text.slice(0, 1500) } : { ok: false, reason: 'The AI service gave an empty answer. Try again.' };
  } catch {
    return { ok: false, reason: 'The AI service could not be reached. Try again in a moment.' };
  }
}
