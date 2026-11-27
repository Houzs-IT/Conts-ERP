import { describe, expect, it } from 'vitest';
import { resolveCreatorStaffId } from './salesScope';

const SYSTEM_STAFF_ID = '00000000-0000-4000-8000-000000000001';

interface StaffRow {
  id: string;
  user_id: number;
}

function fakeStaffClient(staffRows: StaffRow[]): unknown {
  return {
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: number) => ({
          maybeSingle: async () => ({ data: staffRows.find((row) => row.user_id === userId) ?? null, error: null }),
        }),
      }),
    }),
  };
}

describe('resolveCreatorStaffId', () => {
  const staffClient = fakeStaffClient([{ id: 'staff-ali', user_id: 42 }]);

  it('stamps the signed-in person, not the bridge system account', async () => {
    expect(await resolveCreatorStaffId(staffClient, 42, SYSTEM_STAFF_ID)).toBe('staff-ali');
  });

  it('falls back to the system account when the person has no staff row', async () => {
    expect(await resolveCreatorStaffId(staffClient, 7, SYSTEM_STAFF_ID)).toBe(SYSTEM_STAFF_ID);
  });

  it('falls back to the system account on the headless agent path', async () => {
    expect(await resolveCreatorStaffId(staffClient, undefined, SYSTEM_STAFF_ID)).toBe(SYSTEM_STAFF_ID);
  });
});
