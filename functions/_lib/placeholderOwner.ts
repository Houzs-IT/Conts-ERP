import { PLACEHOLDER_OWNER } from './hostplatformImport';

// units.owner_id is NOT NULL, so a unit with no known owner sits here. Statement runs skip it by name: never rename it.
export const PLACEHOLDER_OWNER_ID = 'hp-owner-to-be-confirmed';

export const isPlaceholderOwner = (name: string | null | undefined): boolean => (name ?? '').toLowerCase() === PLACEHOLDER_OWNER.toLowerCase();

export interface OwnerDb {
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]>;
  run(sql: string, ...args: unknown[]): Promise<void>;
}

export async function placeholderOwnerId(db: OwnerDb, now: string): Promise<string> {
  const [hit] = await db.all<{ id: string }>('SELECT id FROM owners WHERE lower(display_name) = lower(?) ORDER BY created_at LIMIT 1', PLACEHOLDER_OWNER);
  if (hit) return hit.id;
  await db.run('INSERT INTO owners (id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    PLACEHOLDER_OWNER_ID, PLACEHOLDER_OWNER, '', now, now);
  return PLACEHOLDER_OWNER_ID;
}
