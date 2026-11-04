import type { Bay, Bed } from './shared';

/** What the Add unit page checks before each step's Next, kept apart from the page so it can be tested without a browser. */

export const STEPS = ['Listing', 'Type and size', 'Contract'] as const;
export type StepIndex = 0 | 1 | 2;
/** The step nearest to n, so a step number worked out in code is always one of the three. */
export const stepAt = (n: number): StepIndex => (n <= 0 ? 0 : n >= 2 ? 2 : 1);

export interface AddUnitForm {
  ownerId: string; listingName: string; unitCode: string; buildingId: string; address: string;
  purpose: string; usedBy: string;
  layoutType: string; bedrooms: number | null; bathrooms: number | null; sizeSqft: number | null;
  beds: Bed[]; parkingBays: Bay[];
}

export const EMPTY_FORM: AddUnitForm = {
  ownerId: '', listingName: '', unitCode: '', buildingId: '', address: '', purpose: '', usedBy: '',
  layoutType: '', bedrooms: null, bathrooms: null, sizeSqft: null, beds: [], parkingBays: [],
};

/** Problems with a step's own boxes, by field name. Empty: Next is open. The contract step is checked by the page (it needs the contract form). */
export function stepProblems(step: StepIndex, f: AddUnitForm): Record<string, string> {
  const p: Record<string, string> = {};
  if (step === 0) {
    if (!f.listingName.trim()) p.listingName = 'Enter the listing name.';
    if (!f.unitCode.trim()) p.unitCode = 'Enter the unit code.';
    if (!f.buildingId) p.buildingId = 'Pick a building.';
    if (!f.purpose) p.purpose = 'Pick what the unit is for.';
  }
  if (step === 1 && f.parkingBays.some(b => !b.lotNumber.trim())) p.parkingBays = 'Enter the lot number of every bay, or remove the bay.';
  return p;
}

/** The step a field of the unit sits on, so a refused save can send the person back to it. */
export function stepOfField(field: string): StepIndex {
  return ['layoutType', 'bedrooms', 'bathrooms', 'sizeSqft', 'beds', 'parkingBays'].includes(field) ? 1 : 0;
}

/** The Type to save: the one picked, else the one the bedrooms suggest, but only when it is still offered. */
export function layoutToSave(picked: string, suggested: string | null, offered: readonly string[]): string | null {
  if (picked) return picked;
  return suggested && offered.includes(suggested) ? suggested : null;
}

const isFormKey = (k: string): k is keyof AddUnitForm => k in EMPTY_FORM;

/** Whether the person has typed anything worth asking about before leaving (the building alone, often from the link, is not). */
export function hasInput(f: AddUnitForm, contractTouched: boolean): boolean {
  return contractTouched || Object.keys(EMPTY_FORM).some(k => isFormKey(k) && k !== 'buildingId' && JSON.stringify(f[k]) !== JSON.stringify(EMPTY_FORM[k]));
}
