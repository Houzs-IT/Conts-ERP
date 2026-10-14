import { describe, expect, test } from 'vitest';
import {
  cleanRoomName,
  cleanRoomSections,
  missingRoomSections,
  roomsWithLineRooms,
  parseCount,
  parseSqft,
  readPropertyInput,
  renoSoRequiredProblems,
  roomSectionHeadings,
  siteAddressFromSo,
  soAddressFromSite,
  soOpenForProjectSync,
} from './renovation-property';

describe('reading the property fields', () => {
  test('counts are whole numbers 0..20, blank is null', () => {
    expect(parseCount('')).toBeNull();
    expect(parseCount(null)).toBeNull();
    expect(parseCount('3')).toBe(3);
    expect(parseCount(0)).toBe(0);
    expect(parseCount('2.5')).toBeNaN();
    expect(parseCount('-1')).toBeNaN();
    expect(parseCount('21')).toBeNaN();
  });

  test('square feet takes commas and 2 decimals, refuses zero and words', () => {
    expect(parseSqft('1,250')).toBe(1250);
    expect(parseSqft('980.5')).toBe(980.5);
    expect(parseSqft(' ')).toBeNull();
    expect(parseSqft('0')).toBeNaN();
    expect(parseSqft('12.345')).toBeNaN();
    expect(parseSqft('big')).toBeNaN();
  });

  test('invalid values come back as problems and as null', () => {
    const r = readPropertyInput({ propertyType: ' Condo ', layoutLabel: '3 bed 2 bath', bedrooms: '3', bathrooms: 'x', builtUpSqft: '-5' });
    expect(r.value).toEqual({ propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: null, builtUpSqft: null });
    expect(r.problems.map((p) => p.code)).toEqual(['bathrooms_invalid', 'sqft_invalid']);
  });
});

describe('what a renovation SO must have', () => {
  const full = {
    customerName: 'Tan Ah Kow', phone: '+60123456789', address1: 'A-12-3 Skyline Residence',
    property: { propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: 2, builtUpSqft: 1100 },
  };

  test('a complete order has no problems; zero bedrooms (studio) counts as given', () => {
    expect(renoSoRequiredProblems(full)).toEqual([]);
    expect(renoSoRequiredProblems({ ...full, property: { ...full.property, bedrooms: 0 } })).toEqual([]);
  });

  test('every missing field is named, in form order', () => {
    const p = renoSoRequiredProblems({
      customerName: ' ', phone: '', address1: '',
      property: { propertyType: '', layoutLabel: '', bedrooms: null, bathrooms: null, builtUpSqft: null },
    });
    expect(p.map((x) => x.field)).toEqual(['Customer name', 'Phone number', 'Delivery address', 'Property type', 'Layout', 'Built-up sq ft']);
  });

  test('a layout label without its counts is not a layout', () => {
    const p = renoSoRequiredProblems({ ...full, property: { ...full.property, bathrooms: null } });
    expect(p.map((x) => x.field)).toEqual(['Layout']);
  });
});

describe('the address moves between the SO lines and the project site address', () => {
  test('two lines join with a newline and split back', () => {
    const site = siteAddressFromSo('A-12-3 Skyline Residence', 'Jalan Ampang');
    expect(site).toBe('A-12-3 Skyline Residence\nJalan Ampang');
    expect(soAddressFromSite(site)).toEqual({ address1: 'A-12-3 Skyline Residence', address2: 'Jalan Ampang' });
  });

  test('blank lines drop; extra lines fold into line 2', () => {
    expect(siteAddressFromSo('  ', 'Only line')).toBe('Only line');
    expect(soAddressFromSite('One\n\nTwo\nThree')).toEqual({ address1: 'One', address2: 'Two, Three' });
    expect(soAddressFromSite(null)).toEqual({ address1: '', address2: '' });
  });
});

describe('which linked SOs a project edit may still change', () => {
  test('only a standard order in draft or confirmed that has not been proceeded', () => {
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'DRAFT' })).toBe(true);
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'CONFIRMED', processing_date: null })).toBe(true);
    expect(soOpenForProjectSync({ so_kind: null, status: 'CONFIRMED' })).toBe(true);
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'CONFIRMED', processing_date: '2026-10-20' })).toBe(false);
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'CONFIRMED', proceeded_at: '2026-10-14T01:00:00Z' })).toBe(false);
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'DELIVERED' })).toBe(false);
    expect(soOpenForProjectSync({ so_kind: 'STANDARD', status: 'CANCELLED' })).toBe(false);
    expect(soOpenForProjectSync({ so_kind: 'RENOVATION', status: 'RENO_CONFIRMED' })).toBe(false);
  });
});

describe('room sections from a layout', () => {
  test('living hall first, bedrooms, bathrooms, common area last', () => {
    expect(roomSectionHeadings(3, 2)).toEqual(['Living hall', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bathroom 1', 'Bathroom 2', 'Common area']);
    expect(roomSectionHeadings(0, 1)).toEqual(['Living hall', 'Bathroom 1', 'Common area']);
  });

  test('sections already there (any case or spacing) are not added again; order is kept', () => {
    expect(missingRoomSections(['LIVING HALL', 'bedroom  2', 'Kitchen'], 2, 1)).toEqual(['Bedroom 1', 'Bathroom 1', 'Common area']);
    expect(missingRoomSections(roomSectionHeadings(2, 2), 2, 2)).toEqual([]);
  });
});

describe('rooms stored on a renovation SO', () => {
  test('names are trimmed to single spaces; blanks and repeats (any case) drop; order kept', () => {
    expect(cleanRoomSections([' Living  hall ', 'Bedroom 1', 'living hall', '', 7, 'Common area'])).toEqual(['Living hall', 'Bedroom 1', 'Common area']);
    expect(cleanRoomSections('Living hall')).toEqual([]);
    expect(cleanRoomName(null)).toBe('');
    expect(cleanRoomName('x'.repeat(100))).toHaveLength(80);
  });

  test('at most 60 rooms', () => {
    expect(cleanRoomSections(Array.from({ length: 70 }, (_, i) => `Room ${i}`))).toHaveLength(60);
  });

  test('a room a line names joins the list after the known ones', () => {
    expect(roomsWithLineRooms(['Living hall'], ['', 'Kitchen', 'living hall'])).toEqual(['Living hall', 'Kitchen']);
  });
});
