/* Renovation demo data: CLEANUP (browser snippet, also run by renovation-demo-cleanup.mjs).
 *
 * Reads the manifest written by renovation-demo-seed and undoes it in reverse dependency order, using
 * only the engine's own API (the same cancel / delete actions the screens offer). It never deletes
 * anything the manifest does not name, and it can be run again safely (a second run finds everything
 * already cancelled and changes nothing).
 *
 * WHAT IT REMOVES OR CANCELS, per project (last project first):
 *   1. customer payments on the demo invoices          deleted   (DELETE sales-invoices/:id/payments/:pid)
 *   2. progress invoices                               cancelled (status CANCELLED; the engine reverses
 *                                                                 their revenue journal)
 *   3. site receipts (GRNs)                            cancelled (no stock was booked, so none is reversed;
 *                                                                 the PO goes back to not received)
 *   4. purchase orders                                 cancelled
 *   5. variation orders still in draft / sent          cancelled
 *   6. sales order (contract)                          cancelled ONLY if it was never billed
 *   7. quotations not converted                        rejected
 *   8. the project                                     archived  (leaves the board and the calendar)
 * and then, once for the batch:
 *   9. the package template                            made inactive
 *  10. DEMO SKUs the seed created                      deleted when unused, otherwise made INACTIVE;
 *                                                      their supplier binding is deleted with them
 *      DEMO SKUs it switched back on (earlier batch)   made INACTIVE again
 *  11. DEMO suppliers it created or switched back on   made INACTIVE
 *
 * WHAT IT CANNOT REMOVE (the API has no delete for these; they stay, cancelled or archived):
 *   - Projects: archived, not deleted (no delete route). Their stages, checklist ticks, trade tasks,
 *     snags, handover record and activity log stay with the archived project.
 *   - Sales orders that were billed: the engine refuses to cancel a billed contract ("issue credit notes
 *     instead"), even after its invoices are cancelled. They stay at their status under the archived
 *     project. Approved variation orders stay applied to them.
 *   - Cancelled invoices, cancelled site receipts and cancelled POs stay as CANCELLED documents with
 *     their numbers used. Journal entries are reversed by new entries, not deleted, so the ledger keeps
 *     both. Audit / history rows stay.
 *   - Quotations and their revisions stay (rejected, or locked once converted).
 *   - SKUs that appear on a sales order or PO cannot be deleted (the engine locks used SKUs); they are
 *     made INACTIVE. Their product model row stays. Suppliers have no delete; they are made INACTIVE.
 *   - Uploaded files (placeholder photos, signatures) stay in storage: there is no delete route for
 *     project files. SKU photos of a deleted SKU are removed with it.
 *   - Document number counters are not wound back.
 * Everything that stays is listed at the end under "remaining".
 *
 * HOW TO RUN IT ON THE LIVE SITE (browser mode): same place as the seed (the engine frame or the engine
 * tab, see renovation-demo-seed.browser.js). It reads the manifest from localStorage
 * ('renovation-demo-manifest'); to use a downloaded manifest file instead, first run
 *   window.RENO_DEMO_MANIFEST = <paste the JSON here>;
 * then paste this file. It asks for confirmation before changing anything.
 */
(async () => {
  'use strict';
  const HOST = globalThis.RENO_DEMO_HOST || null;
  const MANIFEST_KEY = 'renovation-demo-manifest';
  const REPORT_KEY = 'renovation-demo-cleanup-report';
  const log = (...a) => (HOST?.log ?? console.log)(...a);

  function pageSession() {
    try {
      const ss = sessionStorage, ls = localStorage;
      let token = ss.getItem('auth:token'), pass = ss.getItem('auth:pass');
      if (!token && ss.getItem('auth:local-token-suppressed') !== '1') { token = ls.getItem('auth:token'); pass = ls.getItem('auth:pass'); }
      return token ? { token, pass } : null;
    } catch { return null; }
  }
  let BASE = '', AUTH = {};
  if (HOST) { BASE = HOST.base; AUTH = HOST.headers; }
  else {
    const s = pageSession();
    if (!s) { console.log('%cRun this inside the supply chain engine (the engine frame or tab), the same place the seed ran.', 'font-weight:bold;color:#b91c1c'); return { stopped: 'not_in_engine' }; }
    BASE = location.origin;
    AUTH = { authorization: `Bearer ${s.token}`, ...(s.pass ? { 'x-session-pass': s.pass } : {}) };
  }
  async function api(method, path, body) {
    const headers = { ...AUTH };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!HOST) { const np = r.headers.get('x-session-pass'); if (np) AUTH['x-session-pass'] = np; }
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  const short = (r) => `${r.status} ${typeof r.json === 'string' ? r.json.slice(0, 200) : JSON.stringify(r.json).slice(0, 300)}`;

  /* ---------------- manifest ---------------- */
  let M = HOST?.manifest ?? globalThis.RENO_DEMO_MANIFEST ?? null;
  if (!M && !HOST) { try { M = JSON.parse(localStorage.getItem(MANIFEST_KEY) || 'null'); } catch { M = null; } }
  if (!M || M.kind !== 'renovation-demo-manifest') { log('No renovation demo manifest found. Nothing was changed.'); return { stopped: 'no_manifest' }; }
  if (!HOST && M.engine && M.engine !== BASE) {
    log(`This manifest was written on ${M.engine}, but this page is ${BASE}. Nothing was changed.`);
    return { stopped: 'other_engine' };
  }
  const projects = (M.projects ?? []).filter((p) => p.id);
  const question = `Undo the renovation demo data from ${M.startedAt ?? 'an earlier run'} on ${BASE}?\n\n${projects.length} projects, ${(M.products ?? []).filter((p) => p.created || p.activated).length} SKUs, ${(M.suppliers ?? []).filter((s) => s.created || s.reactivated).length} suppliers. Invoices, receipts and POs are cancelled (not deleted); projects are archived.`;
  const yes = HOST ? await HOST.confirm(question) : confirm(question);
  if (!yes) { log('Cancelled. Nothing was changed.'); return { stopped: 'cancelled' }; }

  const report = { startedAt: new Date().toISOString(), engine: BASE, done: [], remaining: [], failed: [] };
  const did = (what) => { report.done.push(what); log(`  ok  ${what}`); };
  const stays = (what) => { report.remaining.push(what); log(`  --  ${what}`); };
  const fail = (what, r) => { report.failed.push(`${what}: ${r ? short(r) : 'error'}`); log(`  !!  ${what}: ${r ? short(r) : 'error'}`); };

  for (const p of [...projects].reverse()) {
    log(`${p.code} ${p.name}`);
    try {
      for (const pay of p.payments ?? []) {
        if (!pay.paymentId) continue;
        const r = await api('DELETE', `/api/scm/sales-invoices/${pay.salesInvoiceId}/payments/${pay.paymentId}`);
        if (r.status === 200 || r.status === 204) did(`payment of RM ${(pay.amountSen / 100).toFixed(2)} removed`);
        else if (r.status === 404) did('payment already removed');
        else fail('remove payment', r);
      }
      for (const b of p.bills ?? []) {
        if (b.kind === 'INVOICE' && b.salesInvoiceId) {
          const r = await api('PATCH', `/api/scm/sales-invoices/${b.salesInvoiceId}/status`, { status: 'CANCELLED' });
          if (r.status === 200) { did(`invoice ${b.invoiceNumber} cancelled`); stays(`invoice ${b.invoiceNumber} (cancelled, number used, revenue reversed by a new journal)`); }
          else fail(`cancel invoice ${b.invoiceNumber}`, r);
        } else if (b.kind === 'CREDIT_NOTE') stays(`credit note ${b.noteNumber} (no cancel through the renovation API)`);
      }
      for (const g of [...(p.grns ?? [])].reverse()) {
        const r = await api('PATCH', `/api/scm/grns/${g.id}/cancel`);
        if (r.status === 200) { did(`site receipt ${g.grnNumber} cancelled`); stays(`site receipt ${g.grnNumber} (cancelled)`); }
        else fail(`cancel site receipt ${g.grnNumber}`, r);
      }
      for (const po of [...(p.purchaseOrders ?? [])].reverse()) {
        const r = await api('PATCH', `/api/scm/mfg-purchase-orders/${po.id}/cancel`, { reason: 'Demo data removed (renovation-demo-cleanup)' });
        if (r.status === 200) { did(`PO ${po.poNumber} cancelled`); stays(`PO ${po.poNumber} (cancelled)`); }
        else fail(`cancel PO ${po.poNumber}`, r);
      }
      for (const vo of p.vos ?? []) {
        const cur = await api('GET', `/api/scm/renovation/variation-orders/${vo.id}`);
        if (cur.status !== 200) { fail(`read VO ${vo.voNo}`, cur); continue; }
        if (cur.json.status === 'DRAFT' || cur.json.status === 'SENT') {
          const r = await api('POST', `/api/scm/renovation/variation-orders/${vo.id}/status`, { status: 'CANCELLED', version: cur.json.version });
          if (r.status === 200) did(`VO ${vo.voNo} cancelled`); else fail(`cancel VO ${vo.voNo}`, r);
        } else if (cur.json.status === 'APPROVED') stays(`VO ${vo.voNo} (approved; stays applied to ${p.soDocNo})`);
      }
      if (p.soDocNo) {
        const billed = (p.bills ?? []).length > 0;
        const head = await api('GET', `/api/scm/renovation/sales-orders/${encodeURIComponent(p.soDocNo)}`);
        if (head.status === 200 && head.json.status === 'CANCELLED') stays(`sales order ${p.soDocNo} (cancelled)`);
        else if (!billed) {
          const r = await api('POST', `/api/scm/renovation/sales-orders/${encodeURIComponent(p.soDocNo)}/status`, { status: 'CANCELLED', note: 'Demo data removed' });
          if (r.status === 200) { did(`sales order ${p.soDocNo} cancelled`); stays(`sales order ${p.soDocNo} (cancelled)`); }
          else fail(`cancel sales order ${p.soDocNo}`, r);
        } else stays(`sales order ${p.soDocNo} (billed: the engine does not cancel a billed contract; left under the archived project)`);
      }
      for (const q of p.quotations ?? []) {
        const cur = await api('GET', `/api/scm/renovation/quotations/${q.id}`);
        if (cur.status !== 200) { fail(`read quotation ${q.quoteNo}`, cur); continue; }
        let { status, version, convertedSoDocNo } = cur.json.quotation;
        if (convertedSoDocNo) { stays(`quotation ${q.quoteNo} (converted, locked)`); continue; }
        if (status === 'ACCEPTED') {
          const r = await api('POST', `/api/scm/renovation/quotations/${q.id}/status`, { status: 'SENT', version });
          if (r.status !== 200) { fail(`reopen quotation ${q.quoteNo}`, r); continue; }
          status = 'SENT'; version = r.json.version;
        }
        if (status === 'DRAFT' || status === 'SENT') {
          const r = await api('POST', `/api/scm/renovation/quotations/${q.id}/status`, { status: 'REJECTED', version });
          if (r.status === 200) did(`quotation ${q.quoteNo} rejected`); else { fail(`reject quotation ${q.quoteNo}`, r); continue; }
        }
        stays(`quotation ${q.quoteNo} (rejected)`);
      }
      const a = await api('POST', `/api/projects/${p.id}/archive`);
      if (a.status === 200) { did(`project ${p.code} archived`); stays(`project ${p.code} (archived; no delete route)`); }
      else fail(`archive project ${p.code}`, a);
      const files = Object.keys(p.files ?? {}).length;
      if (files) stays(`${files} uploaded file(s) of ${p.code} (no delete route for project files)`);
    } catch (e) { fail(`${p.code}`, null); log(e); }
  }

  log('Catalog and suppliers');
  for (const t of M.templates ?? []) {
    if (!t.created && !t.reactivated) continue;
    const r = await api('PUT', `/api/scm/renovation/templates/${t.id}`, { active: false });
    if (r.status === 200) { did(`template "${t.name}" made inactive`); stays(`template "${t.name}" (inactive; no delete route)`); }
    else fail(`deactivate template ${t.name}`, r);
  }
  const bindingOf = (code) => (M.bindings ?? []).find((b) => b.itemCode === code);
  for (const prod of M.products ?? []) {
    if (!prod.created && !prod.activated) continue;
    // A SKU an earlier batch created and this batch only switched back on: switch it off again, never delete it.
    const r = prod.created ? await api('DELETE', `/api/scm/mfg-products/${prod.id}`) : { status: 409 };
    if (r.status === 204 || r.status === 200) {
      did(`SKU ${prod.code} deleted`);
      const b = bindingOf(prod.code);
      if (b?.bindingId) {
        const rb = await api('DELETE', `/api/scm/suppliers/${b.supplierId}/bindings/${b.bindingId}`);
        if (rb.status === 200 || rb.status === 204 || rb.status === 404) did(`binding of ${prod.code} deleted`); else fail(`delete binding of ${prod.code}`, rb);
      }
    } else if (r.status === 404) did(`SKU ${prod.code} already gone`);
    else if (r.status === 409) {
      const ri = await api('PATCH', `/api/scm/mfg-products/${prod.id}`, { status: 'INACTIVE' });
      if (ri.status === 200) { did(`SKU ${prod.code} made inactive`); stays(`SKU ${prod.code} (${prod.created ? 'used on a document' : 'from an earlier batch'}, inactive)`); }
      else fail(`deactivate SKU ${prod.code}`, ri);
    } else fail(`delete SKU ${prod.code}`, r);
  }
  for (const s of M.suppliers ?? []) {
    if (!s.created && !s.reactivated) continue;
    const r = await api('PATCH', `/api/scm/suppliers/${s.id}`, { status: 'INACTIVE' });
    if (r.status === 200) { did(`supplier ${s.code} made inactive`); stays(`supplier ${s.code} (inactive; no delete route)`); }
    else fail(`deactivate supplier ${s.code}`, r);
  }

  report.finishedAt = new Date().toISOString();
  const tally = (list, f) => list.reduce((acc, s) => { const k = f(s); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const norm = (s) => s.replace(/ \([^)]*\)$/, '').replace(/ "[^"]*"/, '').replace(/ of RM [\d.]+/, '').replace(/ (of |to )?(HC-|QT-|RN-|DEMO-|VO-)\S+/g, '').replace(/^\d+ /, 'n ');
  report.summary = {
    done: report.done.length, remaining: report.remaining.length, failed: report.failed.length,
    actions: tally(report.done, norm),
    remainingByKind: tally(report.remaining, (s) => `${norm(s)} (${(s.match(/\(([^)]*)\)$/)?.[1] ?? '').split(/[;,]/)[0]})`),
  };
  M.cleanedAt = report.finishedAt;
  if (HOST?.saveReport) HOST.saveReport(report, M);
  else {
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(report)); localStorage.setItem(MANIFEST_KEY, JSON.stringify(M)); } catch { /* still returned below */ }
    globalThis.renovationDemoCleanupReport = report;
  }
  log(`\nCleanup finished: ${report.done.length} actions, ${report.remaining.length} records remain (cancelled / archived / inactive), ${report.failed.length} failed.`);
  log('Actions:', JSON.stringify(report.summary.actions));
  log('Remaining:', JSON.stringify(report.summary.remainingByKind));
  if (report.failed.length) { log('Failed:'); for (const f of report.failed) log(`  - ${f}`); }
  return report;
})();
