/* What the voucher's project and unit pickers read (chew 2 Nov 2026; plan 2026-11-02-voucher-purpose Task 3). Pinned:
     · each project carries its customer, its contract's status (from the sales order) and handover, and whether it is done;
     · the units are Property OS's, building and number;
     · both are the active company's only (units are shared masters). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { listProjectsHandler } from './project-limit-routes';
import { listUnitsHandler } from './units-route';

const CO = 2;
const world = () => publicTablesOnly(fakeSb({
  projects: [
    { id: 7, company_id: CO, code: 'RN-2607-003', name: 'ASTER HILL A-08-11 MS AMANDA', customer_name: 'MS AMANDA', funding: 'customer', brand: 'The Conts', planned_handover_date: '2026-11-25', handed_over_at: null, closed_at: null, created_at: '2026-07-03T02:00:00Z' },
    { id: 8, company_id: CO, code: 'RN-2608-003', name: 'BARON C-20-08 MR ALBERT', customer_name: 'MR ALBERT', funding: 'customer', brand: 'The Conts', finance_kind: 'RENOVATION', planned_handover_date: '2026-10-20', handed_over_at: '2026-10-20T04:00:00Z', closed_at: null, created_at: '2026-08-03T02:00:00Z' },
    { id: 9, company_id: CO, code: 'RN-2610-007', name: 'SO - THE HIPSTER C10-05 MS IRIS', customer_name: null, funding: 'internal', internal_department: 'rental', planned_handover_date: null, handed_over_at: null, closed_at: null, created_at: '2026-10-07T02:00:00Z' },
    { id: 10, company_id: 9, code: 'X', name: 'OTHER COMPANY', funding: 'customer', created_at: '2026-10-07T02:00:00Z' },
  ],
  project_brands: [{ id: 1, company_id: CO, name: 'The Conts', finance_kind: 'INHOUSE_RENOVATION' }],
  mfg_sales_orders: [
    { doc_no: 'SO-7', company_id: CO, project_id: 7, status: 'RENO_IN_PROGRESS' },
    { doc_no: 'SO-8', company_id: CO, project_id: 8, status: 'RENO_COMPLETED' },
  ],
  conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }],
}), ['projects', 'project_brands', 'conts_units']);
const app = () => {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('supabase' as never, world() as never); c.set('companyId' as never, CO as never); await next(); });
  a.get('/projects', listProjectsHandler as never);
  a.get('/units', listUnitsHandler as never);
  return a;
};

describe('picker lists', () => {
  test('projects carry customer, contract status, handover and done', async () => {
    const body = await (await app().request('/projects')).json() as { projects: Array<Record<string, unknown>> };
    expect(body.projects.map((p) => p.id).sort()).toEqual([7, 8, 9]);
    expect(body.projects.find((p) => p.id === 7)).toMatchObject({ customer_name: 'MS AMANDA', contract_status: 'RENO_IN_PROGRESS', planned_handover_date: '2026-11-25', done: false });
    expect(body.projects.find((p) => p.id === 8)).toMatchObject({ contract_status: 'RENO_COMPLETED', done: true });
    expect(body.projects.find((p) => p.id === 9)).toMatchObject({ contract_status: null, done: false, funding: 'internal', internal_department: 'rental' });
  });

  /* SOP 1.1 (chew 4 Nov 2026): the picker lists a renovation sub-department's own brand's projects. */
  test('each project carries its brand: its own kind, else its brand’s, else Dream Crafter', async () => {
    const body = await (await app().request('/projects')).json() as { projects: Array<Record<string, unknown>> };
    expect(Object.fromEntries(body.projects.map((p) => [p.id, p.reno_kind]))).toEqual({ 7: 'INHOUSE_RENOVATION', 8: 'RENOVATION', 9: 'RENOVATION' });
  });

  test('units are building and number', async () => {
    expect(await (await app().request('/units')).json()).toEqual({ units: [{ id: 'u-a31', building: 'ASTER HILL', unitNumber: 'A-3-1' }] });
  });
});
