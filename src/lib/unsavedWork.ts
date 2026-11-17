import { useEffect } from 'react';

/** Forms holding typing that is not saved yet: an edited dialog (Modal.tsx DialogFrame), a drawer told it is dirty
 *  (Dialog.tsx Drawer), a page form with a leave guard (useLeaveGuard). A tab that meets a deploy (main.tsx) reloads by
 *  itself only when none is held; otherwise it asks the person to save first (UpdateNotice.tsx). */
const held = new Set<symbol>();

/** Marks one form as holding unsaved work; call the returned function when it is saved, closed or gone. */
export function holdUnsavedWork(): () => void {
  const token = Symbol('unsaved');
  held.add(token);
  return () => { held.delete(token); };
}

export const hasUnsavedWork = (): boolean => held.size > 0;

/** Holds unsaved work while `dirty` is true. */
export function useUnsavedWork(dirty: boolean): void {
  useEffect(() => (dirty ? holdUnsavedWork() : undefined), [dirty]);
}

/** Fired when a newer version is out and this tab should reload once its work is saved. */
export const NEW_VERSION_EVENT = 'conts:new-version';
