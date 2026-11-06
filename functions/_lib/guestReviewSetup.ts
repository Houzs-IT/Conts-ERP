import { ALL_GUEST_REVIEW_TAGS } from '../../src/lib/reviewRules';

/** What the guest review templates and rules screens send and receive (functions/api/reviews/guest-templates, guest-rules). */
export const templateOut = (t: any) => ({
  id: t.id, title: t.title, body: t.body, active: Number(t.is_active) === 1, useCount: Number(t.use_count ?? 0), lastUsedAt: t.last_used_at ?? null,
});

const parse = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
export const ruleOut = (r: any) => ({
  id: r.id, name: r.name, condition: r.condition as 'no_issues' | 'always', mode: r.mode as 'auto' | 'approval', active: Number(r.is_active) === 1,
  cleanliness: Number(r.cleanliness), communication: Number(r.communication), respect_house_rules: Number(r.respect_house_rules),
  recommend: Number(r.recommend) === 1, tags: Array.isArray(parse(r.tags)) ? (parse(r.tags) as string[]) : [], position: Number(r.position),
});

/** A rule as typed on the form, checked. `before` fills what a PATCH leaves out. */
export function readRule(b: any, before?: ReturnType<typeof ruleOut>): { ok: true; value: Omit<ReturnType<typeof ruleOut>, 'id' | 'position'> } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const pick = <T,>(k: string, d: T): unknown => (b?.[k] === undefined ? d : b[k]);
  const name = String(pick('name', before?.name ?? '')).trim();
  if (!name) fields.name = 'Give the rule a name.'; else if (name.length > 80) fields.name = 'Keep the name to 80 characters.';
  const condition = String(pick('condition', before?.condition ?? 'no_issues'));
  if (!['no_issues', 'always'].includes(condition)) fields.condition = 'Pick when the rule applies.';
  const mode = String(pick('mode', before?.mode ?? 'approval'));
  if (!['auto', 'approval'].includes(mode)) fields.mode = 'Pick send by itself or needs approval.';
  const rating = (k: 'cleanliness' | 'communication' | 'respect_house_rules') => {
    const n = Number(pick(k, before?.[k] ?? 5));
    if (!Number.isInteger(n) || n < 1 || n > 5) fields[k] = 'Pick 1 to 5 stars.';
    return n;
  };
  const tags = pick('tags', before?.tags ?? []);
  const list = Array.isArray(tags) ? [...new Set(tags.map(String))] : [];
  if (list.some(t => !ALL_GUEST_REVIEW_TAGS.includes(t))) fields.tags = 'One of the tags is not an Airbnb tag.';
  const value = {
    name, condition: condition as 'no_issues' | 'always', mode: mode as 'auto' | 'approval', active: pick('active', before?.active ?? true) !== false,
    cleanliness: rating('cleanliness'), communication: rating('communication'), respect_house_rules: rating('respect_house_rules'),
    recommend: pick('recommend', before?.recommend ?? true) !== false, tags: list,
  };
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value };
}

