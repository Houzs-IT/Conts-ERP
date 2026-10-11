/** A text cell a spreadsheet would run as a formula (=, +, -, @, tab or carriage return first) gets a leading
 *  apostrophe, so a guest or booking-site name like =HYPERLINK(...) shows as text instead of running when the file is
 *  opened. Plain numbers and phone numbers (-12.50, +60 12-345 6789) are left alone. Same rule as src/lib/export.ts. */
export const csvSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().,-]+$/.test(v) ? `'${v}` : v);

/** One CSV cell, always quoted, formula-guarded. */
export const csvCell = (v: unknown) => `"${csvSafe(String(v ?? '')).replace(/"/g, '""')}"`;
