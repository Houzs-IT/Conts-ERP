/* The photos a document keeps in scm.doc_attachments, for its PDF (owner, 4 Nov 2026: every SO, PO, DO and GR prints
   its photos). One loader for the four generators, so they print the same things in the same order: each line's own
   images and those it shows from the line upstream (a PO line shows its SO line's), then the whole document's, then
   a delivery's proof-of-delivery or a goods receipt's proof-of-receipt photos. Videos and PDFs do not print.

   Best effort like every photo on a printed document: a document whose list cannot be read prints without them. */

import type { DocFile, DocType } from '../../../components/doc-attachments/docAttachmentsApi';
import type { PhotoGroup } from './pdf-item-photos';

/* An attachment as a photo key of its own, so it joins the same ITEM PHOTOS groups as photo_urls. */
const ATTACHMENT_KEY = 'attachment:';
const attachmentKey = (f: DocFile) => `${ATTACHMENT_KEY}${f.id}`;

export const isAttachmentKey = (key: string): boolean => key.startsWith(ATTACHMENT_KEY);

export interface DocPdfPhotos {
  /** The line's images as photo keys, or none. */
  lineKeys: (lineId: string | null | undefined) => string[];
  /** Groups for the photos on no line; they print after the item groups. */
  documentGroups: PhotoGroup[];
  /** The bytes of a key from lineKeys or documentGroups. */
  fetch: (key: string) => Promise<Blob>;
}

const NONE: DocPdfPhotos = {
  lineKeys: () => [],
  documentGroups: [],
  fetch: () => Promise.reject(new Error('no_document')),
};

export async function loadDocPdfPhotos(type: DocType, id: string | null | undefined): Promise<DocPdfPhotos> {
  if (!id) return NONE;
  try {
    const { fetchDocFileBlob, listDocFiles } = await import('../../../components/doc-attachments/docAttachmentsApi');
    const r = await listDocFiles(type, id);
    const byLine = new Map<string, string[]>();
    for (const line of r.lines ?? []) {
      const keys = line.files.filter((f) => f.kind === 'image').map(attachmentKey);
      if (keys.length) byLine.set(line.id, keys);
    }
    const images = (r.files ?? []).filter((f) => f.kind === 'image');
    const group = (chip: string, files: DocFile[]): PhotoGroup[] =>
      files.length ? [{ chip, code: '', photoKeys: files.map(attachmentKey), document: true }] : [];
    return {
      lineKeys: (lineId) => byLine.get(lineId ?? '') ?? [],
      documentGroups: [
        ...group('Document', images.filter((f) => f.source !== 'pod')),
        ...group(type === 'goods_received' ? 'Proof of receipt' : 'Proof of delivery', images.filter((f) => f.source === 'pod')),
      ],
      fetch: (key) => fetchDocFileBlob(type, id, key.slice(ATTACHMENT_KEY.length)),
    };
  } catch {
    return NONE;
  }
}
