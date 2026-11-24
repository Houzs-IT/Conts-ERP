import { describe, expect, it } from 'vitest';
import { projectCustomerHeading } from './projectCustomerHeading';

describe('projectCustomerHeading', () => {
  it('names the project and its customer', () => {
    expect(projectCustomerHeading('QUAVER RESIDENCE A-17-12', 'MR AMIN')).toBe('QUAVER RESIDENCE A-17-12 - MR AMIN');
  });
  it('keeps the project alone when there is no customer', () => {
    expect(projectCustomerHeading('QUAVER RESIDENCE A-17-12', '  ')).toBe('QUAVER RESIDENCE A-17-12');
  });
  it('groups lines without a project by customer', () => {
    expect(projectCustomerHeading(null, 'MR TAN')).toBe('No project - MR TAN');
    expect(projectCustomerHeading('', 'MS LIM')).not.toBe(projectCustomerHeading('', 'MR TAN'));
  });
  it('has one heading for lines with neither', () => {
    expect(projectCustomerHeading(undefined, null)).toBe('No project, no customer');
  });
});
