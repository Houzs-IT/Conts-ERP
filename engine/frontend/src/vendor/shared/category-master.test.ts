import { afterEach, describe, expect, it } from 'vitest';
import { allMfgCategories, mfgCategoryLabel, parseMfgCategory, rememberCategories } from './product-categories';
import { categoriesInGroup, categoryGroupOf, categoryMatches, isCatalogGroup, rememberSubCategories, SUB_CATEGORIES, subCategoryLabelOf, validateCategoryPair } from './renovation-catalog';
import { badgeFor } from '../scm/lib/category-badges';
import { rowBelongsToView, mrpGroupViews } from '../../pages/scm-v2/mrp-views';

afterEach(() => { rememberCategories([]); rememberSubCategories(SUB_CATEGORIES); });

describe('a category added in the master list needs no code change', () => {
  it('reads as a category everywhere once the list is loaded', () => {
    expect(categoryGroupOf('CURT')).toBeNull();
    rememberCategories([{ code: 'CURT', label: 'Curtains' }]);
    expect(categoryGroupOf('CURT')).toBe('CURT');
    expect(isCatalogGroup('CURT')).toBe(true);
    expect(mfgCategoryLabel('curt')).toBe('Curtains');
    expect(allMfgCategories()).toContain('CURT');
    expect(badgeFor('CURT').label).toBe('CURTAINS');
  });

  it('lands on its own MRP tab, not in Others', () => {
    rememberCategories([{ code: 'CURT', label: 'Curtains' }]);
    const views = mrpGroupViews([{ code: 'CURT', label: 'Curtains' }]);
    expect(rowBelongsToView(views[0]!, 'CURT')).toBe(true);
    expect(rowBelongsToView(views[1]!, 'CURT')).toBe(false);
  });

  it('shows words, never OTHERS or a raw code, before the list has loaded', () => {
    expect(mfgCategoryLabel('CURTAIN_WORK')).toBe('Curtain work');
    expect(badgeFor('RAW').label).toBe('RAW MATERIAL');
    expect(badgeFor('CURTAIN_WORK').label).toBe('CURTAIN WORK');
    expect(badgeFor(null).label).toBe('OTHERS');
  });

  it('is accepted by the save rules and an import sheet when the route passes the list', () => {
    expect(validateCategoryPair('CURT', null).ok).toBe(false);
    expect(validateCategoryPair('CURT', null, undefined, ['CURT']).ok).toBe(true);
    const live = [{ code: 'CURT', label: 'Curtains' }];
    expect(parseMfgCategory('curtains', live)).toBe('CURT');
    expect(parseMfgCategory('curt', live)).toBe('CURT');
    expect(parseMfgCategory('nonsense', live)).toBeNull();
  });
});

describe('a filter on a group covers its legacy categories', () => {
  it('Furniture includes what is still stored as Sofa, Bedframe and Mattress', () => {
    expect(categoriesInGroup('FURNITURE')).toEqual(expect.arrayContaining(['FURNITURE', 'SOFA', 'BEDFRAME', 'MATTRESS']));
    expect(categoryMatches('SOFA', 'FURNITURE')).toBe(true);
    expect(categoryMatches('WORKS', 'FURNITURE')).toBe(false);
  });
  it('a single category stays itself, so a legacy filter is unchanged', () => {
    expect(categoriesInGroup('SOFA')).toEqual(['SOFA']);
    expect(categoryMatches('SOFA', 'SOFA')).toBe(true);
    expect(categoryMatches('BEDFRAME', 'SOFA')).toBe(false);
  });
});

describe('a sub-category added in settings', () => {
  it('prints under its saved name', () => {
    expect(subCategoryLabelOf('SOFT', 'CURTAIN_INSTALL')).toBe('CURTAIN INSTALL');
    rememberSubCategories([{ group: 'SOFT', code: 'CURTAIN_INSTALL', label: 'Curtain install', sort: 10 }]);
    expect(subCategoryLabelOf('SOFT', 'CURTAIN_INSTALL')).toBe('Curtain install');
  });
});
