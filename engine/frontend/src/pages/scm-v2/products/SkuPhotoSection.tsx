/* Photos of one SKU inside its drawer. Works and Service SKUs do not use
   photos; for the other groups a photo is optional (owner, 20 Oct 2026). */
import { PhotoGallery } from '../../../components/scm-v2/PhotoGallery';
import { isCatalogGroup, categoryGroupOf } from '../../../vendor/shared/renovation-catalog';

export function SkuPhotoSection({ productId, productName, category }: {
  productId: string;
  productName: string;
  category: string;
}) {
  const group = categoryGroupOf(category);
  if (group && isCatalogGroup(group) && (group === 'WORKS' || group === 'SERVICE')) {
    return <p className="text-[12px] text-ink-secondary">Photos are not used for {group === 'WORKS' ? 'Works' : 'Service'} SKUs.</p>;
  }
  return (
    <div className="space-y-2">
      <PhotoGallery productId={productId} productName={productName} />
    </div>
  );
}
