/** Proof photos and videos. Images keep kind 'photo' (what every photo count reads); videos are kind 'video'. */
export const IMAGE_MAX = 15 * 1024 * 1024;
export const VIDEO_MAX = 50 * 1024 * 1024;

/** The document kind for an upload, or the user-safe refusal. */
export function mediaKind(file: File): { kind: 'photo' | 'video' } | { error: string } {
  const type = file.type || '';
  if (type.startsWith('image/')) return file.size > IMAGE_MAX ? { error: 'That photo is too large (15 MB limit).' } : { kind: 'photo' };
  if (type.startsWith('video/')) return file.size > VIDEO_MAX ? { error: 'That video is too large (50 MB limit). Record a shorter clip.' } : { kind: 'video' };
  return { error: 'Only photos and videos can be attached.' };
}

/** A cleaning job's photo or video is Before (how the unit was found, optional) or After (proof of work, needed to
 *  complete). The stage is kept in the file name, as maintenance does; a file with no prefix predates stages and is
 *  After, since it was uploaded as proof. */
export type CleanStage = 'before' | 'after';
export const cleanStage = (fileName: string | null | undefined): CleanStage => (String(fileName ?? '').startsWith('before-') ? 'before' : 'after');
/** SQL condition: the document `d` is an After (proof) file. */
export const AFTER_FILE_SQL = (d = 'd') => `${d}.file_name NOT LIKE 'before-%'`;
