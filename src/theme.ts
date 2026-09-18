/** Mirrors tokens.css. Every value here has a --color-* / --text-* twin.
 *  Components read from this object; nothing hard-codes a brand hex. */

export const color = {
  goldTint: '#FBF7F0', gold200: '#EADCBD', gold300: '#DDC597',
  gold: '#C8A46A', goldInk: '#8A6A2F',
  black: '#151515', charcoal: '#242424', basalt700: '#1E1E1E',
  dim: '#8A8680', onDark: '#DEDAD3',
  page: '#FAF9F6', card: '#FFFFFF', muted: '#F1F0ED', sunken: '#EDEAE4',
  border: '#DEDAD3', borderMuted: '#EDEAE4', borderStrong: '#C7C1B6',
  ink: '#252525', inkSecondary: '#4A4844', textMuted: '#706D67', faint: '#A8A29A',
} as const;

/** bg / fg / line. fg is AA on bg; line is for dots, borders, fills.
 *  The brand guide's base hexes fail AA as badge text — they live on `line`. */
export const tone = {
  success:  { bg: '#E9F5EF', fg: '#11694A', line: '#16845B' },
  warning:  { bg: '#FFF4D8', fg: '#8A5A12', line: '#B7791F' },
  critical: { bg: '#FCECEB', fg: '#A8352F', line: '#C2413B' },
  info:     { bg: '#EAF2FA', fg: '#2E6DA4', line: '#2E6DA4' },
  neutral:  { bg: '#F1F0ED', fg: '#706D67', line: '#C7C1B6' },
} as const;

/** label, fill, borderStyle, tint, ink, glyph, markInk.
 *  markInk is per channel: white on gold is 2.34:1 and on coral 3.05:1 — both fail. */
export const channel = {
  airbnb:            { label: 'Airbnb',      fill: '#FF5A5F', border: 'solid',  tint: '#FFF0F0', ink: '#B3383C', glyph: 'A',  markInk: '#151515' },
  booking_com:       { label: 'Booking.com', fill: '#003B95', border: 'solid',  tint: '#EAF0FA', ink: '#003B95', glyph: 'B',  markInk: '#FFFFFF' },
  agoda:             { label: 'Agoda',       fill: '#5C2D91', border: 'solid',  tint: '#F2ECF9', ink: '#4A2475', glyph: 'a',  markInk: '#FFFFFF' },
  direct:            { label: 'Direct',      fill: '#C8A46A', border: 'solid',  tint: '#FBF7F0', ink: '#8A6A2F', glyph: 'TC', markInk: '#151515' },
  maintenance_block: { label: 'Block',       fill: '#C2413B', border: 'dashed', tint: '#FCECEB', ink: '#A8352F', glyph: 'M',  markInk: '#FFFFFF' },
  owner_stay:        { label: 'Owner stay',  fill: '#706D67', border: 'dotted', tint: '#FAF9F6', ink: '#5C5952', glyph: 'O',  markInk: '#FFFFFF' },
} as const;

export const font = {
  sans: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

/** No authored size below 11px. */
export const text = {
  display: 40, pageTitle: 28, section: 20, cardTitle: 16,
  body: 14, small: 12, micro: 11,
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
export const radius = { xs: 4, sm: 6, control: 8, card: 12, pill: 999 } as const;

export const shadow = {
  card: '0 1px 2px 0 rgba(21,21,21,0.04), 0 0 0 1px rgba(21,21,21,0.04)',
  raised: '0 2px 8px 0 rgba(21,21,21,0.06)',
  dropdown: '0 4px 6px -1px rgba(21,21,21,0.08), 0 2px 4px -2px rgba(21,21,21,0.06)',
  overlay: '0 12px 32px 0 rgba(21,21,21,0.16)',
} as const;

export const motion = {
  fast: '120ms', standard: '200ms', slow: '240ms',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

export const shell = {
  sidebar: 244, sidebarCollapsed: 68, contentMax: 1600,
  control: 40, controlSm: 36, controlTouch: 44,
  navItem: 34, navItemL3: 30,
} as const;

/** lucide-react, the dependency already in houzs-erp and hookka-erp. */
export const iconSize = { sm: 16, nav: 17, base: 20, lg: 24 } as const;
export const iconStroke = 1.75;
