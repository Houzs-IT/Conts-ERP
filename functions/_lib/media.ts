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
