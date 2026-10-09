/* Photos of one SKU inside its drawer. Works and Service SKUs do not use
   photos; the five photo groups need one before the SKU can be active, so the
   section says so above the gallery. */
import { PhotoGallery } from '../../../components/scm-v2/PhotoGallery';
import { isPhotoRequiredCategory, isCatalogGroup, categoryGroupOf } from '../../../vendor/shared/renovation-catalog';

export function SkuPhotoSection({ productId, productName, category, photoCount }: {
  productId: string;
  productName: string;
  category: string;
  photoCount: number;
}) {
  const group = categoryGroupOf(category);
  if (group && isCatalogGroup(group) && (group === 'WORKS' || group === 'SERVICE')) {
    return <p className="text-[12px] text-ink-secondary">Photos are not used for {group === 'WORKS' ? 'Works' : 'Service'} SKUs.</p>;
  }
  return (
    <div className="space-y-2">
      {isPhotoRequiredCategory(category) && photoCount === 0 && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Add a photo to make this SKU active. The first photo becomes the primary photo used on quotations.
        </p>
      )}
      <PhotoGallery productId={productId} productName={productName} />
    </div>
  );
}
