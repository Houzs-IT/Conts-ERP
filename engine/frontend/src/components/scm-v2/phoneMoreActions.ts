/* The "..." in a document page's phone header (click sweep 2, G11). It had no handler, so on a phone there was no Cancel
   DO, Undo load, Cancel PO, Raise amendment or Send to supplier. It now opens the page's own action header, the one a
   desktop shows, under the phone header: one set of actions, so the two widths cannot drift apart. */

/** The page's action header: always on from md up, on a phone only while the "..." is open (and not sticky there, so it
    does not hide under the phone header). */
export const phoneMoreHeaderClass = (phoneOpen: boolean): string =>
  `${phoneOpen ? "block" : "hidden"} -mx-4 border-b border-border bg-bg/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 md:sticky md:top-0 md:z-10 md:block`;

/** A 44 px tap target around the 18 px icon. */
export const PHONE_MORE_BUTTON = "-mr-3 inline-flex h-11 w-11 items-center justify-center text-sidebar-ink-muted";
