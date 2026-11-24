/* A booking site's "no name yet" placeholder is not a guest name (owner, 24 Nov 2026): Airbnb sends 请设置姓名
   ("please set your name") until the guest fills one in. Such a value counts as no name, so the booking takes the
   channel-and-reference placeholder and a later real name replaces it. */
const PLACEHOLDER_NAMES = new Set(['请设置姓名', '請設置姓名', 'please set your name']);

/** The name part as given, or '' when it is blank or a booking site's placeholder. */
export function realNamePart(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  return PLACEHOLDER_NAMES.has(s.toLowerCase()) ? '' : s;
}
