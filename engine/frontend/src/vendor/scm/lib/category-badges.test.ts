/* The line-card and list pill for a Sofa Accessory line (owner 2026-09-15:
   HC-SO-2609-071's pillow lines showed OTHERS). */
import { describe, expect, it } from 'vitest';

import { badgeFor, CATEGORY_BADGE } from './category-badges';

describe('category badges', () => {
  it('names a Sofa Accessory line SOFA ACCESSORY, not OTHERS', () => {
    expect(badgeFor('fabric_accessory').label).toBe('SOFA ACCESSORY');
    expect(badgeFor('FABRIC_ACCESSORY').label).toBe('SOFA ACCESSORY');
  });

  it('gives it the sofa swatch it rides with', () => {
    expect(badgeFor('fabric_accessory').bg).toBe(CATEGORY_BADGE.sofa!.bg);
  });

  it('names a group it has no swatch for, in the OTHERS colours, and says OTHERS for no group', () => {
    expect(badgeFor('dining').label).toBe('DINING');
    expect(badgeFor('dining').bg).toBe(badgeFor(null).bg);
    expect(badgeFor(null).label).toBe('OTHERS');
  });
});
