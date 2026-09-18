import { type Env, all, json } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');
  const readiness = url.searchParams.get('readiness');

  // Owners are scoped server-side. A mismatched id is never a silent empty list.
  const ownerScope = session.role === 'owner'
    ? 'AND o.user_id = ?' : '';
  const args: unknown[] = [];
  if (propertyId) args.push(propertyId);
  if (readiness) args.push(readiness);
  if (session.role === 'owner') args.push(session.userId);

  const rows = await all(env, `
    SELECT u.id, u.unit_number, u.readiness, u.base_rate, u.is_listed, u.bedrooms, u.bathrooms, u.max_guests,
           p.id AS property_id, p.name AS property_name, p.city, p.state,
           o.id AS owner_id, o.display_name AS owner_name
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    WHERE 1 = 1
      ${propertyId ? 'AND u.property_id = ?' : ''}
      ${readiness ? 'AND u.readiness = ?' : ''}
      ${ownerScope}
    ORDER BY p.state, p.name, u.unit_number
  `, ...args);

  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r: any) => ({
      id: r.id, unitNumber: r.unit_number, readiness: r.readiness,
      propertyId: r.property_id, propertyName: r.property_name, city: r.city, state: r.state,
      ownerId: r.owner_id, ownerName: r.owner_name,
      bedrooms: r.bedrooms, bathrooms: r.bathrooms, maxGuests: r.max_guests,
      isListed: !!r.is_listed,
      // baseRate is integer sen. Field roles never receive money at all.
      ...(canSeeFinance(session.role) ? { baseRate: r.base_rate } : {}),
    })),
  });
};
