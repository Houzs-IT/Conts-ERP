import { describe, it, expect } from 'vitest';
import { isHyperdriveUrl } from '../src/db/pg';

describe('isHyperdriveUrl', () => {
  it('detects the old and the new Hyperdrive binding hosts', () => {
    expect(isHyperdriveUrl('postgresql://u:PASSWORD@abc.hyperdrive.local:5432/postgres')).toBe(true);
    expect(isHyperdriveUrl('postgresql://u:PASSWORD@0123abcd.workers.alt:5432/postgres')).toBe(true);
  });

  it('does not take a direct Supabase host for Hyperdrive', () => {
    expect(isHyperdriveUrl('postgresql://postgres.ref:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres')).toBe(false);
    expect(isHyperdriveUrl('postgresql://postgres:PASSWORD@db.ref.supabase.co:5432/postgres')).toBe(false);
  });
});
