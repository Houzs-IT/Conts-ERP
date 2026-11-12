/** This build's id (an ISO time), written into index.html by vite.config.ts as <meta name="conts-build-id">. Read from
 *  the page, never compiled into a script: a value that changes every build, inside a chunk, changed that chunk's
 *  name and the name of every chunk that imports it, so each deploy renamed files open tabs still asked for, even when
 *  their code had not changed (Houzs c9ad7527a). Empty in a page without the tag (tests). */
export const BUILD_ID: string =
  (typeof document !== 'undefined' && document.querySelector<HTMLMetaElement>('meta[name="conts-build-id"]')?.content) || '';
