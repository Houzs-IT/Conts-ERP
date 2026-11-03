/** How a page picked on "Scan bills" is sent to the reader (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md
 *  Task 5). A photo goes with its own image type: a PNG sent as JPEG was refused (3 Nov 2026). The reader takes JPEG,
 *  PNG and WebP up to 5 MB; anything else (HEIC, an unknown type) or a bigger photo is redrawn as a JPEG first. */

const READABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** 5 MB is the reader's limit once the page is sent as base64 (a third bigger), so 3.5 MB of image at most. */
const MAX_BYTES = 3_500_000;

export const needsJpeg = (type: string, size: number): boolean => !READABLE.has(type) || size > MAX_BYTES;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The page's file name: the picked file's name, its page number, and the extension of the type it is sent as. */
export const pageFileName = (fileName: string, pageNo: number, type: string): string =>
  `${fileName.replace(/\.[^.]+$/, '')}-p${pageNo}.${EXT[type] ?? 'jpg'}`;
