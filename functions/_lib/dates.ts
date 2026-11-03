/**
 * The one date rule for text the server writes (messages, notices, PDFs, exports shown to people): year first and
 * numeric, 2026/11/03, the same as the screens (src/lib/format.ts) and the supply chain engine (owner, 3 Nov 2026).
 * Times stay 24-hour Malaysian time. Whole months may still read "Nov 2026".
 */

const two = (n: number) => String(n).padStart(2, '0');

/** Year, month and day on the Malaysian calendar. A bare YYYY-MM-DD is that day; an instant is moved to UTC+8. */
const parts = (d: string) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(Date.parse(d) + 8 * 3600e3).toISOString().slice(0, 10);
  const [y, m, dd] = day.split('-').map(Number);
  return { y, m, d: dd };
};

/** 2026/11/03 */
export const numericDate = (d: string) => { const p = parts(d); return `${p.y}/${two(p.m)}/${two(p.d)}`; };

/** 11/03: month and day, where the year is plain from the context. */
export const numericDay = (d: string) => { const p = parts(d); return `${two(p.m)}/${two(p.d)}`; };
