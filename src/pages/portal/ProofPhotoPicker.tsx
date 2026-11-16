import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import Icon from '../../components/Icon';
import { color, radius, text } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import { MAX_PROOF_PHOTOS, shrinkPhoto } from '../../lib/renoJobs';

export interface ProofPhoto {
  id: string;
  file: File;
  url: string;
}

export interface ProofPhotos {
  photos: ProofPhoto[];
  isPreparing: boolean;
  add: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  remove: (id: string) => void;
}

export interface ProofPhotoPickerProps {
  proofPhotos: ProofPhotos;
  heading: string;
  hint: string;
  isSaving: boolean;
}

const PHOTO_TILE: CSSProperties = {
  width: 64, height: 64, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.control,
  border: `1px dashed ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0, fontSize: text.meta, fontWeight: 600, boxSizing: 'border-box',
};

export function useProofPhotos(): ProofPhotos {
  const [photos, setPhotos] = useState<ProofPhoto[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const photosRef = useRef<ProofPhoto[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => () => { photosRef.current.forEach(photo => URL.revokeObjectURL(photo.url)); }, []);

  const add = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.target;
    const chosen = [...(input.files ?? [])].filter(file => file.type.startsWith('image/') || file.type === '').slice(0, MAX_PROOF_PHOTOS - photos.length);
    input.value = '';
    if (chosen.length === 0) return;
    setIsPreparing(true);
    try {
      const shrunk = await Promise.all(chosen.map(shrinkPhoto));
      const added = shrunk.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
      setPhotos(current => [...current, ...added].slice(0, MAX_PROOF_PHOTOS));
    } finally {
      setIsPreparing(false);
    }
  };

  const remove = (id: string): void => {
    const gone = photos.find(photo => photo.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    setPhotos(current => current.filter(photo => photo.id !== id));
  };

  return { photos, isPreparing, add, remove };
}

export default function ProofPhotoPicker({ proofPhotos, heading, hint, isSaving }: ProofPhotoPickerProps) {
  const t = usePortalText().renoJobs;
  const { photos, isPreparing, add, remove } = proofPhotos;
  const isBusy = isSaving || isPreparing;
  const isFull = photos.length >= MAX_PROOF_PHOTOS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink }}>{heading}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {photos.map((photo, index) => (
          <div key={photo.id} style={{ width: 64, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <img src={photo.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: radius.control, display: 'block' }} />
            <button type="button" aria-label={t.removePhoto(index + 1)} disabled={isSaving} onClick={() => remove(photo.id)}
              style={{ width: 64, height: 44, display: 'grid', placeItems: 'center', borderRadius: radius.control, border: `1px solid ${color.borderStrong}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0 }}>
              <Icon name="X" size="nav" />
            </button>
          </div>
        ))}
        {!isFull && (
          <>
            <label style={{ ...PHOTO_TILE, opacity: isBusy ? 0.5 : 1 }}>
              <Icon name="Camera" size="nav" />
              <span>{t.takePhoto}</span>
              <input type="file" accept="image/*" capture="environment" multiple disabled={isBusy} onChange={event => void add(event)} style={{ display: 'none' }} />
            </label>
            <label style={{ ...PHOTO_TILE, opacity: isBusy ? 0.5 : 1 }}>
              <Icon name="Images" size="nav" />
              <span>{t.fromGallery}</span>
              <input type="file" accept="image/*" multiple disabled={isBusy} onChange={event => void add(event)} style={{ display: 'none' }} />
            </label>
          </>
        )}
      </div>
      <span style={{ fontSize: text.copy, color: color.textMuted }}>
        {isPreparing ? t.preparing : isFull ? t.maxPhotos(MAX_PROOF_PHOTOS) : photos.length === 0 ? hint : t.photos(photos.length)}
      </span>
    </div>
  );
}
