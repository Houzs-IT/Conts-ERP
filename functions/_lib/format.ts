/**
 * How the server writes dates and money in text people read (messages, notices, audit summaries, PDFs).
 *
 * Not written here: the shapes come from the engine's canonical module, the same file the screens use through
 * src/lib/format.ts and the engine's own screens and PDFs use directly. One implementation, so one change applies
 * everywhere (owner, 3 Nov 2026).
 *  - Dates: day first and numeric, 03/11/2026 (YH, 11 Nov 2026); times 24-hour Malaysian time; whole months may read "Nov 2026".
 *  - Money: RM 1,234.56, always with sen.
 */
import { fmtDate, fmtDayMonth, fmtSen } from '../../engine/frontend/src/vendor/shared/format';

/** 03/11/2026 from YYYY-MM-DD (that day) or an instant (its Malaysian day). */
export const numericDate = (d: string) => fmtDate(d);

/** 03/11: day and month, where the year is plain from the context. */
export const numericDay = (d: string) => fmtDayMonth(d);

/** RM 1,234.56 from integer sen. A fraction of a sen is rounded; a negated zero reads RM 0.00. */
export const rmText = (sen: number) => fmtSen(Math.round(Number(sen)) || 0);
