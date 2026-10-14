/* Renovation document flow (owner, 14 Oct 2026, "batch 4"; migration 0116): the quotation carries the
   customer + property block, and converting it stamps the sales order the way a renovation-mode SO is
   stamped since migration 0112 (address, building, unit, property, room list, each line's room).
   Downstream (DO, SI, PO, GR) is copied by the 0116 triggers. Field list:
   docs/superpowers/plans/2026-10-14-reno-doc-flow-fields.md.

   Every read and write here first checks the columns exist, so an engine deployed before 0116 is
   applied keeps working with the quotation as it was. */

import type { RenoDb } from './renovation-db';
import { cleanRoomName, roomsWithLineRooms, soAddressFromSite } from '../shared/renovation-property';

export interface QuoteProperty {
  siteAddress: string;
  propertyType: string;
  layoutLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  builtUpSqft: number | null;
}

export const EMPTY_QUOTE_PROPERTY: QuoteProperty = {
  siteAddress: '', propertyType: '', layoutLabel: '', bedrooms: null, bathrooms: null, builtUpSqft: null,
};

/* Columns never disappear once a migration is in, so a true answer is kept for the isolate's life. */
const known = { quote: false, so: false };

/** Migration 0116 (quotation property columns) is in this database. */
export async function quotePropertyReady(db: RenoDb): Promise<boolean> {
  if (known.quote) return true;
  const r = (await db.q<{ ok: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'scm' and table_name = 'reno_quotation_revisions' and column_name = 'built_up_sqft') as ok`,
  )).at(0);
  known.quote = r?.ok === true;
  return known.quote;
}

/** Migration 0112 (the SO's property and room columns) is in this database. */
async function soPropertyReady(db: RenoDb): Promise<boolean> {
  if (known.so) return true;
  const r = (await db.q<{ ok: boolean }>(
    `select (exists (select 1 from information_schema.columns
                      where table_schema = 'scm' and table_name = 'mfg_sales_orders' and column_name = 'room_sections')
             and exists (select 1 from information_schema.columns
                      where table_schema = 'scm' and table_name = 'mfg_sales_order_items' and column_name = 'room')) as ok`,
  )).at(0);
  known.so = r?.ok === true;
  return known.so;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export async function readRevisionProperty(db: RenoDb, revisionId: string): Promise<QuoteProperty> {
  if (!(await quotePropertyReady(db))) return { ...EMPTY_QUOTE_PROPERTY };
  const r = (await db.q<Record<string, unknown>>(
    `select site_address, property_type, layout_label, bedrooms, bathrooms, built_up_sqft::float8 as built_up_sqft
       from scm.reno_quotation_revisions where id = $1`,
    [revisionId],
  )).at(0);
  if (!r) return { ...EMPTY_QUOTE_PROPERTY };
  return {
    siteAddress: String(r.site_address ?? ''), propertyType: String(r.property_type ?? ''), layoutLabel: String(r.layout_label ?? ''),
    bedrooms: num(r.bedrooms), bathrooms: num(r.bathrooms), builtUpSqft: num(r.built_up_sqft),
  };
}

export async function writeRevisionProperty(db: RenoDb, revisionId: string, p: Partial<QuoteProperty>): Promise<void> {
  if (!(await quotePropertyReady(db))) return;
  const v = { ...EMPTY_QUOTE_PROPERTY, ...p };
  await db.q(
    `update scm.reno_quotation_revisions set site_address = $2, property_type = $3, layout_label = $4, bedrooms = $5::int, bathrooms = $6::int,
        built_up_sqft = $7::numeric where id = $1`,
    [revisionId, v.siteAddress, v.propertyType, v.layoutLabel, v.bedrooms, v.bathrooms, v.builtUpSqft],
  );
}

export interface ProjectParty extends QuoteProperty {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  building: string;
  unitNo: string;
}

/** A renovation project's customer + property, or null (no project, not renovation, or before 0112). */
export async function readProjectParty(db: RenoDb, projectId: number | null, companyId: number): Promise<ProjectParty | null> {
  if (projectId == null) return null;
  const hasProperty = await soPropertyReady(db);
  const r = (await db.q<Record<string, unknown>>(
    `select customer_name, customer_phone, customer_email, site_address, building, unit_no
            ${hasProperty ? ', property_type, layout_label, bedrooms, bathrooms, built_up_sqft::float8 as built_up_sqft' : ''}
       from public.projects where id = $1 and company_id = $2 and project_kind = 'renovation'`,
    [projectId, companyId],
  )).at(0);
  if (!r) return null;
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    customerName: s(r.customer_name), customerPhone: s(r.customer_phone), customerEmail: s(r.customer_email),
    siteAddress: s(r.site_address), building: s(r.building), unitNo: s(r.unit_no),
    propertyType: s(r.property_type), layoutLabel: s(r.layout_label), bedrooms: num(r.bedrooms), bathrooms: num(r.bathrooms),
    builtUpSqft: num(r.built_up_sqft),
  };
}

type PartyFields = Partial<ProjectParty>;

/** Fill every blank party field of a quotation header from its project (a typed value always stays). Pure. */
export function fillBlanksFromProject<T extends PartyFields>(header: T, project: ProjectParty | null): T {
  if (!project) return header;
  const out = { ...header } as Record<string, unknown>;
  for (const k of Object.keys(project) as Array<keyof ProjectParty>) {
    const cur = out[k];
    const blank = cur === undefined || cur === null || (typeof cur === 'string' && cur.trim() === '');
    if (blank && project[k] !== null && project[k] !== '') out[k] = project[k];
  }
  return out as T;
}

interface ContractSection { heading: string; soItemId?: string | null; lines: Array<{ kind: string; room: string; soItemId?: string | null }> }

/** The room list and each SO line's room for a contract's sections: a line's own room, else its section heading. Pure. */
export function contractRooms(sections: readonly ContractSection[]): { roomSections: string[]; itemRooms: Array<{ id: string; room: string }> } {
  const itemRooms: Array<{ id: string; room: string }> = [];
  const lineRooms: string[] = [];
  for (const s of sections) {
    if (s.soItemId) itemRooms.push({ id: s.soItemId, room: cleanRoomName(s.heading) });
    for (const l of s.lines) {
      if (!l.soItemId) continue;
      const room = cleanRoomName(l.room) || cleanRoomName(s.heading);
      itemRooms.push({ id: l.soItemId, room });
      lineRooms.push(room);
    }
  }
  return { roomSections: roomsWithLineRooms(sections.map((s) => s.heading), lineRooms), itemRooms };
}

/** Converting a quotation: stamp the new contract SO with the quotation's site address and property (its project's
    where the quotation left one blank), building, unit, room list and each line's room. */
export async function stampContractFromQuotation(
  db: RenoDb,
  docNo: string,
  q: { projectId: number | null; companyId: number; building: string; unitNo: string; property: QuoteProperty; sections: readonly ContractSection[] },
): Promise<void> {
  const project = await readProjectParty(db, q.projectId, q.companyId);
  const p = fillBlanksFromProject({ ...q.property, building: q.building, unitNo: q.unitNo }, project);
  /* Without a site address the contract keeps what conversion always wrote (building, unit). */
  const addr = soAddressFromSite(p.siteAddress);
  if (addr.address1) {
    await db.q(`update scm.mfg_sales_orders set address1 = $2, address2 = $3 where doc_no = $1`, [docNo, addr.address1, addr.address2 || null]);
  }
  if (!(await soPropertyReady(db))) return;
  const rooms = contractRooms(q.sections);
  await db.q(
    `update scm.mfg_sales_orders set building = $2, unit_no = $3, property_type = $4, layout_label = $5, bedrooms = $6::int, bathrooms = $7::int,
        built_up_sqft = $8::numeric, room_sections = $9::text::jsonb where doc_no = $1`,
    [docNo, p.building || null, p.unitNo || null, p.propertyType || null, p.layoutLabel || null, p.bedrooms ?? null, p.bathrooms ?? null,
      p.builtUpSqft ?? null, JSON.stringify(rooms.roomSections)],
  );
  if (rooms.itemRooms.length) {
    await db.q(
      `update scm.mfg_sales_order_items i set room = nullif(x.room, '')
         from jsonb_to_recordset($2::text::jsonb) as x(id uuid, room text) where i.id = x.id and i.doc_no = $1`,
      [docNo, JSON.stringify(rooms.itemRooms)],
    );
  }
}
