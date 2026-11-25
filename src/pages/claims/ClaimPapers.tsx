import { useEffect, useMemo } from 'react';
import { MediaGallery, type MediaItem } from '../../components/Attachments';
import type { ClaimFile } from '../../lib/claims';

const PICKED_ID_PREFIX = 'picked-';

export const claimFileItem = (file: ClaimFile, hrefOf: (fileId: string) => string): MediaItem => ({
  id: file.id, kind: file.mime === 'application/pdf' ? 'pdf' : 'image', url: hrefOf(file.id), fileName: file.fileName, mimeType: file.mime,
});

export function ClaimPapers({ saved, hrefOf, picked, onRemoveSaved, onRemovePicked }: {
  saved: ClaimFile[]; hrefOf: (fileId: string) => string; picked: File[];
  onRemoveSaved?: (fileId: string) => void; onRemovePicked?: (index: number) => void;
}) {
  const pickedItems = useMemo<MediaItem[]>(() => picked.map((file, index) => ({
    id: `${PICKED_ID_PREFIX}${index}`, kind: file.type === 'application/pdf' ? 'pdf' : 'image', url: URL.createObjectURL(file), fileName: file.name, mimeType: file.type,
  })), [picked]);
  useEffect(() => () => pickedItems.forEach(item => URL.revokeObjectURL(item.url)), [pickedItems]);

  const items = [...saved.map(file => claimFileItem(file, hrefOf)), ...pickedItems];
  if (!items.length) return null;
  const canRemove = !!(onRemoveSaved || onRemovePicked);
  return (
    <MediaGallery items={items}
      onRemove={canRemove ? item => (item.id.startsWith(PICKED_ID_PREFIX) ? onRemovePicked?.(Number(item.id.slice(PICKED_ID_PREFIX.length))) : onRemoveSaved?.(item.id)) : undefined} />
  );
}
