/* Renovation demo data: SEED (browser snippet, also run by renovation-demo-seed.mjs).
 *
 * Creates about 20 renovation projects named "DEMO - ..." through the engine's own HTTP API, the same
 * endpoints the screens call, so every real rule applies: numbering (RN-, QT-, SO, PO, GRN, invoice),
 * totals, stage gates, PO split, progress billing, variation orders, site receipts. Nothing is written
 * with SQL.
 *
 * What it creates (all names start with "DEMO"):
 *   - 12 suppliers / subcontractors      "DEMO ..."           (code DEMO-...)
 *   - 26 catalog SKUs                    "DEMO ..."           (code DEMO-...), furniture / appliance /
 *     soft / built-in / lighting, each with a generated placeholder photo (photo groups need one to be
 *     ACTIVE) and a main-supplier binding to a DEMO supplier. Works lines use the generic RN-<TRADE> SKUs
 *     with the DEMO subcontractor picked on the line; the generic SKUs themselves are not changed.
 *   - 1 package template                 "DEMO Skyline Embassy Type A Classic"
 *   - 20 projects across the stages: 3 design (one with R2), 3 accepted not converted, 4 signed
 *     (instalment 1 billed), 4 hardware works in progress (POs, trades received on site with placeholder
 *     photos), 3 furniture / appliances (VO add, VO omission, VO waiting for signature), 1 at handover,
 *     1 handed over, 1 Airbnb package with skipped stages. Task dates sit around today so the calendar
 *     shows them.
 * Every id and document number goes into a manifest: printed at the end, saved to localStorage key
 * 'renovation-demo-manifest' (browser) and offered as a JSON download. renovation-demo-cleanup.browser.js
 * reads that manifest to undo what can be undone.
 *
 * HOW TO RUN IT ON THE LIVE SITE (browser mode)
 *   1. Sign in to Property OS and open any supply chain screen (for example Projects).
 *   2. Open the browser's developer tools (F12) -> Console.
 *   3. The supply chain screens run in a frame from the engine's own site. In the Console's context
 *      drop-down (top left, says "top"), pick the frame whose name is the engine site (theconts-scm...).
 *      If you skip this step the snippet notices, opens the engine in a new tab already signed in, and
 *      asks you to paste it again there.
 *   4. Paste this whole file and press Enter. It asks for confirmation before writing anything and logs
 *      its progress. It takes a few minutes.
 *   Options (set before pasting): window.RENO_DEMO_OPTIONS = { again: true } to seed a second batch even
 *   though DEMO projects already exist.
 *
 * It uses the session already in the page; no password, key or token is written anywhere.
 */
(async () => {
  'use strict';
  const HOST = globalThis.RENO_DEMO_HOST || null; // set only by the Node runner
  const OPT = Object.assign({ again: false }, globalThis.RENO_DEMO_OPTIONS || {});
  const MANIFEST_KEY = 'renovation-demo-manifest';
  const log = (...a) => (HOST?.log ?? console.log)(...a);

  /* ---------------- where and as whom ---------------- */
  function pageSession() {
    try {
      const ss = sessionStorage, ls = localStorage;
      let token = ss.getItem('auth:token'), pass = ss.getItem('auth:pass');
      if (!token && ss.getItem('auth:local-token-suppressed') !== '1') { token = ls.getItem('auth:token'); pass = ls.getItem('auth:pass'); }
      return token ? { token, pass } : null;
    } catch { return null; }
  }
  let BASE = '', AUTH = {};
  if (HOST) {
    BASE = HOST.base; AUTH = HOST.headers;
  } else {
    const s = pageSession();
    if (!s) {
      // Not inside the engine: on Property OS, ask it for an engine session and open the engine in a new tab.
      const r = await fetch('/api/supply-chain/engine-session', { method: 'POST', credentials: 'include' }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (r && r.ok && j?.site && j?.token) {
        const b64 = btoa(JSON.stringify({ t: j.token, sp: j.sessionPass ?? undefined, p: '/projects' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        window.open(`${j.site}/#conts=${b64}`, '_blank');
        console.log('%cThis page is Property OS, not the supply chain engine. A new tab with the engine has opened, already signed in. Paste the snippet again in THAT tab\'s console.', 'font-weight:bold;color:#b45309');
      } else {
        console.log('%cNo supply chain session found. Open a supply chain screen and pick the engine frame in the console\'s context drop-down, then paste again.', 'font-weight:bold;color:#b91c1c');
      }
      return { stopped: 'not_in_engine' };
    }
    BASE = location.origin;
    AUTH = { authorization: `Bearer ${s.token}`, ...(s.pass ? { 'x-session-pass': s.pass } : {}) };
  }

  async function api(method, path, body, opts = {}) {
    const headers = { ...AUTH, ...(opts.headers || {}) };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body instanceof Uint8Array || body instanceof Blob) { payload = body; headers['content-type'] = opts.contentType || 'image/png'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(BASE + path, { method, headers, body: payload }); break; }
      catch (e) { if (attempt >= 2 || method !== 'GET') throw new Error(`${method} ${path}: network error ${e.message}`); await sleep(800); }
    }
    if (!HOST) { const np = r.headers.get('x-session-pass'); if (np) AUTH['x-session-pass'] = np; }
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  class Step extends Error { constructor(what, r) { super(`${what}: ${r ? `${r.status} ${typeof r.json === 'string' ? r.json.slice(0, 300) : JSON.stringify(r.json).slice(0, 400)}` : 'failed'}`); this.r = r; } }
  const ok = (r, what, codes = [200, 201]) => { if (!codes.includes(r.status)) throw new Step(what, r); return r.json; };

  /* ---------------- dates (Malaysia time) ---------------- */
  const dayMs = 86400000;
  const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10);
  const TODAY = today();

  /* ---------------- placeholder image ---------------- */
  const FALLBACK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAW0lEQVR42u3XQQ0AIAwAsQlDABqmdgp4ogcZZFmTM9DnxT3VugAAAAAAAAAAAAAAAAAAAAAAmAlYO1sHAAAAAAAAAAAA8BFgaAAAAAAAAAAAAAAAAAAAAABGAh5p5Yth67K5lwAAAABJRU5ErkJggg==';
  async function placeholderPng(label, colour = '#3c4858') {
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        const c = document.createElement('canvas'); c.width = 480; c.height = 360;
        const g = c.getContext('2d');
        g.fillStyle = '#efe9df'; g.fillRect(0, 0, 480, 360);
        g.fillStyle = colour; g.fillRect(0, 130, 480, 100);
        g.fillStyle = '#ffffff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('DEMO PHOTO', 240, 172);
        g.font = '18px sans-serif'; g.fillText(String(label).slice(0, 40), 240, 206);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        if (blob) return blob;
      }
    } catch { /* fall through */ }
    return new Blob([Uint8Array.from(atob(FALLBACK_PNG), (ch) => ch.charCodeAt(0))], { type: 'image/png' });
  }

  /* ---------------- manifest ---------------- */
  const M = {
    kind: 'renovation-demo-manifest', version: 1, engine: BASE, startedAt: new Date().toISOString(), finishedAt: null,
    suppliers: [], products: [], bindings: [], templates: [], projects: [], warnings: [],
  };
  function save() {
    if (HOST?.saveManifest) { HOST.saveManifest(M); return; }
    try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(M)); } catch { /* storage full or blocked: still printed at the end */ }
    globalThis.renovationDemoManifest = M;
  }
  const warn = (where, e) => { const msg = `${where}: ${e?.message ?? e}`; M.warnings.push(msg); log(`  ! ${msg}`); };

  /* ---------------- refuse a second batch unless asked ---------------- */
  const board = ok(await api('GET', '/api/renovation'), 'read the project board');
  const existing = (board.data ?? []).filter((p) => String(p.name ?? '').startsWith('DEMO - '));
  if (existing.length && !OPT.again) {
    log(`There are already ${existing.length} DEMO projects on the board (for example ${existing[0].code} ${existing[0].name}). Nothing was written.`);
    log('Run the cleanup first, or set RENO_DEMO_OPTIONS = { again: true } (or --again) to add a second batch.');
    return { stopped: 'demo_exists', count: existing.length };
  }
  const question = `Create about 20 DEMO renovation projects, 26 DEMO SKUs and 12 DEMO suppliers on ${BASE}?\n\nThis writes real records (quotations, sales orders, POs, invoices, site receipts). Some of them (posted invoices, receipts, journals) can only be cancelled later, not deleted.`;
  const yes = HOST ? await HOST.confirm(question) : confirm(question);
  if (!yes) { log('Cancelled. Nothing was written.'); return { stopped: 'cancelled' }; }
  save();

  /* ---------------- reference data ---------------- */
  const types = ok(await api('GET', '/api/renovation/types'), 'read project types').data ?? [];
  const typeId = (slug) => { const t = types.find((x) => x.slug === slug); if (!t) throw new Error(`project type ${slug} is missing`); return t.id; };
  const brands = ok(await api('GET', '/api/scm/renovation/brands'), 'read brands').brands ?? [];
  const brandId = (name) => brands.find((b) => b.name === name)?.brandId ?? null;
  const terms = ok(await api('GET', '/api/scm/renovation/terms?kind=CUSTOMER'), 'read payment terms').templates ?? [];
  const termId = (key) => {
    const want = key === '15' ? '1500/5000/3000/500' : '3000/3000/3500/500';
    return terms.find((t) => (t.lines ?? []).map((l) => l.pctBp).join('/') === want)?.id ?? null;
  };

  /* ---------------- suppliers ---------------- */
  const SUPPLIERS = [
    ['DEMO-CARP', 'DEMO Carpentry Factory'], ['DEMO-STONE', 'DEMO Stone Top Works'], ['DEMO-ELEC', 'DEMO Wiring & Lighting Works'],
    ['DEMO-MASON', 'DEMO Masonry & Tiling Contractor'], ['DEMO-PLUMB', 'DEMO Plumbing & Waterproofing'], ['DEMO-PAINT', 'DEMO Paint & Plaster Ceiling'],
    ['DEMO-ALUM', 'DEMO Aluminium, Glass & Grill'], ['DEMO-AIRCON', 'DEMO Aircon Installer'], ['DEMO-CLEAN', 'DEMO Cleaning & Set Up Services'],
    ['DEMO-FURN', 'DEMO Furniture Trading'], ['DEMO-APPL', 'DEMO Appliance House'], ['DEMO-SOFT', 'DEMO Curtain & Linen'],
  ];
  const SUP = {};
  log('Suppliers...');
  const known = ok(await api('GET', '/api/scm/suppliers?search=DEMO-'), 'list suppliers').suppliers ?? [];
  for (const [code, name] of SUPPLIERS) {
    const found = known.find((s) => s.code === code);
    if (found) {
      SUP[code] = found.id;
      const reactivated = !!found.status && found.status !== 'ACTIVE';
      if (reactivated) ok(await api('PATCH', `/api/scm/suppliers/${found.id}`, { status: 'ACTIVE' }), `reactivate ${code}`);
      M.suppliers.push({ id: found.id, code, name: found.name, created: false, reactivated });
      continue;
    }
    const r = ok(await api('POST', '/api/scm/suppliers', { code, name, notes: 'Demo data (renovation-demo-seed). Safe to remove.', paymentTerms: '30 DAYS' }), `create supplier ${code}`);
    SUP[code] = r.supplier.id;
    M.suppliers.push({ id: r.supplier.id, code, name, created: true });
  }
  save();

  /* ---------------- catalog ---------------- */
  // code, name, category (group), sub-category, uom, sell RM, cost RM, main supplier
  const CATALOG = [
    ['DEMO-KITCHEN-BTM', 'DEMO Kitchen Bottom Cabinet (per ft)', 'BUILTIN', 'KITCHEN_CABINET', 'FT', 450, 260, 'DEMO-CARP'],
    ['DEMO-KITCHEN-TOP', 'DEMO Kitchen Top Cabinet (per ft)', 'BUILTIN', 'KITCHEN_CABINET', 'FT', 380, 220, 'DEMO-CARP'],
    ['DEMO-WARDROBE-SW', 'DEMO Swing Door Wardrobe', 'BUILTIN', 'WARDROBE', 'UNIT', 5323, 3000, 'DEMO-CARP'],
    ['DEMO-WARDROBE-SL', 'DEMO Sliding Door Wardrobe', 'BUILTIN', 'WARDROBE', 'UNIT', 6800, 3900, 'DEMO-CARP'],
    ['DEMO-TV-CAB', 'DEMO TV Feature Cabinet', 'BUILTIN', 'TV_CABINET', 'UNIT', 3200, 1800, 'DEMO-CARP'],
    ['DEMO-SHOE-CAB', 'DEMO Shoe Cabinet', 'BUILTIN', 'SHOE_CABINET', 'UNIT', 1500, 850, 'DEMO-CARP'],
    ['DEMO-STUDY', 'DEMO Study Table with Shelf', 'BUILTIN', 'STUDY_TABLE', 'UNIT', 1800, 1000, 'DEMO-CARP'],
    ['DEMO-QUARTZ', 'DEMO Quartz Countertop (per ft)', 'BUILTIN', 'COUNTERTOP', 'FT', 220, 120, 'DEMO-STONE'],
    ['DEMO-SOFTCLOSE', 'DEMO Soft Close Drawer (add-on)', 'BUILTIN', 'SHELVING', 'PCS', 90, 40, 'DEMO-CARP'],
    ['DEMO-LEDCASING', 'DEMO LED Casing for Cabinet (add-on)', 'BUILTIN', 'SHELVING', 'PCS', 150, 70, 'DEMO-CARP'],
    ['DEMO-DOWNLIGHT', 'DEMO LED Downlight 12W', 'LIGHTING', 'DOWNLIGHT', 'PCS', 45, 20, 'DEMO-ELEC'],
    ['DEMO-LEDSTRIP', 'DEMO LED Strip Light (per ft)', 'LIGHTING', 'LED_STRIP', 'FT', 35, 15, 'DEMO-ELEC'],
    ['DEMO-FAN', 'DEMO Ceiling Fan 52 inch', 'LIGHTING', 'CEILING_FAN', 'UNIT', 680, 420, 'DEMO-ELEC'],
    ['DEMO-SOFA-3S', 'DEMO 3 Seater Fabric Sofa', 'FURNITURE', 'SOFA', 'UNIT', 2890, 1700, 'DEMO-FURN'],
    ['DEMO-BED-Q', 'DEMO Queen Bedframe', 'FURNITURE', 'BEDFRAME', 'UNIT', 1590, 900, 'DEMO-FURN'],
    ['DEMO-MATT-Q', 'DEMO Queen Pocket Spring Mattress', 'FURNITURE', 'MATTRESS', 'UNIT', 1290, 700, 'DEMO-FURN'],
    ['DEMO-DINING-4', 'DEMO 4 Seater Dining Set', 'FURNITURE', 'DINING', 'SET', 1990, 1100, 'DEMO-FURN'],
    ['DEMO-COFFEE', 'DEMO Coffee Table', 'FURNITURE', 'TABLES', 'UNIT', 590, 300, 'DEMO-FURN'],
    ['DEMO-TV55', 'DEMO 55 inch 4K Smart TV', 'APPLIANCE', 'TV', 'UNIT', 2399, 1950, 'DEMO-APPL'],
    ['DEMO-FRIDGE', 'DEMO 2 Door Fridge 400L', 'APPLIANCE', 'FRIDGE', 'UNIT', 2199, 1800, 'DEMO-APPL'],
    ['DEMO-WASHER', 'DEMO Washer Dryer 9kg', 'APPLIANCE', 'WASHER', 'UNIT', 2499, 2050, 'DEMO-APPL'],
    ['DEMO-HOODHOB', 'DEMO Hood and Hob Set', 'APPLIANCE', 'HOOD_HOB', 'SET', 1899, 1400, 'DEMO-APPL'],
    ['DEMO-CURTAIN', 'DEMO Day and Night Curtain (per ft)', 'SOFT', 'CURTAIN_BLINDS', 'FT', 90, 45, 'DEMO-SOFT'],
    ['DEMO-LINEN-Q', 'DEMO Queen Bed Linen Set', 'SOFT', 'BED_LINEN', 'SET', 259, 120, 'DEMO-SOFT'],
    ['DEMO-AMENITY', 'DEMO Airbnb Amenities Starter Pack', 'SOFT', 'AMENITIES', 'SET', 450, 220, 'DEMO-SOFT'],
    ['DEMO-DECO', 'DEMO Wall Art and Deco Set', 'SOFT', 'DECORATION', 'SET', 680, 300, 'DEMO-SOFT'],
  ];
  const RM = (x) => Math.round(x * 100);
  const CAT = Object.fromEntries(CATALOG.map(([code, name, group, sub, uom, sell, cost, sup]) => [code, { code, name, group, sub, uom, sell, cost, sup }]));
  log('Catalog SKUs (with placeholder photos)...');
  const knownProducts = ok(await api('GET', '/api/scm/mfg-products?status=all&search=DEMO-'), 'list SKUs').products ?? [];
  const groupColour = { BUILTIN: '#7c4a1e', LIGHTING: '#b7791f', FURNITURE: '#2f5d50', APPLIANCE: '#2c3e66', SOFT: '#8a3b5c' };
  for (const k of CATALOG.map(([code]) => CAT[code])) {
    try {
      let p = knownProducts.find((x) => x.code === k.code);
      let created = false;
      if (!p) {
        const r = ok(await api('POST', '/api/scm/mfg-products', {
          code: k.code, name: k.name, category: k.group, subCategory: k.sub, uom: k.uom,
          basePriceSen: RM(k.sell), price1Sen: RM(k.sell), costPriceSen: RM(k.cost), description: 'Demo data (renovation-demo-seed). Safe to remove.',
        }), `create SKU ${k.code}`);
        p = { id: r.id, code: k.code, status: r.status };
        created = true;
      }
      const entry = { id: p.id, code: k.code, created, photoIds: [], activated: false };
      M.products.push(entry);
      const photos = ok(await api('GET', `/api/scm/mfg-products/${p.id}/photos`), `read photos ${k.code}`);
      if (!(photos.photos ?? photos.data ?? []).length) {
        const fd = new FormData();
        fd.append('file', await placeholderPng(k.name, groupColour[k.group]), `${k.code.toLowerCase()}.png`);
        const up = ok(await api('POST', `/api/scm/mfg-products/${p.id}/photos`, fd), `upload photo ${k.code}`);
        if (up.photo?.id) entry.photoIds.push(up.photo.id);
      }
      if (p.status !== 'ACTIVE') { ok(await api('PATCH', `/api/scm/mfg-products/${p.id}`, { status: 'ACTIVE' }), `activate ${k.code}`); entry.activated = true; }
      if (created) {
        const b = ok(await api('POST', `/api/scm/suppliers/${SUP[k.sup]}/bindings`, {
          materialKind: 'mfg_product', itemCode: k.code, materialName: k.name, supplierSku: `${k.sup}-${k.code}`, unitPriceSen: RM(k.cost), isMainSupplier: true,
        }), `bind ${k.code} to ${k.sup}`);
        M.bindings.push({ supplierId: SUP[k.sup], bindingId: b.binding?.id ?? null, itemCode: k.code });
      }
    } catch (e) { warn(`SKU ${k.code}`, e); }
    save();
  }

  /* ---------------- document lines ---------------- */
  const sup = (code) => (code ? SUP[code] ?? null : null);
  function line(itemCode, description, o = {}) {
    return {
      kind: o.child ? 'CHILD' : 'ITEM', itemCode, description, room: o.room ?? '', qty: o.qty ?? 1,
      measure: o.m != null ? String(o.m) : null, measureUom: o.m != null ? (o.mu ?? 'FT') : null,
      unitPriceSen: RM(o.price ?? 0), unitCostSen: RM(o.cost ?? 0), supplierId: sup(o.sup), discountBp: o.disc ?? 0,
      listPriceSen: o.list != null ? RM(o.list) : null, amountOverrideSen: o.override != null ? RM(o.override) : null,
      isFoc: !!o.foc, supplyByOwner: !!o.owner, highlight: o.hl ?? 'NONE',
    };
  }
  const W = (trade, description, o) => line(`RN-${trade}`, description, o);
  const K = (code, description, o = {}) => { const k = CAT[code]; return line(code, description ?? k.name.replace(/^DEMO /, '').toUpperCase(), { price: k.sell, cost: k.cost, sup: k.sup, ...o }); };
  const D = (description) => ({ kind: 'DETAIL', description });
  const T = (description) => ({ kind: 'TEXT', description });
  const sec = (heading, lines, extra = {}) => ({ heading, lines: lines.filter(Boolean), ...extra });

  // AVA Residence style: carpentry + M&E + wiring (Dream Crafter). clean = every line purchasable, so all stages can complete.
  function avaFull(v, clean) {
    return [
      sec('HACKING & MASONRY WORK @ KITCHEN', [
        W('HACKING', 'HACK EXISTING KITCHEN WALL & FLOOR TILES, DISPOSE DEBRIS', { room: 'KITCHEN', price: 1800, cost: 1100, sup: 'DEMO-MASON' }),
        W('MASONRY_TILING', 'SUPPLY & LAY 600 X 600 HOMOGENEOUS TILES', { room: 'KITCHEN', m: 180 + v * 10, mu: 'SQFT', price: 12, cost: 7, sup: 'DEMO-MASON' }),
        W('WATERPROOFING', 'WATERPROOFING @ WET KITCHEN (2 COATS)', { room: 'KITCHEN', price: 950, cost: 550, sup: 'DEMO-PLUMB' }),
      ], { bandColor: '#5b6b7a' }),
      sec('WIRING WORK @ WHOLE UNIT', [
        W('ELECTRICAL', 'NEW 13A SWITCH SOCKET OUTLET POINT', { room: 'WHOLE UNIT', qty: 10 + v, price: 180, cost: 90, sup: 'DEMO-ELEC' }),
        W('ELECTRICAL', 'NEW LIGHTING POINT', { room: 'WHOLE UNIT', qty: 16 + v, price: 85, cost: 40, sup: 'DEMO-ELEC' }),
        W('ELECTRICAL', 'LED STRIP 42.6FT (COVE LIGHT)', { room: 'LIVING', m: 42.6, mu: 'FT', price: 35, override: 1065, cost: 15, sup: 'DEMO-ELEC' }),
        clean ? null : W('ELECTRICAL', 'CEILING LIGHT INSTALL ONLY (SUPPLY BY OWNER)', { room: 'WHOLE UNIT', qty: 27, price: 20, cost: 10, sup: 'DEMO-ELEC', owner: true }),
      ], { bandColor: '#2c5282' }),
      sec('LIGHTING @ LIVING & DINING', [
        K('DEMO-DOWNLIGHT', 'LED DOWNLIGHT 12W (3000K)', { room: 'LIVING', qty: 12 }),
        clean ? K('DEMO-FAN', 'CEILING FAN 52" @ MASTER', { room: 'MASTER' }) : K('DEMO-FAN', 'CEILING FAN 52" (SUPPLY BY OWNER, INSTALL ONLY)', { room: 'MASTER', owner: true, price: 0, cost: 0, sup: null }),
      ]),
      sec('PLASTER CEILING & PAINTING @ LIVING & DINING', [
        W('PLASTER_CEILING', 'L-BOX PLASTER CEILING WITH COVE LIGHT', { room: 'LIVING', m: 320, mu: 'SQFT', price: 6.5, cost: 3.8, sup: 'DEMO-PAINT' }),
        W('PAINTING', 'REPAINT WHOLE UNIT (WEATHERBOND / EASY WASH)', { room: 'WHOLE UNIT', price: 3800, cost: 2300, sup: 'DEMO-PAINT' }),
      ], { bandColor: '#6b8e23' }),
      sec('CARPENTRY WORK @ KITCHEN AREA', [
        K('DEMO-KITCHEN-BTM', 'KITCHEN BOTTOM CABINET (MELAMINE CARCASS, 3G DOOR)', { room: 'KITCHEN', m: 12.5, mu: 'FT' }),
        D('W : 12.5FT X D : 2FT X H : 2.8FT'),
        K('DEMO-SOFTCLOSE', 'SOFT CLOSE DRAWER', { room: 'KITCHEN', qty: 4, child: true }),
        K('DEMO-KITCHEN-TOP', 'KITCHEN TOP CABINET', { room: 'KITCHEN', m: 10, mu: 'FT' }),
        D('W : 10FT X D : 1FT X H : 2.5FT'),
        K('DEMO-QUARTZ', 'QUARTZ COUNTERTOP (MEASURED AFTER CABINET)', { room: 'KITCHEN', m: 12.5, mu: 'FT' }),
      ], { bandColor: '#7c4a1e' }),
      sec('CARPENTRY WORK @ MASTER BEDROOM', [
        K('DEMO-WARDROBE-SW', 'SWING DOOR WARDROBE (1 EP) @ MASTER', { room: 'MASTER' }),
        D('W : 8.2 FT X D : 2 FT X H : 9.5 FT'),
        K('DEMO-LEDCASING', 'LED CASING WITH SENSOR', { room: 'MASTER', qty: 2, child: true }),
      ], { bandColor: '#7c4a1e' }),
      clean ? null : sec('ADD ON', [
        W('PROJECT_MGMT', 'DEFECT CHECK (WAIVED)', { price: -550, hl: 'PINK' }),
        line('RN-STYLING', 'FOC 3D DESIGN (3 VIEWS)', { price: 800, foc: true }),
      ]),
    ].filter(Boolean);
  }

  // D'Clover style: full renovation with 40% carpentry / 20% M&E discounts and a showroom discount.
  function dcloverFull(v, clean) {
    return [
      sec('CARPENTRY WORK @ KITCHEN AREA (40% PROMOTION)', [
        K('DEMO-KITCHEN-BTM', null, { room: 'KITCHEN', m: 14 + v, mu: 'FT', disc: 4000 }),
        K('DEMO-KITCHEN-TOP', null, { room: 'KITCHEN', m: 12, mu: 'FT', disc: 4000 }),
        K('DEMO-SOFTCLOSE', 'SOFT CLOSE DRAWER', { room: 'KITCHEN', qty: 6, child: true, disc: 4000 }),
        K('DEMO-QUARTZ', null, { room: 'KITCHEN', m: 14, mu: 'FT', disc: 2000 }),
      ], { bandColor: '#7c4a1e' }),
      sec('CARPENTRY WORK @ BEDROOM 2 (40% PROMOTION)', [
        K('DEMO-WARDROBE-SL', 'SLIDING DOOR WARDROBE @ BEDROOM 2', { room: 'BEDROOM 2', disc: 4000 }),
        D('W : 7 FT X D : 2 FT X H : 9 FT'),
        K('DEMO-STUDY', 'STUDY TABLE WITH OPEN SHELF', { room: 'BEDROOM 2', disc: 4000 }),
        K('DEMO-TV-CAB', 'TV FEATURE CABINET', { room: 'LIVING', disc: 4000 }),
      ], { bandColor: '#7c4a1e' }),
      sec('M&E WORK @ WHOLE UNIT (20% DISCOUNT)', [
        W('ELECTRICAL', 'REWIRING WHOLE UNIT INCL. DB BOX', { room: 'WHOLE UNIT', price: 6500, cost: 3900, sup: 'DEMO-ELEC', disc: 2000 }),
        W('PLUMBING', 'CONCEALED PIPING @ KITCHEN & BATHROOMS', { room: 'WHOLE UNIT', price: 2400, cost: 1400, sup: 'DEMO-PLUMB', disc: 2000 }),
        W('AIRCON_INSTALL', 'AIRCON PIPING & INSTALLATION', { room: 'WHOLE UNIT', qty: 3, price: 450, cost: 250, sup: 'DEMO-AIRCON', disc: 2000 }),
        W('ALUMINIUM_GLASS', 'SLIDING DOOR @ YARD (ALUMINIUM, 6MM TINTED)', { room: 'YARD', price: 2200, cost: 1400, sup: 'DEMO-ALUM' }),
        W('GRILL', 'WINDOW GRILL (MILD STEEL)', { room: 'WHOLE UNIT', m: 60, mu: 'SQFT', price: 18, cost: 11, sup: 'DEMO-ALUM' }),
      ], { bandColor: '#2c5282' }),
      sec('APPLIANCES @ KITCHEN', [
        K('DEMO-HOODHOB', null, { room: 'KITCHEN' }),
        K('DEMO-FRIDGE', null, { room: 'KITCHEN' }),
        K('DEMO-WASHER', null, { room: 'YARD' }),
      ], { bandColor: '#2c3e66' }),
      sec('LOOSE FURNITURE @ LIVING & DINING', [
        K('DEMO-SOFA-3S', null, { room: 'LIVING' }),
        K('DEMO-COFFEE', null, { room: 'LIVING' }),
        K('DEMO-DINING-4', null, { room: 'DINING' }),
      ], { bandColor: '#2f5d50' }),
      sec('CURTAIN WORK (DAY & NIGHT) 35.9 FT', [
        K('DEMO-CURTAIN', 'DAY & NIGHT CURTAIN', { room: 'WHOLE UNIT', m: 35.9, mu: 'FT' }),
        D('MASTER 10 FT / BEDROOM 2 8 FT / LIVING 17.9 FT'),
      ], { bandColor: '#8a3b5c' }),
      clean ? null : sec('ADD ON', [
        line('RN-STYLING', 'FOC STYLING CONSULTATION', { price: 600, foc: true }),
        W('CLEANING', 'POST RENOVATION CLEANING (WAIVED)', { price: -380, hl: 'PINK' }),
      ]),
    ].filter(Boolean);
  }

  // Carpentry only (Dream Crafter).
  function carpentryOnly(v) {
    return [
      sec('CARPENTRY WORK @ KITCHEN AREA', [
        K('DEMO-KITCHEN-BTM', null, { room: 'KITCHEN', m: 10 + v, mu: 'FT' }),
        D(`W : ${10 + v}FT X D : 2FT X H : 2.8FT`),
        K('DEMO-SOFTCLOSE', 'SOFT CLOSE DRAWER', { room: 'KITCHEN', qty: 3, child: true }),
        K('DEMO-KITCHEN-TOP', null, { room: 'KITCHEN', m: 8 + v, mu: 'FT' }),
        K('DEMO-QUARTZ', null, { room: 'KITCHEN', m: 10 + v, mu: 'FT' }),
      ], { bandColor: '#7c4a1e' }),
      sec('CARPENTRY WORK @ MASTER BEDROOM', [
        K('DEMO-WARDROBE-SW', 'SWING DOOR WARDROBE (1 EP) @ MASTER', { room: 'MASTER' }),
        D('W : 8.2 FT X D : 2 FT X H : 9.5 FT'),
      ], { bandColor: '#7c4a1e' }),
      sec('CARPENTRY WORK @ LIVING & FOYER', [
        K('DEMO-TV-CAB', null, { room: 'LIVING' }),
        K('DEMO-SHOE-CAB', null, { room: 'FOYER' }),
      ], { bandColor: '#7c4a1e' }),
    ];
  }

  // Skyline Embassy / KL 48 style Airbnb package (The Conts). promo: standard price beside the promotion price.
  function airbnbPackage(v, { promo = false, appliances = true, builtin = true } = {}) {
    const P = (code, desc, o = {}) => {
      const k = CAT[code];
      return K(code, desc, promo ? { ...o, list: Math.round(k.sell * 1.25), price: k.sell } : o);
    };
    return [
      sec('LIVING AREA', [
        P('DEMO-SOFA-3S', null, { room: 'LIVING' }), P('DEMO-COFFEE', null, { room: 'LIVING' }),
        appliances ? P('DEMO-TV55', null, { room: 'LIVING' }) : null,
        P('DEMO-CURTAIN', 'DAY & NIGHT CURTAIN', { room: 'LIVING', m: 14, mu: 'FT' }),
      ], { bandColor: '#2f5d50' }),
      sec('MASTER BEDROOM', [
        P('DEMO-BED-Q', null, { room: 'MASTER' }), P('DEMO-MATT-Q', null, { room: 'MASTER' }), P('DEMO-LINEN-Q', null, { room: 'MASTER', qty: 2 }),
        builtin ? P('DEMO-WARDROBE-SL', 'SLIDING DOOR WARDROBE', { room: 'MASTER' }) : null,
      ], { bandColor: '#2f5d50' }),
      appliances ? sec('KITCHEN & YARD', [
        P('DEMO-FRIDGE', null, { room: 'KITCHEN' }), P('DEMO-WASHER', null, { room: 'YARD' }), P('DEMO-HOODHOB', null, { room: 'KITCHEN' }),
      ], { bandColor: '#2c3e66' }) : null,
      sec('AIRBNB SET UP', [
        P('DEMO-AMENITY', null, { room: 'WHOLE UNIT', qty: 1 + (v % 2) }), P('DEMO-DECO', null, { room: 'WHOLE UNIT' }),
        line('RN-AIRBNB_SETUP', 'AIRBNB LISTING SET UP & STYLING', { room: 'WHOLE UNIT', price: 1200, cost: 500, sup: 'DEMO-CLEAN', ...(promo ? { list: 1500 } : {}) }),
        line('RN-PHOTOSHOOT', 'PROFESSIONAL PHOTOSHOOT (20 PHOTOS)', { room: 'WHOLE UNIT', price: 800, cost: 350, sup: 'DEMO-CLEAN', ...(promo ? { list: 1000 } : {}) }),
      ], { bandColor: '#8a3b5c' }),
    ].filter(Boolean);
  }

  /* ---------------- package template ---------------- */
  let skylineTemplateId = null;
  try {
    const name = 'DEMO Skyline Embassy Type A Classic';
    const list = ok(await api('GET', '/api/scm/renovation/templates?all=1'), 'list templates').templates ?? [];
    const found = list.find((t) => t.name === name);
    if (found) {
      skylineTemplateId = found.id;
      const reactivated = found.active === false;
      if (reactivated) ok(await api('PUT', `/api/scm/renovation/templates/${found.id}`, { active: true }), 'reactivate template');
      M.templates.push({ id: found.id, name, created: false, reactivated });
    } else {
      const t = ok(await api('POST', '/api/scm/renovation/templates', {
        name, brandId: brandId('The Conts'), description: 'Demo data: Skyline Embassy Type A, fully furnished Airbnb package', printFormat: 'QTY_ONLY',
        termTemplateId: termId('30'), promoLines: [{ text: 'FREE PROFESSIONAL PHOTOSHOOT FOR BOOKINGS THIS MONTH', color: '#b91c1c' }],
        sections: airbnbPackage(0, {}),
      }), 'create package template');
      skylineTemplateId = t.id;
      M.templates.push({ id: t.id, name, created: true });
    }
  } catch (e) { warn('package template', e); }
  save();

  /* ---------------- the 20 projects ---------------- */
  // stage: design | accepted | signed | hardware | furniture | appliances | handover | handed_over | airbnb_skip
  const PROJECTS = [
    { name: 'DEMO - AVA KIARA BAY B31-09 MR FOO', building: 'AVA KIARA BAY', unit: 'B31-09', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => avaFull(v, false), stage: 'design', quote: 'r2', base: 40, docDiscount: [690, 'SHOWROOM DISCOUNT'] },
    { name: "DEMO - D'CLOVER C-12-03 MS TAN", building: "D'CLOVER", unit: 'C-12-03', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => dcloverFull(v, false), stage: 'design', quote: 'draft', base: 45, docDiscount: [1500, 'SHOWROOM DISCOUNT'], format: 'DISCOUNT' },
    { name: 'DEMO - SKYLINE EMBASSY A-23-11 MR LIM', building: 'SKYLINE EMBASSY', unit: 'A-23-11', type: 'airbnb_package', brand: 'The Conts', terms: '30', template: true, stage: 'design', quote: 'sent', base: 30 },
    { name: 'DEMO - KL 48 B-17-05 MR WONG', building: 'KL 48', unit: 'B-17-05', type: 'airbnb_package', brand: 'The Conts', terms: '30', content: (v) => airbnbPackage(v, { promo: true }), stage: 'accepted', base: 25, format: 'PROMO_STANDARD', promo: 'OPENING PROMOTION: SAVE 20% ON THE FULL PACKAGE' },
    { name: 'DEMO - AVA RESIDENCE A-08-02 MDM CHONG', building: 'AVA RESIDENCE', unit: 'A-08-02', type: 'carpentry_only', brand: 'Dream Crafter', terms: '15', content: (v) => carpentryOnly(v), stage: 'accepted', base: 28 },
    { name: "DEMO - D'CLOVER D-05-10 MR RAJ", building: "D'CLOVER", unit: 'D-05-10', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => dcloverFull(v, false), stage: 'accepted', base: 32, docDiscount: [1200, 'SHOWROOM DISCOUNT'], format: 'DISCOUNT' },
    { name: 'DEMO - AVA RESIDENCE B-21-07 MR ONG', building: 'AVA RESIDENCE', unit: 'B-21-07', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => avaFull(v, false), stage: 'signed', paid: false, pos: true, base: 12 },
    { name: 'DEMO - SKYLINE EMBASSY B-30-02 MS LEE', building: 'SKYLINE EMBASSY', unit: 'B-30-02', type: 'airbnb_package', brand: 'The Conts', terms: '30', template: true, stage: 'signed', paid: true, pos: true, base: 10 },
    { name: 'DEMO - KL 48 A-09-12 MR NG', building: 'KL 48', unit: 'A-09-12', type: 'carpentry_only', brand: 'Dream Crafter', terms: '15', content: (v) => carpentryOnly(v), stage: 'signed', paid: true, pos: true, base: 14 },
    { name: "DEMO - D'CLOVER A-15-06 MR KUMAR", building: "D'CLOVER", unit: 'A-15-06', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => dcloverFull(v, false), stage: 'signed', paid: true, pos: false, base: 16, docDiscount: [1000, 'SHOWROOM DISCOUNT'], format: 'DISCOUNT' },
    { name: 'DEMO - AVA KIARA BAY C-11-01 MR CHAN', building: 'AVA KIARA BAY', unit: 'C-11-01', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => avaFull(v, false), stage: 'hardware', received: 2, permit: 'skip', base: -9 },
    { name: "DEMO - D'CLOVER B-07-08 MS YAP", building: "D'CLOVER", unit: 'B-07-08', type: 'full_renovation', brand: 'Dream Crafter', terms: '15', content: (v) => dcloverFull(v, true), stage: 'hardware', received: 1, permit: 'tick', base: -5, format: 'DISCOUNT' },
    { name: 'DEMO - AVA RESIDENCE C-19-03 MR TEO', building: 'AVA RESIDENCE', unit: 'C-19-03', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => avaFull(v, true), stage: 'hardware', received: 0, permit: 'tick', base: -2, billTo: 2 },
    { name: 'DEMO - KL 48 C-02-15 MR HO', building: 'KL 48', unit: 'C-02-15', type: 'full_renovation', brand: 'The Conts', terms: '30', content: (v) => avaFull(v, true), stage: 'hardware', received: 3, permit: 'skip', base: -14, billTo: 2, paidTo: 2 },
    { name: 'DEMO - SKYLINE EMBASSY C-28-09 MR GOH', building: 'SKYLINE EMBASSY', unit: 'C-28-09', type: 'full_renovation', brand: 'The Conts', terms: '30', content: (v) => dcloverFull(v, true), stage: 'furniture', vo: 'add', base: -35, billTo: 2, paidTo: 2, afterVoBill: true },
    { name: "DEMO - D'CLOVER E-10-01 MS LOW", building: "D'CLOVER", unit: 'E-10-01', type: 'full_renovation', brand: 'Dream Crafter', terms: '30', content: (v) => dcloverFull(v, true), stage: 'furniture', vo: 'omit', base: -32, billTo: 2, paidTo: 1, format: 'DISCOUNT' },
    { name: 'DEMO - AVA KIARA BAY A-05-05 MR SIM', building: 'AVA KIARA BAY', unit: 'A-05-05', type: 'full_renovation', brand: 'Dream Crafter', terms: '15', content: (v) => dcloverFull(v, true), stage: 'appliances', vo: 'sent', base: -42, billTo: 2, paidTo: 2 },
    { name: 'DEMO - KL 48 D-12-08 MR TAN', building: 'KL 48', unit: 'D-12-08', type: 'full_renovation', brand: 'The Conts', terms: '30', content: (v) => dcloverFull(v, true), stage: 'handover', base: -60, billTo: 3, paidTo: 2 },
    { name: 'DEMO - AVA RESIDENCE D-03-11 MS KHOO', building: 'AVA RESIDENCE', unit: 'D-03-11', type: 'carpentry_only', brand: 'Dream Crafter', terms: '15', content: (v) => carpentryOnly(v), stage: 'handed_over', base: -75, billTo: 4, paidTo: 4 },
    { name: 'DEMO - SKYLINE EMBASSY D-16-04 MR CHIA', building: 'SKYLINE EMBASSY', unit: 'D-16-04', type: 'airbnb_package', brand: 'The Conts', terms: '30', content: (v) => airbnbPackage(v, { appliances: false, builtin: false }), stage: 'airbnb_skip', base: 3, billTo: 2, paidTo: 1 },
  ];
  const SALES = ['MK', 'ALICIA', 'JASON', 'WEI LING'];
  const STAGE_ORDER = ['design', 'key_permit', 'defect_check', 'shop_drawings', 'hardware', 'furniture', 'appliances', 'soft_furnishing', 'handover', 'warranty', 'closed'];

  const project = async (id) => ok(await api('GET', `/api/renovation/${id}`), 'read project');
  const customerOf = (name) => `DEMO - ${name.split(' ').slice(-2).join(' ')}`;

  async function uploads(entry, kinds) {
    entry.files = entry.files ?? {};
    for (const kind of kinds) {
      if (entry.files[kind]) continue;
      const blob = await placeholderPng(`${entry.code} ${kind.replace(/_/g, ' ')}`, kind.includes('signature') ? '#1f2937' : '#4a5568');
      const r = ok(await api('POST', `/api/renovation/${entry.id}/files?kind=${kind}`, blob, { contentType: 'image/png' }), `upload ${kind}`);
      entry.files[kind] = r.key;
    }
    return entry.files;
  }

  /** Receive on site every open PO line whose SO item is in `soItemIds` (all open lines when null). */
  async function receive(entry, soItemIds, label) {
    const open = ok(await api('GET', `/api/scm/site-receipts/projects/${entry.id}/open-lines`), 'read open PO lines').data ?? [];
    const pick = open.filter((l) => l.remaining > 0 && (!soItemIds || soItemIds.includes(l.so_item_id)));
    if (!pick.length) return 0;
    const files = await uploads(entry, ['after', 'in_place', 'supplier_do', 'supervisor_signature']);
    const goods = pick.some((l) => !['WORKS', 'SERVICE'].includes(String(l.category_group ?? '').toUpperCase()));
    const room = pick.find((l) => l.room)?.room ?? 'WHOLE UNIT';
    const photos = [
      { r2Key: files.after, kind: 'after', location: room, takenAt: new Date().toISOString() },
      ...(goods ? [{ r2Key: files.in_place, kind: 'in_place', location: room }, { r2Key: files.supplier_do, kind: 'supplier_do', location: room }] : []),
    ];
    const r = ok(await api('POST', '/api/scm/site-receipts', {
      projectId: entry.id, lines: pick.map((l) => ({ poItemId: l.po_item_id, qty: l.remaining })), photos,
      supervisorSignatureR2Key: files.supervisor_signature, notes: `DEMO site receipt: ${label}`,
    }, { headers: { 'idempotency-key': crypto.randomUUID() } }), `site receipt (${label})`);
    for (const g of r.created ?? []) entry.grns.push({ id: g.id, grnNumber: g.grnNumber ?? g.grn_number ?? null });
    return pick.length;
  }

  async function billNext(entry, pay) {
    const b = ok(await api('GET', `/api/scm/renovation/sales-orders/${encodeURIComponent(entry.soDocNo)}/billing`), 'read billing');
    const next = (b.instalments ?? []).find((i) => i.isNext);
    if (!next) return null;
    const r = ok(await api('POST', `/api/scm/renovation/sales-orders/${encodeURIComponent(entry.soDocNo)}/instalments/${next.id}/bill`,
      { invoiceDate: TODAY, expectedAmountSen: next.amountSen }), `bill instalment ${next.seq}`);
    const inv = { seq: next.seq, kind: r.kind, amountSen: r.amountSen, salesInvoiceId: r.salesInvoiceId ?? null, invoiceNumber: r.invoiceNumber ?? null, creditNoteId: r.creditNoteId ?? null, noteNumber: r.noteNumber ?? null, posting: r.posting?.status ?? null };
    entry.bills.push(inv);
    if (pay && r.kind === 'INVOICE' && r.salesInvoiceId) {
      const p = ok(await api('POST', `/api/scm/sales-invoices/${r.salesInvoiceId}/payments`, { paidAt: TODAY, method: 'transfer', amountSen: r.amountSen, note: 'DEMO payment' }), `pay instalment ${next.seq}`);
      entry.payments.push({ salesInvoiceId: r.salesInvoiceId, paymentId: p.payment?.id ?? null, amountSen: r.amountSen });
    }
    return inv;
  }

  async function tick(entry, item) {
    if (item.status === 'done' || (item.skip_reason && item.skip_reason.trim().length >= 3)) return;
    ok(await api('POST', `/api/projects/checklist/${item.id}/status`, { status: 'done' }), `tick ${item.item_key ?? item.title}`);
  }

  /** Make a stage complete the way a person would: tick its checklist, finish its internal tasks, receive its lines, mark it done. */
  async function completeStage(entry, key, opts = {}) {
    let p = await project(entry.id);
    const st = p.stages.find((s) => s.key === key);
    if (!st || st.state === 'skipped' || st.state === 'done') return;
    for (const item of p.checklist.filter((c) => c.stage_key === key)) {
      if (item.item_key === 'renovation_permit' && opts.permit === 'skip') {
        if (item.status !== 'done' && !item.skip_reason) ok(await api('POST', `/api/renovation/checklist/${item.id}/skip`, { reason: 'Management office needs no permit for this scope (DEMO)' }), 'skip permit');
        continue;
      }
      if (item.item_key === 'handover_signed') continue;
      await tick(entry, item);
    }
    if (st.state === 'not_started') ok(await api('POST', `/api/renovation/${entry.id}/stages/${key}/start`), `start ${key}`);
    if (st.ownedLineIds?.length) await receive(entry, st.ownedLineIds, `${key} complete`);
    p = await project(entry.id);
    for (const t of p.tasks.filter((t) => t.stage_key === key && t.fulfilment_kind === 'internal' && t.status !== 'done' && t.status !== 'skipped')) {
      ok(await api('POST', `/api/renovation/trade-tasks/${t.id}/complete`, { note: 'DEMO' }), `finish task ${t.label}`);
    }
    if (key === 'handover' && !p.handover) await signHandover(entry);
    ok(await api('POST', `/api/renovation/${entry.id}/stages/${key}/complete`), `complete ${key}`);
  }

  async function startStage(entry, key) {
    const p = await project(entry.id);
    const st = p.stages.find((s) => s.key === key);
    if (st && st.state === 'not_started') ok(await api('POST', `/api/renovation/${entry.id}/stages/${key}/start`), `start ${key}`);
  }

  async function signHandover(entry) {
    const files = await uploads(entry, ['customer_signature']);
    ok(await api('POST', `/api/renovation/${entry.id}/handover`, {
      customerSignerName: customerOf(entry.name).replace(/^DEMO - /, ''), customerSignatureR2Key: files.customer_signature,
      keysReturned: 2, accessCardsReturned: 2, depositRefundNote: 'Renovation deposit refund requested from management (DEMO)', notes: 'DEMO handover',
    }), 'sign handover');
    entry.handover = true;
  }

  async function planDates(entry, base) {
    const p = await project(entry.id);
    const order = (t) => STAGE_ORDER.indexOf(t.stage_key) * 1000 + Number(t.seq ?? 0);
    const tasks = [...p.tasks].filter((t) => t.status !== 'skipped').sort((a, b) => order(a) - order(b));
    let hw = 0, ho = 0;
    for (const t of tasks) {
      let start;
      if (t.stage_key === 'handover') { start = addDays(TODAY, base + 34 + ho * 2); ho++; }
      else { start = addDays(TODAY, base + hw * 3); hw++; }
      const r = await api('PATCH', `/api/renovation/trade-tasks/${t.id}`, { plannedStart: start, plannedEnd: addDays(start, 2) });
      if (r.status !== 200) warn(`${entry.code} task dates ${t.label}`, new Step('plan', r));
    }
    for (const [key, from, len] of [['hardware', base, Math.max(hw * 3, 6)], ['handover', base + 34, 8]]) {
      const r = await api('PATCH', `/api/renovation/${entry.id}/stages/${key}`, { plannedStart: addDays(TODAY, from), plannedEnd: addDays(TODAY, from + len) });
      if (r.status !== 200 && r.status !== 404) warn(`${entry.code} stage dates ${key}`, new Step('plan', r));
    }
  }

  let n = 0;
  for (const spec of PROJECTS) {
    const v = n++;
    const entry = { id: null, code: null, name: spec.name, scenario: spec.stage, quotations: [], soDocNo: null, purchaseOrders: [], bills: [], payments: [], vos: [], grns: [], snags: [], handover: false, files: {}, soStatus: null };
    M.projects.push(entry);
    log(`[${v + 1}/${PROJECTS.length}] ${spec.name} (${spec.stage})`);
    try {
      const created = ok(await api('POST', '/api/renovation', {
        name: spec.name, projectTypeId: typeId(spec.type), customerKind: 'customer', customerName: customerOf(spec.name),
        customerPhone: `+6012${String(3000000 + v * 7919).slice(0, 7)}`, building: spec.building, unitNo: spec.unit,
        salespersonName: SALES[v % SALES.length], plannedHandoverDate: addDays(TODAY, spec.base + 50), notes: 'Demo data (renovation-demo-seed). Safe to archive.',
      }), 'create project');
      entry.id = created.id; entry.code = created.code; save();

      /* quotation */
      const header = {
        customerName: customerOf(spec.name), attention: customerOf(spec.name).replace(/^DEMO - /, ''), building: spec.building, unitNo: spec.unit,
        preparedBy: SALES[v % SALES.length], docDate: addDays(TODAY, Math.min(-3, spec.base - 30)), termTemplateId: termId(spec.terms),
        ...(spec.format ? { printFormat: spec.format } : {}),
        ...(spec.docDiscount ? { docDiscountSen: RM(spec.docDiscount[0]), docDiscountLabel: spec.docDiscount[1] } : {}),
        ...(spec.promo ? { promoLines: [{ text: spec.promo, color: '#b91c1c' }] } : {}),
      };
      const qBody = spec.template && skylineTemplateId
        ? { projectId: entry.id, templateId: skylineTemplateId, header: { ...header, termTemplateId: termId(spec.terms) } }
        : { projectId: entry.id, brandId: brandId(spec.brand), header, sections: (spec.content ?? ((x) => airbnbPackage(x, {})))(v) };
      const q = ok(await api('POST', '/api/scm/renovation/quotations', qBody), 'create quotation');
      const qEntry = { id: q.id, quoteNo: q.quoteNo, docNos: [q.quoteNo], status: 'DRAFT' };
      entry.quotations.push(qEntry); save();
      let qv = ok(await api('GET', `/api/scm/renovation/quotations/${q.id}`), 'read quotation');
      let version = qv.quotation.version;
      const setQ = async (status) => { const r = ok(await api('POST', `/api/scm/renovation/quotations/${q.id}/status`, { status, version }), `quotation ${status}`); version = r.version; qEntry.status = status; };

      if (spec.quote === 'draft') { await planDates(entry, spec.base); save(); continue; }
      await setQ('SENT');
      if (spec.quote === 'r2') {
        const r2 = ok(await api('POST', `/api/scm/renovation/quotations/${q.id}/revisions`, { version }), 'new revision R2');
        version = r2.version; qEntry.docNos.push(r2.docNo); qEntry.status = 'DRAFT';
        qv = ok(await api('GET', `/api/scm/renovation/quotations/${q.id}`), 'read R2');
        // R2: the customer dropped the waived/FOC add-ons and asked for a TV cabinet; last amended today.
        const sections = avaFull(v, true);
        sections.push(sec('CARPENTRY WORK @ LIVING (ADDED IN R2)', [K('DEMO-TV-CAB', 'TV FEATURE CABINET WITH LED CASING', { room: 'LIVING' })], { bandColor: '#7c4a1e' }));
        const s = ok(await api('PUT', `/api/scm/renovation/quotations/${q.id}`, { version, header: { ...header, lastAmended: TODAY }, sections }), 'save R2');
        version = s.version;
      }
      if (spec.stage === 'design') { await planDates(entry, spec.base); save(); continue; }
      await setQ('ACCEPTED');
      if (spec.stage === 'accepted') { await planDates(entry, spec.base); save(); continue; }

      /* contract */
      const conv = ok(await api('POST', `/api/scm/renovation/quotations/${q.id}/convert`, { version, soDate: addDays(TODAY, Math.min(-1, spec.base - 20)) }), 'convert to sales order');
      entry.soDocNo = conv.docNo; entry.contractSen = conv.contractSen; qEntry.status = 'CONVERTED'; save();
      const so = encodeURIComponent(conv.docNo);
      const billTo = spec.billTo ?? 1;
      const paidTo = spec.paidTo ?? (spec.paid === false ? 0 : billTo);

      if (spec.pos !== false) {
        const r = ok(await api('POST', `/api/scm/renovation/sales-orders/${so}/po-split`, { poDate: addDays(TODAY, Math.min(-1, spec.base - 15)), expectedAt: addDays(TODAY, spec.base + 5) }), 'raise purchase orders');
        for (const po of r.created ?? []) entry.purchaseOrders.push({ id: po.id, poNumber: po.poNumber, supplierId: po.supplierId });
        save();
      }
      await planDates(entry, spec.base);
      await billNext(entry, paidTo >= 1); save();
      if (spec.stage === 'signed') continue;

      if (spec.stage === 'airbnb_skip') {
        await completeStage(entry, 'design');
        const sk = await api('POST', `/api/renovation/${entry.id}/stages/shop_drawings/skip`, { reason: 'Standard package layout: no shop drawings needed (DEMO)' });
        if (sk.status !== 200) warn(`${entry.code} manual skip`, new Step('skip shop drawings', sk));
        await completeStage(entry, 'key_permit', { permit: 'skip' });
        await completeStage(entry, 'furniture');
        await startStage(entry, 'soft_furnishing');
        await billNext(entry, paidTo >= 2); save();
        continue;
      }

      /* through the gate: design, keys & permit, defect check, shop drawings */
      for (const key of ['design', 'key_permit', 'defect_check', 'shop_drawings']) await completeStage(entry, key, { permit: spec.permit ?? 'tick' });
      ok(await api('POST', `/api/scm/renovation/sales-orders/${so}/status`, { status: 'RENO_IN_PROGRESS', note: 'Works started (DEMO)' }), 'contract in progress');
      entry.soStatus = 'RENO_IN_PROGRESS';
      const typeHasHardware = (await project(entry.id)).stages.find((s) => s.key === 'hardware')?.state !== 'skipped';
      if (typeHasHardware) await startStage(entry, 'hardware');
      for (let i = 2; i <= Math.min(billTo, 2); i++) await billNext(entry, paidTo >= i);
      save();

      if (spec.stage === 'hardware') {
        const p = await project(entry.id);
        const pre = p.tasks.find((t) => t.trade_code === 'INTERNAL:pre_reno_delivery');
        if (pre) ok(await api('POST', `/api/renovation/trade-tasks/${pre.id}/complete`, { note: 'DEMO' }), 'pre-reno delivery done');
        const trades = p.tasks.filter((t) => t.stage_key === 'hardware' && t.fulfilment_kind === 'po').sort((a, b) => a.seq - b.seq);
        let done = 0;
        for (const t of trades) {
          if (done >= (spec.received ?? 0)) break;
          if ((t.soItemIds ?? []).length && (await receive(entry, t.soItemIds, t.label)) > 0) done++;
        }
        save();
        continue;
      }

      /* furniture and later: hardware complete */
      if (typeHasHardware) await completeStage(entry, 'hardware');
      await startStage(entry, 'furniture');
      save();

      if (spec.vo) {
        const vo = ok(await api('POST', `/api/scm/renovation/sales-orders/${so}/variation-orders`, { title: spec.vo === 'omit' ? 'CUSTOMER CANCELLED TV CABINET' : 'ADDITIONAL CARPENTRY & CURTAIN' }), 'create VO');
        const voEntry = { id: vo.id, voNo: vo.voNo, status: 'DRAFT', kind: spec.vo };
        entry.vos.push(voEntry); save();
        let vv = ok(await api('GET', `/api/scm/renovation/variation-orders/${vo.id}`), 'read VO').version;
        let sections;
        if (spec.vo === 'omit') {
          const contract = ok(await api('GET', `/api/scm/renovation/sales-orders/${so}`), 'read contract');
          const target = contract.sections.flatMap((s) => s.lines).find((l) => l.itemCode === 'DEMO-TV-CAB');
          sections = [sec('OMIT', [{ kind: 'ITEM', description: 'OMIT: TV FEATURE CABINET', voChange: 'OMIT', omitTargetLineId: target?.id }])];
        } else {
          sections = [sec('ADDITIONAL WORK', [
            K('DEMO-SHOE-CAB', 'ADD: SHOE CABINET @ FOYER', { room: 'FOYER' }),
            K('DEMO-LEDCASING', 'ADD: LED CASING @ WARDROBE', { room: 'BEDROOM 2', qty: 2 }),
            K('DEMO-CURTAIN', 'ADD: DAY & NIGHT CURTAIN @ STUDY', { room: 'STUDY', m: 8, mu: 'FT' }),
          ])];
        }
        vv = ok(await api('PUT', `/api/scm/renovation/variation-orders/${vo.id}`, { version: vv, docDate: TODAY, sections }), 'save VO').version;
        vv = ok(await api('POST', `/api/scm/renovation/variation-orders/${vo.id}/status`, { status: 'SENT', version: vv }), 'send VO').version;
        voEntry.status = 'SENT';
        if (spec.vo !== 'sent') {
          const ap = ok(await api('POST', `/api/scm/renovation/variation-orders/${vo.id}/approve`, { version: vv, signedName: customerOf(spec.name).replace(/^DEMO - /, ''), signedAt: TODAY }), 'approve VO');
          voEntry.status = 'APPROVED'; voEntry.netSen = ap.netSen; voEntry.poFlags = (ap.flags ?? []).length;
          if (spec.vo === 'add') {
            const r = ok(await api('POST', `/api/scm/renovation/sales-orders/${so}/po-split`, { poDate: TODAY, expectedAt: addDays(TODAY, 10) }), 'raise POs for the VO lines');
            for (const po of r.created ?? []) entry.purchaseOrders.push({ id: po.id, poNumber: po.poNumber, supplierId: po.supplierId, fromVo: vo.voNo });
          }
        }
        save();
      }
      if (spec.afterVoBill) await billNext(entry, false);

      if (spec.stage === 'furniture') {
        const p = await project(entry.id);
        const kitchen = (p.lines ?? []).filter((l) => /^DEMO-KITCHEN/.test(l.itemCode ?? l.item_code ?? '')).map((l) => l.soItemId ?? l.so_item_id);
        if (kitchen.length) await receive(entry, kitchen, 'kitchen cabinets delivered');
        save();
        continue;
      }

      await completeStage(entry, 'furniture');
      await startStage(entry, 'appliances');
      if (spec.stage === 'appliances') {
        const p = await project(entry.id);
        const fridge = (p.lines ?? []).filter((l) => (l.itemCode ?? l.item_code) === 'DEMO-FRIDGE').map((l) => l.soItemId ?? l.so_item_id);
        if (fridge.length) await receive(entry, fridge, 'fridge delivered');
        save();
        continue;
      }

      for (const key of ['appliances', 'soft_furnishing']) await completeStage(entry, key);
      if (billTo >= 3) await billNext(entry, paidTo >= 3);
      await startStage(entry, 'handover');
      if (spec.stage === 'handover') {
        const snag = ok(await api('POST', `/api/renovation/${entry.id}/snags`, { location: 'MASTER BATHROOM', description: 'Grout stain on shower floor, re-grout and clean (DEMO)', phase: 'snag' }), 'add snag');
        entry.snags.push({ id: snag.id, closed: false });
        const p = await project(entry.id);
        const t = p.tasks.find((x) => x.trade_code === 'INTERNAL:post_reno_cleaning');
        if (t) ok(await api('POST', `/api/renovation/trade-tasks/${t.id}/complete`, { note: 'DEMO' }), 'post reno cleaning done');
        save();
        continue;
      }

      /* handed over */
      const snag = ok(await api('POST', `/api/renovation/${entry.id}/snags`, { location: 'KITCHEN', description: 'Cabinet door hinge loose, adjusted (DEMO)', phase: 'snag' }), 'add snag');
      entry.snags.push({ id: snag.id, closed: true });
      ok(await api('POST', `/api/renovation/snags/${snag.id}/close`), 'close snag');
      await completeStage(entry, 'handover');
      if (billTo >= 4) await billNext(entry, paidTo >= 4);
      for (const s of ['RENO_COMPLETED']) { ok(await api('POST', `/api/scm/renovation/sales-orders/${so}/status`, { status: s, note: 'Handed over (DEMO)' }), 'contract completed'); entry.soStatus = s; }
      await startStage(entry, 'warranty');
      save();
    } catch (e) {
      warn(`${entry.code ?? spec.name}`, e);
      save();
    }
  }

  /* ---------------- summary ---------------- */
  M.finishedAt = new Date().toISOString();
  save();
  const count = (f) => M.projects.reduce((s, p) => s + f(p), 0);
  const summary = {
    projects: M.projects.filter((p) => p.id).length,
    quotations: count((p) => p.quotations.length),
    salesOrders: count((p) => (p.soDocNo ? 1 : 0)),
    purchaseOrders: count((p) => p.purchaseOrders.length),
    invoices: count((p) => p.bills.filter((b) => b.kind === 'INVOICE').length),
    payments: count((p) => p.payments.length),
    variationOrders: count((p) => p.vos.length),
    siteReceipts: count((p) => p.grns.length),
    snags: count((p) => p.snags.length),
    handovers: count((p) => (p.handover ? 1 : 0)),
    suppliersCreated: M.suppliers.filter((s) => s.created).length,
    skusCreated: M.products.filter((s) => s.created).length,
    warnings: M.warnings.length,
  };
  M.summary = summary;
  save();
  log('\nDone.', JSON.stringify(summary));
  for (const p of M.projects) log(`  ${p.code ?? '(not created)'}  ${p.name}  ${p.scenario}${p.soDocNo ? `  ${p.soDocNo}` : ''}`);
  if (M.warnings.length) { log('\nWarnings:'); for (const w of M.warnings) log(`  - ${w}`); }
  if (!HOST) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(M, null, 2)], { type: 'application/json' }));
      a.download = `renovation-demo-manifest-${TODAY}.json`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* the manifest is still in localStorage and in window.renovationDemoManifest */ }
    log(`The manifest is saved in localStorage['${MANIFEST_KEY}'], in window.renovationDemoManifest, and was offered as a download.`);
  }
  return { manifest: M, summary };
})();
