/**
 * mcpShowMe.ts: show_me (owner, 27 Nov 2026): a picture of the real ERP screen with a RED BOX on the button to press,
 * next to the ?highlight= link that outlines it on the live page. Mirrors Houzs PR 6132, including its lesson: the AI
 * app gets the screenshot itself as a plain WebP image (Claude rejects SVG images) plus the box coordinates; the
 * annotated picture (red box, arrow, caption drawn over the screenshot) is an HTML page behind a 15-minute link.
 *
 * Screenshots: public/help-shots/*.webp + boxes in ./howto/helpShots.ts, captured by scripts/capture-help-shots.mjs
 * from the local dev server with demo data only (no production data, no sign-in). Supply chain engine screens are not
 * captured (a separate site inside the ERP); show_me says so and gives the link. Pure: the tool
 * layer (mcpHowtoTools.ts) loads the file and stores the annotated page.
 */
import { HELP_SHOTS, type HelpShot } from './howto/helpShots';
import { GUIDES, isEngineScreen, normaliseLabelText, pageLink } from './mcpHowto';
import { screenForPath } from './mcpScreens';

export const SHOT_NOTE = 'This screenshot uses test data, so names and numbers differ from yours, but the layout and the buttons are the same.';

/** A resolved picture: the page, the label, the shot and its box. */
export type ShotHit = { page: string; label: string; shot: HelpShot; box: [number, number, number, number] };

const own = (page: string) => (Object.prototype.hasOwnProperty.call(HELP_SHOTS, page) ? HELP_SHOTS[page] : null);

/** The box of a label on a page's screenshot (exact, then starts-with either way), or null. */
export function boxOn(page: string, label: string): ShotHit | null {
  const shot = own(page);
  if (!shot || !label.trim()) return null;
  const l = normaliseLabelText(label);
  const keys = Object.keys(shot.boxes);
  const key = keys.find(k => normaliseLabelText(k) === l) ?? keys.find(k => normaliseLabelText(k).startsWith(l) || l.startsWith(normaliseLabelText(k)));
  return key ? { page, label: key, shot, box: shot.boxes[key] } : null;
}

/** The first boxed label on a page's screenshot, or null. */
export function firstBox(page: string): ShotHit | null {
  const shot = own(page);
  const key = shot ? Object.keys(shot.boxes)[0] : undefined;
  return shot && key ? { page, label: key, shot, box: shot.boxes[key] } : null;
}

export type ShowMeArgs = { path?: unknown; label?: unknown; guide_id?: unknown; step?: unknown };

/** Which screenshot and box answer {guide_id + step | path + label | label}; or why there is none. */
export function resolveShot(args: ShowMeArgs): { hit: ShotHit; caption: string } | { error: string; page?: string; label?: string } {
  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (typeof args.guide_id === 'string' && args.guide_id.trim()) {
    const g = GUIDES.find(x => x.id === (args.guide_id as string).trim());
    if (!g) return { error: `No guide "${args.guide_id}". Use how_to to find the guide id.` };
    const n = Number(args.step ?? 0);
    const chosen = n >= 1 && n <= g.steps.length ? { s: g.steps[n - 1], i: n - 1 } : g.steps.map((s, i) => ({ s, i })).find(x => x.s.highlight);
    if (!chosen) return { error: `Guide "${g.id}" has no step with a button to show.` };
    const page = (chosen.s.page ?? g.page).split('?')[0];
    const want = label || chosen.s.highlight || '';
    if (isEngineScreen(page)) return { error: `Step ${chosen.i + 1} is on a supply chain screen, which has no screenshot yet. Use the link: it opens that screen.`, page, label: want };
    const hit = want ? boxOn(page, want) : firstBox(page);
    if (!hit) return { error: `"${want}" is not on the captured screenshot of ${page} (it may need a record open or data on screen). Use the link instead.`, page, label: want };
    return { hit, caption: `${g.title}: step ${chosen.i + 1}, press "${hit.label}"` };
  }
  if (typeof args.path === 'string' && args.path.trim()) {
    const screen = screenForPath(args.path);
    const page = screen?.screen.path ?? args.path.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
    if (isEngineScreen(page)) return { error: `${page} is a supply chain screen, which has no screenshot yet. Use the link: it opens that screen.`, page, label };
    const hit = label ? boxOn(page, label) : firstBox(page);
    if (!hit) return { error: own(page) ? `"${label}" is not on the captured screenshot of ${page}. Use the link instead.` : `No screenshot of ${page} yet (it needs a record open, or it was not captured). Use the link instead.`, page, label };
    return { hit, caption: `Press "${hit.label}" (red box)` };
  }
  if (!label) return { error: 'Give a guide_id (and step), or a path and the button label.' };
  // A label alone: the first screenshot that shows exactly that label.
  for (const page of Object.keys(HELP_SHOTS)) {
    const hit = boxOn(page, label);
    if (hit && normaliseLabelText(hit.label) === normaliseLabelText(label)) return { hit, caption: `Press "${hit.label}" (red box)` };
  }
  return { error: `No screenshot shows "${label}" yet. Use where_is for the page and its link.`, label };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The annotated picture: the screenshot, a red box around the element, an arrow to it and a caption bar. */
export function annotatedSvg(hit: ShotHit, webpBase64: string, caption: string): string {
  const { w, h } = hit.shot;
  const [x, y, bw, bh] = hit.box;
  const pad = 6;
  const bx = Math.max(0, x - pad);
  const by = Math.max(0, y - pad);
  const tipX = bx + (bw + pad * 2) / 2;
  const below = by < 120;
  const tipY = below ? by + bh + pad * 2 : by;
  const tailX = Math.min(Math.max(tipX + (tipX > w / 2 ? -110 : 110), 10), w - 10);
  const tailY = below ? Math.min(tipY + 90, h - 10) : Math.max(tipY - 90, 10);
  const ang = Math.atan2(tipY - tailY, tipX - tailX);
  const head = (d: number) => `${Math.round(tipX - 16 * Math.cos(ang + d))},${Math.round(tipY - 16 * Math.sin(ang + d))}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 44}" viewBox="0 0 ${w} ${h + 44}">
<image href="data:image/webp;base64,${webpBase64}" x="0" y="0" width="${w}" height="${h}"/>
<rect x="${bx}" y="${by}" width="${bw + pad * 2}" height="${bh + pad * 2}" rx="6" fill="none" stroke="red" stroke-width="4"/>
<line x1="${tailX}" y1="${tailY}" x2="${tipX}" y2="${tipY}" stroke="red" stroke-width="5" stroke-linecap="round"/>
<polygon points="${tipX},${tipY} ${head(0.45)} ${head(-0.45)}" fill="red"/>
<rect x="0" y="${h}" width="${w}" height="44" fill="black"/>
<text x="14" y="${h + 28}" font-family="Arial, sans-serif" font-size="17" fill="white">${esc(caption.slice(0, 140))}</text>
</svg>`;
}

/** A small HTML page holding the annotated picture, for the 15-minute link. */
export const annotatedHtml = (svg: string, title: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;background:black;display:flex;justify-content:center}svg{max-width:100%;height:auto}</style></head><body>${svg}</body></html>`;

/** What show_me hands back besides the picture itself. */
export function showMeText(hit: ShotHit, origin: string, caption: string, annotatedLink: string | null, capturedAt: string) {
  return {
    caption,
    press: hit.label,
    page: hit.page,
    box: { x: hit.box[0], y: hit.box[1], width: hit.box[2], height: hit.box[3], imageWidth: hit.shot.w, imageHeight: hit.shot.h },
    ...(annotatedLink ? { annotatedImage: annotatedLink, annotatedImageExpires: '15 minutes' } : {}),
    openThePage: pageLink(origin, hit.page, hit.label) ?? hit.page,
    note: SHOT_NOTE,
    capturedAt,
  };
}

/** show_me's tool definition. */
export const SHOW_ME_TOOL = {
  name: 'show_me',
  title: 'Show me where to click (annotated screenshot)',
  description: "A screenshot of the real ERP screen (WebP) with the box of the button to press (x, y, width, height), a 15-minute link to the same picture with a red box and an arrow drawn on it, and the live-page link that outlines the button. Pass guide_id (+ step) from how_to, or path (+ label) from where_is / explain_screen, or just label. The screenshot uses test data: names and numbers differ, the layout is the same. The Conts' own screens only; supply chain screens answer with their link.",
  inputSchema: {
    type: 'object',
    properties: {
      guide_id: { type: 'string', description: 'A how_to guide id' },
      step: { type: 'number', description: 'Step number in that guide (default: the first step with a button)' },
      path: { type: 'string', description: 'ERP page path, e.g. /owners/payouts' },
      label: { type: 'string', description: 'The button / tab label, e.g. Start payout run' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
