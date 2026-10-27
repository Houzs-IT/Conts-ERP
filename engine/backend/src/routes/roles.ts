import { Hono } from "hono";
import type { Env } from "../types";
import { PERMISSIONS, isValidPermission, parsePermissions, droppedPermissions } from "../services/permissions";
import { requirePermission, requirePermissionOrSalesDirector } from "../middleware/auth";
import { audit } from "../services/audit";
import { getDb } from "../db/client";
import { roles, users } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { isMissingRelation, type Db } from "../services/renovation/load";
import {
  cleanCategoryAccess, loadCategoryTree, loadKnownCategories, readCategoryRows, rowsOfInput, scopeOfRows, unknownCategory,
  type CategoryScope,
} from "../services/categoryAccess";

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/roles/permissions
 * Returns the permission catalog so the frontend can render the
 * permission picker. Anyone with roles.read can see this.
 */
app.get("/permissions", requirePermission("roles.read"), async (c) => {
  return c.json({ permissions: PERMISSIONS });
});

/**
 * GET /api/roles
 * Returns all roles + their permission arrays + member counts.
 *
 * Admitted for a Sales Director too (READ-ONLY, additive on top of roles.read):
 * the Team member-invite / edit forms render a Role picker sourced from this
 * list, and a dept-scoped Sales Director has no roles.read in the matrix
 * (positions get no backfill) so it 403'd — breaking the mobile Member form.
 * Roles are a global, non-sensitive lookup; the WRITE routes below stay
 * roles.manage-only, and a scoped invite/patch forces a baseline role
 * server-side (routes/users.ts) regardless of what the picker sends.
 */
app.get("/", requirePermissionOrSalesDirector("roles.read"), async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      permissions: roles.permissions,
      is_system: roles.is_system,
      scope_to_pic: roles.scope_to_pic,
      created_at: roles.created_at,
      // Subquery for the member count keeps this single-round-trip.
      member_count: sql<number>`(SELECT COUNT(*) FROM ${users} WHERE ${users.role_id} = ${roles.id})`,
    })
    .from(roles)
    .orderBy(sql`${roles.is_system} DESC`, roles.name);

  return c.json({
    roles: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: parsePermissions(r.permissions),
      // The other half of the same answer. parsePermissions DISCARDS any stored
      // key this build does not declare, so a role row can carry keys that
      // decide nothing and the list looked identical to a clean one. Surfaced
      // here because Team > Roles is the one place a human looks at a role.
      unknown_permissions: droppedPermissions(r.permissions),
      is_system: !!r.is_system,
      scope_to_pic: !!r.scope_to_pic,
      member_count: r.member_count ?? 0,
      created_at: r.created_at,
    })),
  });
});

/**
 * POST /api/roles
 * Body: { name, description?, permissions: string[] }
 * Create a custom role.
 */
app.post("/", requirePermission("roles.manage"), async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    permissions?: string[];
    scope_to_pic?: boolean;
  }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);

  const perms = (body.permissions || []).filter(isValidPermission);
  const name = body.name.trim();

  const db = getDb(c.env);
  const exists = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, name))
    .limit(1);
  if (exists.length > 0) {
    return c.json({ error: "A role with that name already exists" }, 409);
  }

  const inserted = await db
    .insert(roles)
    .values({
      name,
      description: body.description?.trim() || null,
      permissions: JSON.stringify(perms),
      is_system: 0,
      scope_to_pic: body.scope_to_pic ? 1 : 0,
    })
    .returning({ id: roles.id });

  await audit(c, {
    action: "role.create",
    entityType: "role",
    entityId: inserted[0]?.id,
    summary: `Created role "${name}"`,
    meta: { name, permissions: perms, scope_to_pic: !!body.scope_to_pic },
  });

  return c.json({
    id: inserted[0]?.id,
    name,
    description: body.description?.trim() || null,
    permissions: perms,
    is_system: false,
    scope_to_pic: !!body.scope_to_pic,
    member_count: 0,
  });
});

/**
 * PATCH /api/roles/:id
 * Body: { name?, description?, permissions? }
 * Update a custom role. System roles' permissions are locked.
 */
app.patch("/:id", requirePermission("roles.manage"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!id) return c.json({ error: "Invalid ID." }, 400);

  const db = getDb(c.env);
  const row = await db
    .select({ id: roles.id, is_system: roles.is_system })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  if (row.length === 0) return c.json({ error: "Role not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    permissions?: string[];
    scope_to_pic?: boolean;
  }>();

  // System roles: only description editable, never name or permissions.
  if (row[0].is_system) {
    if (body.name !== undefined || body.permissions !== undefined) {
      return c.json(
        { error: "System roles cannot be renamed or have permissions changed" },
        400
      );
    }
  }

  const set: Record<string, any> = {};
  if (body.name !== undefined) set.name = body.name.trim();
  if (body.description !== undefined) {
    set.description = body.description?.trim() || null;
  }
  if (body.permissions !== undefined) {
    set.permissions = JSON.stringify(body.permissions.filter(isValidPermission));
  }
  if (body.scope_to_pic !== undefined) {
    set.scope_to_pic = body.scope_to_pic ? 1 : 0;
  }
  if (Object.keys(set).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  await db.update(roles).set(set).where(eq(roles.id, id));
  await audit(c, {
    action: "role.update",
    entityType: "role",
    entityId: id,
    summary: `Updated role #${id}`,
    meta: { changed: Object.keys(set), permissions: body.permissions },
  });
  return c.json({ ok: true });
});

/**
 * GET /api/roles/:id/category-access
 * Which product categories the role sees on the Renovation beta project screens, with the catalog tree to draw.
 * No stored rows means every category (restricted false). The owner role (`*`) cannot be restricted.
 */
app.get("/:id/category-access", requirePermission("roles.read"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!id) return c.json({ error: "Invalid ID." }, 400);

  const row = await getDb(c.env).select({ id: roles.id, permissions: roles.permissions }).from(roles).where(eq(roles.id, id)).limit(1);
  if (row.length === 0) return c.json({ error: "Role not found" }, 404);

  const db = c.env.DB as unknown as Db;
  try {
    const scope = scopeOfRows(await readCategoryRows(db, id));
    // A code the catalog no longer has (hard deleted) is left out, so it cannot make the next save refuse. An inactive
    // sub-category is still in the catalog and stays.
    const known = await loadKnownCategories(db);
    return c.json({
      restricted: scope !== null,
      groups: [...(scope?.groups ?? [])].filter((g) => known.groups.has(g)),
      subs: [...(scope?.subs ?? [])].filter((x) => known.pairs.has(x)),
      other: scope?.other ?? false,
      catalog: await loadCategoryTree(db),
    });
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    return c.json({ error: "Category access is not switched on yet on this server." }, 409);
  }
});

/**
 * PUT /api/roles/:id/category-access
 * Body: { restricted, groups: string[], subs: string[] ("GROUP/SUB"), other }
 * Replaces the role's stored rows in one transaction. restricted false clears them (every category).
 * System roles are editable here too; only the owner role (`*`) is refused.
 */
app.put("/:id/category-access", requirePermission("roles.manage"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!id) return c.json({ error: "Invalid ID." }, 400);

  const row = await getDb(c.env).select({ id: roles.id, name: roles.name, permissions: roles.permissions }).from(roles).where(eq(roles.id, id)).limit(1);
  if (row.length === 0) return c.json({ error: "Role not found" }, 404);
  if (parsePermissions(row[0].permissions).includes("*")) {
    return c.json({ error: "The owner role always sees every category" }, 400);
  }

  const cleaned = cleanCategoryAccess(await c.req.json<unknown>().catch(() => null));
  if (!cleaned.ok) return c.json({ error: cleaned.message }, 400);
  const input = cleaned.value;

  const db = c.env.DB as unknown as Db;
  const unknown = unknownCategory(input, await loadKnownCategories(db));
  if (unknown) return c.json({ error: unknown }, 400);

  const stored = rowsOfInput(input);
  const userId = c.get("user").id;
  let before: CategoryScope | null;
  try {
    before = scopeOfRows(await readCategoryRows(db, id));
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM public.role_category_access WHERE role_id = ?`).bind(id),
      ...stored.map((r) =>
        c.env.DB.prepare(`INSERT INTO public.role_category_access (role_id, group_code, sub_code, updated_by) VALUES (?, ?, ?, ?)`)
          .bind(id, r.group_code, r.sub_code, userId),
      ),
    ]);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    return c.json({ error: "Category access is not switched on yet on this server." }, 409);
  }

  await audit(c, {
    action: "role.category_access.update",
    entityType: "role",
    entityId: id,
    summary: `${row[0].name}: product categories ${input.restricted ? "limited" : "all"}`,
    meta: {
      before: before && { groups: [...before.groups], subs: [...before.subs], other: before.other },
      after: stored.map((r) => (r.sub_code === null ? r.group_code : `${r.group_code}/${r.sub_code}`)),
    },
  });
  return c.json({ ok: true });
});

/**
 * DELETE /api/roles/:id
 * Delete a custom role. Refuses if any user still holds it.
 */
app.delete("/:id", requirePermission("roles.manage"), async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!id) return c.json({ error: "Invalid ID." }, 400);

  const db = getDb(c.env);
  const row = await db
    .select({ id: roles.id, is_system: roles.is_system })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  if (row.length === 0) return c.json({ error: "Role not found" }, 404);
  if (row[0].is_system) {
    return c.json({ error: "System roles cannot be deleted" }, 400);
  }

  const inUse = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users)
    .where(eq(users.role_id, id));
  const count = inUse[0]?.count ?? 0;
  if (count > 0) {
    return c.json(
      { error: `Role is in use by ${count} user(s) — reassign them first` },
      409
    );
  }

  await db.delete(roles).where(eq(roles.id, id));
  await audit(c, {
    action: "role.delete",
    entityType: "role",
    entityId: id,
    summary: `Deleted role #${id}`,
  });
  return c.json({ ok: true });
});

export default app;
