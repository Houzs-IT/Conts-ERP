import { csvSafe } from '../../engine/frontend/src/vendor/shared/format';
/** A text cell a spreadsheet would run as a formula (=, +, -, @, tab or carriage return first) gets a leading
 *  apostrophe, so a guest or booking-site name like =HYPERLINK(...) shows as text instead of running when the file is
 *  opened. Plain numbers and phone numbers (-12.50, +60 12-345 6789) are left alone. Same rule as src/lib/export.ts. */
export { csvSafe };

/** One CSV cell, always quoted, formula-guarded. */
export const csvCell = (v: unknown) => `"${csvSafe(String(v ?? '')).replace(/"/g, '""')}"`;
