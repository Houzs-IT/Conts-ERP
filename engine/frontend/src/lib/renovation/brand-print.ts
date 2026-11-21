/* The letterhead a customer document prints under: the brand it carries (owner, 10 Nov 2026), so a delivery order
   and an invoice look like the contract they follow. Null when the document has no brand or the brand is unknown,
   and the print keeps the company letterhead. Never throws: a PDF must not fail over a logo. */

import type { BrandingLogo } from '../branding';
import { ensureBrandLogoLoaded, getBrandingCache, getBrandLogoCache } from '../branding';
import { renoGet, type BrandProfile } from './api';

/** bankLine: where the brand's customers pay (SO Maintenance › brand, as its contract prints it); '' when unset. */
export interface BrandPrint { name: string; logo: BrandingLogo | null; lines: string[]; bankLine?: string }

/** "Where to pay" on a paper that asks a customer for money: the brand's own bank line when the document carries a
 *  brand that has one, else the company's customer payment details (Settings › Branding). Blank prints nothing. */
export function customerPaymentText(brand: BrandPrint | null | undefined): string {
  return brand?.bankLine?.trim() || getBrandingCache().customerPaymentDetails;
}

let brandsOnce: Promise<BrandProfile[]> | null = null;

export async function brandPrintFor(branding: string | null | undefined): Promise<BrandPrint | null> {
  const want = String(branding ?? '').trim().toLowerCase();
  if (!want) return null;
  try {
    brandsOnce ??= renoGet<{ brands: BrandProfile[] }>('/brands').then((r) => r.brands).catch(() => { brandsOnce = null; return []; });
    const brand = (await brandsOnce).find((b) => b.name.trim().toLowerCase() === want);
    if (!brand) return null;
    if (brand.logoR2Key) await ensureBrandLogoLoaded(brand.logoR2Key);
    return { name: brand.name, logo: getBrandLogoCache(brand.logoR2Key), lines: brand.companyLines.filter(Boolean), bankLine: brand.bankLine };
  } catch {
    return null;
  }
}
