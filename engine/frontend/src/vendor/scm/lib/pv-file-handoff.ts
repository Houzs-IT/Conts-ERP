// ----------------------------------------------------------------------------
// pv-file-handoff — carries the scan page's bill bytes to the New voucher page
// WITHOUT riding location.state: history.pushState serializes its state and
// browsers cap an entry around 16MB, so a scanned multi-page PDF could make
// the navigation itself throw. Module memory instead — same SPA session, same
// durability as router state (both die on a refresh), no size cap.
//
// take() CLEARS, so a stale pile can never attach to an unrelated voucher; a
// caller must therefore only setState when it actually took something (which
// also keeps a double-run effect from wiping the first take's result).
// ----------------------------------------------------------------------------

import type { PvFilePayload } from './payment-voucher-queries';

let stash: PvFilePayload[] = [];

export const stashPvFiles = (files: PvFilePayload[]): void => { stash = files; };

export const takePvFiles = (): PvFilePayload[] => {
  const taken = stash;
  stash = [];
  return taken;
};

/** A carried page back to a File, for the document-attachment upload (the
 *  purchase invoice keeps scanned pages as ordinary attachments). */
export const pvFileToFile = (f: PvFilePayload): File => {
  const bin = atob(f.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mime });
};
