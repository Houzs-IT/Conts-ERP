"""Hin Lim SKUs from Houzs Century's CRM product list (owner, 19 Nov 2026).

Usage (from the repo root):
  python -I -X utf8 docs/catalog-import/crm-hinlim/build.py <Houz Century CRM Product List.xlsx> \
      docs/catalog-import/crm-hinlim/existing-products-2026-11-19.json <repo root>

Reads sheet RptSKUEnquiry, keeps SKU Type = SALES, and writes
  migrations-pg/0346_crm_hinlim_skus.sql       (the import; edit this script, not the migration)
  docs/catalog-import/crm-hinlim/review.xlsx   (for the owner: SKUs, Summary, Rules, Questions)
existing-products-*.json is a read-only snapshot of scm.mfg_products (code, name) on production, used only for the
review's "model name already in an existing product" column.
"""
import sys, os, re, json, hashlib, collections
from decimal import Decimal, ROUND_HALF_UP
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

src_xlsx, existing_json, root = sys.argv[1:4]
TAG = 'crm-hinlim 2026-11-19'
TODAY = '2026-11-19'
MIGRATION = 'migrations-pg/0346_crm_hinlim_skus.sql'
COMPANY_ID = 1
SUPPLIER_ID = 'f98aa7d5-2bf3-4543-b0ff-cbbc4c5f9360'
SUPPLIER_CODE = '400-H004'
SUPPLIER_NAME = 'HIN LIM FURNITURE MANUFACTURER SDN BHD'
SUPPLIER_SHORT = 'HLM'

# Sub-category rules, first match wins. Each rule: (sub-category code, keyword regex matched as whole words on the
# upper-cased description). The order carries the decisions: "BED WITH STORAGE" is a bed, "SIDE TABLE WITH DRAWER" a
# table, "DINING TABLE" dining, "SOFA BED" a sofa.
RULES = [
    ('SOFA', r'SOFA BED'),
    ('SOFA', r'SOFA'),
    ('SOFA', r'RECLINER'),
    ('SOFA', r'LOUNGE CHAIR'),
    ('SOFA', r'OTTOMAN'),
    ('BEDFRAME', r'BEDFRAME'),
    ('BEDFRAME', r'BED FRAME'),
    ('BEDFRAME', r'HEADBOARD'),
    ('BEDFRAME', r'DIVAN'),
    ('BEDFRAME', r'BED'),
    ('MATTRESS', r'MATTRESS'),
    ('TABLES', r'DRESSING TABLE'),
    ('DINING', r'DINING'),
    ('DINING', r'COUNTER TABLE'),
    ('DINING', r'EXT TABLE'),
    ('DINING', r'CHAIR'),
    ('DINING', r'STOOL'),
    ('DINING', r'BENCH'),
    ('TABLES', r'TABLE'),
    ('TABLES', r'DESK'),
    ('LOOSE_STORAGE', r'CABINET'),
    ('LOOSE_STORAGE', r'SIDEBOARD'),
    ('LOOSE_STORAGE', r'WARDROBE'),
    ('LOOSE_STORAGE', r'DRESSER'),
    ('LOOSE_STORAGE', r'BOOKCASE'),
    ('LOOSE_STORAGE', r'SHELF'),
    ('LOOSE_STORAGE', r'RACK'),
    ('LOOSE_STORAGE', r'CHEST'),
    ('LOOSE_STORAGE', r'DRAWER'),
    ('LOOSE_STORAGE', r'STORAGE'),
    ('LOOSE_STORAGE', r'CUBE'),
]
SUB_LABEL = {'SOFA': 'Sofa', 'BEDFRAME': 'Bedframe', 'MATTRESS': 'Mattress', 'DINING': 'Dining', 'TABLES': 'Tables',
             'LOOSE_STORAGE': 'Loose storage', 'ACCESSORY': 'Accessory'}
# Our code's type part per sub-category (prefixes production already uses: SOF, BED, FUR, ACC; MAT is new).
TYPE_PREFIX = {'SOFA': 'SOF', 'BEDFRAME': 'BED', 'MATTRESS': 'MAT', 'DINING': 'FUR', 'TABLES': 'FUR',
               'LOOSE_STORAGE': 'FUR', 'ACCESSORY': 'ACC'}


def our_code(sub_category, supplier_code):
    """The house code <TYPE>-<SUPPLIER>-<supplier's code>, e.g. SOF-HLM-231256. The only place the format lives.
    A '/' in the supplier's code (one row carries two codes) becomes '-', since codes travel in URLs."""
    return f"{TYPE_PREFIX[sub_category]}-{SUPPLIER_SHORT}-{supplier_code.replace('/', '-')}"


def classify(desc):
    d = ' '.join(desc.upper().replace('*', ' ').split())
    hits = [(sub, kw, [m.span() for m in re.finditer(r'\b' + kw + r'\b', d)]) for sub, kw in RULES]
    hits = [h for h in hits if h[2]]
    if not hits:
        return 'ACCESSORY', '(no keyword: Accessory)', []
    sub, kw, spans = hits[0]
    # "Also matched" lists only real doubts: not a word inside the winning phrase (CHAIR in LOUNGE CHAIR, BED in SOFA
    # BED), and not TABLE in a dining table.
    inside = lambda s2: all(any(a <= x and y <= b for a, b in spans) for x, y in s2)
    others = sorted({s for s, k, sp in hits if s != sub and not inside(sp) and not (sub == 'DINING' and k == 'TABLE')})
    return sub, kw, others


def sen(v):
    return int((Decimal(str(v)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def clean(v):
    if v is None:
        return ''
    s = str(v).strip()
    return '; '.join(x.strip() for x in s.splitlines() if x.strip())


def num(v):
    if v in (None, ''):
        return None
    return float(v)


def model_word(desc):
    return desc.replace('*', ' ').split()[0].upper()


wb = openpyxl.load_workbook(src_xlsx, data_only=True, read_only=True)
ws = wb['RptSKUEnquiry']
rows = list(ws.iter_rows(values_only=True))
H = {h: i for i, h in enumerate(rows[0]) if h}
col = lambda r, name: r[H[name]]
COST = 'Houzs Century Cost Price\n(MYR)'

existing = json.load(open(existing_json, encoding='utf-8'))

skus = []
for r in rows[1:]:
    if col(r, 'SKU Type') != 'SALES':
        continue
    sup_code = str(col(r, 'SKU Code')).strip()
    name = ' '.join(str(col(r, 'SKU Description')).split())
    sub, kw, others = classify(name)
    cost = col(r, COST)
    cubic = num(col(r, 'Cubic'))
    gross, nett = num(col(r, 'Gross Weight')), num(col(r, 'Nett Weight'))
    carton = clean(col(r, 'Carton Dimension'))
    # "122022= L1980 W550 H130": drop the code the list repeats in front of a single carton.
    carton = re.sub(r'^' + re.escape(sup_code) + r'\s*=\s*', '', carton)
    pack = clean(col(r, 'SKU Pack Type'))
    k = dict(
        supplier_code=sup_code, code=our_code(sub, sup_code), name=name, brand=clean(col(r, 'SKU Category Description')),
        sub_category=sub, keyword=kw, also_matched=', '.join(SUB_LABEL[o] for o in others),
        cost_rm=cost, cost_sen=sen(cost) if cost not in (None, '') else 0,
        size=clean(col(r, 'Size Remark')), colour=clean(col(r, 'Color Remark')),
        material=clean(col(r, 'Material Remark')), assembly=clean(col(r, 'Assembly Type')), pack=pack,
        carton=carton, gross=gross, nett=nett, cubic=cubic,
        m3_milli=int((Decimal(str(cubic)) * 1000).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) if cubic else 0,
        uom='SET' if pack.upper().startswith('1SET') or re.search(r'\bSET OF\b', name.upper()) else 'PCS',
        rrp_usd=col(r, 'RRP (USD)'),
    )
    lines = [('Size', k['size']), ('Colour', k['colour']), ('Material', k['material']), ('Assembly', k['assembly']),
             ('Pack', k['pack']), ('Carton', k['carton']),
             ('Gross weight', f"{gross:g} kg" if gross else ''), ('Nett weight', f"{nett:g} kg" if nett else ''),
             ('Cubic', f"{cubic:g} m3" if cubic else ''), ('Hin Lim code', sup_code)]
    k['description'] = '\n'.join(f'{a}: {b}' for a, b in lines if b)
    mw = model_word(name)
    k['model'] = mw
    k['existing_hits'] = [c for c, n in existing if re.search(r'\b' + re.escape(mw) + r'\b', f'{c} {n}'.upper())]
    skus.append(k)

assert len(skus) == 581, len(skus)
dup = [c for c, n in collections.Counter(k['code'] for k in skus).items() if n > 1]
assert not dup, dup
existing_codes = {c for c, _ in existing}
clash = [k['code'] for k in skus if k['code'] in existing_codes]
assert not clash, clash
no_cost = [k['supplier_code'] for k in skus if not k['cost_sen']]
name_dups = {n: [k['code'] for k in skus if k['name'] == n] for n, c in collections.Counter(k['name'] for k in skus).items() if c > 1}

# ---------------------------------------------------------------- migration
def lit(v):
    return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"


def sid(code):
    return 'mfg-' + hashlib.sha256(f'crm-hinlim|{code}'.encode()).hexdigest()[:12]


data = [dict(id=sid(k['code']), code=k['code'], name=k['name'], sub_category=k['sub_category'], uom=k['uom'],
             cost=k['cost_sen'], m3=k['m3_milli'], branding=k['brand'], description=k['description'],
             supplier_sku=k['supplier_code']) for k in skus]
Q = '$hlm$'
payload = json.dumps(data, ensure_ascii=False, indent=0)
assert Q not in payload
# Old generic SKUs that are the same item as Hin Lim rows (owner, 19 Nov 2026): made INACTIVE, the status the SKU Master's
# Deactivate writes (PATCH /api/scm/mfg-products/:id {status}), so the SO / VO pickers (ACTIVE only) offer the Hin Lim
# codes instead. Not deleted or renamed: 36 document lines name them. Value: what in the Hin Lim names replaces it.
RETIRE = {
    'FUR-GEN-COF-HIACE': r'^HIACE COFFEE TABLE\b',
    'FUR-GEN-COF-SANDRA2': r'^SANDRA SET OF 2 COFFEE TABLE\b',
    'FUR-GEN-SIDE-HIRADO': r'^HIRADO (1 DRAWER )?SIDE TABLE\b',
    'FUR-GEN-DIN-AIMON': r'^AIMON \S+ DINING TABLE\b',
    'SOF-GEN-NEXON-3S': r'^NEXON 3 SEATER SOFA\b',
    'FUR-GEN-CHAIR-CARTER': r'^CARTER DINING CHAIR\b',
    'FUR-GEN-CHAIR-ZOLA': r'^ZOLA DINING CHAIR\b',
    'FUR-GEN-CHAIR-MACY': r'^MACY DINING CHAIR\b',
    'FUR-MUJ-TVCAB': r'^MALMO 1\.8M TV CABINET\b',
}
existing_name = dict((c, n) for c, n in existing)
retire = []
for old, pat in RETIRE.items():
    assert old in existing_name, old
    repl = [k for k in skus if re.search(pat, k['name'])]
    assert repl, old
    retire.append(dict(code=old, name=existing_name[old], replaced_by=repl))
for k in skus:
    k['retires'] = [r['code'] for r in retire if k in r['replaced_by']]
retire_codes = 'array[' + ','.join(lit(r['code']) for r in retire) + ']::text[]'

per_sub = collections.Counter(k['sub_category'] for k in skus)
per_brand = collections.Counter(k['brand'] for k in skus)
priced = sum(1 for k in skus if k['cost_sen'])

sql = f"""-- REVERSAL: delete from scm.supplier_binding_price_history where notes like '{TAG}%';
--   delete from scm.supplier_material_bindings where notes like '{TAG}%';
--   delete from scm.mfg_products where id in (the ids in this file) and nothing (SO / PO / DO / stock line) names its code;
--   delete from scm.product_models m where m.model_code in (the codes in this file) and no SKU points at it;
--   delete from scm.app_config where key = 'note:{TAG.replace(' ', '-')}';
--   update scm.mfg_products set status = 'ACTIVE' where company_id = {COMPANY_ID} and code in (the codes in the scm.entity_audit_log
--   rows noted '{TAG}: retired%', action 'deactivate'), then delete those audit rows.
-- Hin Lim's furniture from Houzs Century's CRM product list ("Houz Century CRM Product List.xlsx", sheet RptSKUEnquiry,
-- SKU Type = SALES: {len(skus)} of 1,155 rows), owner 19 Nov 2026. Review: docs/catalog-import/crm-hinlim/review.xlsx.
--  * Our code = <TYPE>-{SUPPLIER_SHORT}-<Hin Lim code> (SOF / BED / MAT / FUR / ACC by sub-category); the list's
--    "SKU Code" is Hin Lim's own code and goes on the supplier link (supplier_sku).
--  * Group FURNITURE, sub-category from the description's keywords (rules: build.py RULES, review.xlsx "Rules"):
--    {', '.join(f'{SUB_LABEL[s]} {n}' for s, n in per_sub.most_common())}.
--  * Name = SKU Description; branding = the list's brand ({', '.join(f'{b} {n}' for b, n in per_brand.most_common())});
--    description = size, colour, material, assembly, pack, carton, weights, cubic, Hin Lim code; unit_m3_milli = Cubic x 1000;
--    unit SET for a "1SET/..." pack or a "SET OF" name, else PCS; cost_price_sen = Houzs Century Cost Price (MYR) x 100; no selling price.
--  * Each SKU a model of its own (model_code = SKU code), Active, company {COMPANY_ID} (The Conts).
--  * Main supplier {SUPPLIER_NAME} ({SUPPLIER_CODE}): one scm.supplier_material_bindings row per SKU (material_kind
--    mfg_product, supplier_sku = Hin Lim code, unit_price_sen = cost, valid from {TODAY}, main unless the SKU already has a
--    main supplier, not a cost anchor) and one scm.supplier_binding_price_history row per priced link ({priced}).
--    The supplier is created only where it is missing (a fresh local / CI database); production has it.
--  * {len(retire)} old generic SKUs that are the same item ({', '.join(r['code'] for r in retire)})
--    become INACTIVE (the SKU Master's Deactivate), only where still ACTIVE, each written to scm.entity_audit_log. They are
--    not deleted or renamed: existing documents name them and keep showing their code. The SO / VO pickers offer ACTIVE
--    SKUs only, so they now find the Hin Lim codes. Replacements: review.xlsx "Retired old codes".
-- Built by docs/catalog-import/crm-hinlim/build.py; edit that script, not this file. Safe to run again: everything is keyed on
-- SKU code / supplier + SKU, an existing code is left as it is.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0346, dry run first.

set local search_path = scm, public, extensions;

insert into scm.suppliers (id, company_id, code, name, status, notes)
select {lit(SUPPLIER_ID)}::uuid, {COMPANY_ID}, {lit(SUPPLIER_CODE)}, {lit(SUPPLIER_NAME)}, 'ACTIVE', {lit('Created by ' + TAG + ' (missing on this database)')}
 where exists (select 1 from public.companies where id = {COMPANY_ID})
   and not exists (select 1 from scm.suppliers s where s.id = {lit(SUPPLIER_ID)}::uuid
                      or (s.company_id = {COMPANY_ID} and upper(s.code) = {lit(SUPPLIER_CODE)}));

create temp table hlm_rows on commit drop as
select x.*, (select s.id from scm.suppliers s where s.company_id = {COMPANY_ID}
               and (s.id = {lit(SUPPLIER_ID)}::uuid or upper(s.code) = {lit(SUPPLIER_CODE)})
             order by (s.id = {lit(SUPPLIER_ID)}::uuid) desc limit 1) as supplier_id
  from jsonb_to_recordset({Q}{payload}{Q}::jsonb)
  as x(id text, code text, name text, sub_category text, uom text, cost integer, m3 integer, branding text, description text,
       supplier_sku text)
 where exists (select 1 from public.companies where id = {COMPANY_ID});

insert into scm.product_models (company_id, model_code, name, category)
select {COMPANY_ID}, r.code, r.name, 'FURNITURE'::scm.mfg_product_category from hlm_rows r
on conflict (company_id, model_code, category) do nothing;

insert into scm.mfg_products
    (id, company_id, code, name, category, category_group, sub_category, uom, status, cost_price_sen, unit_m3_milli,
     branding, description, model_id)
select r.id, {COMPANY_ID}, r.code, r.name, 'FURNITURE'::scm.mfg_product_category, 'FURNITURE', r.sub_category, r.uom, 'ACTIVE',
       r.cost, r.m3, r.branding, r.description, m.id
  from hlm_rows r
  left join scm.product_models m on m.company_id = {COMPANY_ID} and m.model_code = r.code and m.category = 'FURNITURE'
on conflict (company_id, code) do nothing;

insert into scm.supplier_material_bindings
    (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_valid_from,
     is_main_supplier, notes)
select {COMPANY_ID}, r.supplier_id, 'mfg_product', r.code, r.name, r.supplier_sku, r.cost, case when r.cost > 0 then date {lit(TODAY)} end,
       not exists (select 1 from scm.supplier_material_bindings b where b.company_id = {COMPANY_ID} and b.material_kind = 'mfg_product'
                                                                  and b.item_code = r.code and b.is_main_supplier),
       {lit(TAG + ': main supplier, cost from the Houzs Century CRM product list')}
  from hlm_rows r
 where not exists (select 1 from scm.supplier_material_bindings b where b.company_id = {COMPANY_ID} and b.material_kind = 'mfg_product'
                                                                  and b.item_code = r.code and b.supplier_id = r.supplier_id);

insert into scm.supplier_binding_price_history
    (company_id, supplier_id, material_kind, item_code, unit_price_sen, is_main_supplier, effective_from, notes, created_by, applied_at)
select {COMPANY_ID}, r.supplier_id, 'mfg_product', r.code, r.cost, true, date {lit(TODAY)}, {lit(TAG + ': Houzs Century Cost Price')}, {lit(TAG)}, now()
  from hlm_rows r
 where r.cost > 0
   and not exists (select 1 from scm.supplier_binding_price_history h where h.company_id = {COMPANY_ID} and h.supplier_id = r.supplier_id
                     and h.material_kind = 'mfg_product' and h.item_code = r.code and h.effective_from = date {lit(TODAY)});

insert into scm.app_config (key, value, description, company_id)
select {lit('note:' + TAG.replace(' ', '-'))}, {lit(json.dumps(dict(tag=TAG, skus=len(skus), supplier=SUPPLIER_CODE)))},
       {lit('Import note: ' + TAG + ', Hin Lim SKUs from the Houzs Century CRM product list')}, {COMPANY_ID}
 where exists (select 1 from public.companies where id = {COMPANY_ID})
on conflict (key) do nothing;

do $$ begin
  if exists (select 1 from public.companies where id = {COMPANY_ID}) and
     (select count(*) from hlm_rows r join scm.supplier_material_bindings b on b.company_id = {COMPANY_ID} and b.material_kind = 'mfg_product'
        and b.item_code = r.code and b.supplier_id = r.supplier_id
        join scm.mfg_products p on p.company_id = {COMPANY_ID} and p.code = r.code) <> {len(skus)}
  then raise exception 'expected {len(skus)} Hin Lim SKUs, each with its Hin Lim link'; end if;
end $$;

-- Old generic SKUs replaced by the Hin Lim codes: audit first, then the same status change the SKU Master's Deactivate makes.
create temp table hlm_retire on commit drop as
select x.code, x.replaced_by
  from jsonb_to_recordset({Q}{json.dumps([dict(code=r['code'], replaced_by=', '.join(k['code'] for k in r['replaced_by'])) for r in retire])}{Q}::jsonb)
  as x(code text, replaced_by text);

insert into scm.entity_audit_log (company_id, entity_type, entity_id, action, actor_name_snapshot, field_changes, source, note)
select {COMPANY_ID}, 'mfg_product', p.code, 'deactivate', 'migration 0346', '[]'::jsonb, 'migration',
       {lit(TAG + ': retired, owner 19 Nov 2026: the same item is now on Hin Lim codes ')} || r.replaced_by || '; status ACTIVE -> INACTIVE, kept for the documents that name it'
  from scm.mfg_products p join hlm_retire r on r.code = p.code
 where p.company_id = {COMPANY_ID} and p.status = 'ACTIVE';

update scm.mfg_products p set status = 'INACTIVE', updated_at = now()
  from hlm_retire r
 where p.company_id = {COMPANY_ID} and p.code = r.code and p.status = 'ACTIVE';
"""
open(os.path.join(root, MIGRATION), 'w', encoding='utf-8', newline='\n').write(sql)

# ---------------------------------------------------------------- review sheet
out = openpyxl.Workbook()
bold = Font(bold=True)
hdr_fill = PatternFill('solid', fgColor='DDE4EE')
flag_fill = PatternFill('solid', fgColor='FFF2CC')


def sheet(title, header, data_rows, widths, flag_col=None):
    s = out.create_sheet(title)
    s.append(header)
    for c in s[1]:
        c.font, c.fill = bold, hdr_fill
    for row in data_rows:
        s.append(row)
    for i, w in enumerate(widths):
        s.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width = w
    s.freeze_panes = 'A2'
    if data_rows:
        s.auto_filter.ref = s.dimensions
    if flag_col is not None:
        for row in s.iter_rows(min_row=2):
            if row[flag_col].value:
                for c in row:
                    c.fill = flag_fill
    for row in s.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical='top', wrap_text=isinstance(c.value, str) and len(c.value) > 40)
    return s


out.remove(out.active)
readme = out.create_sheet('Read me')
for line in [
    'Hin Lim SKUs from the Houzs Century CRM product list (19 Nov 2026)',
    '',
    f'Source: Houz Century CRM Product List.xlsx, sheet RptSKUEnquiry. Only SKU Type = SALES: {len(skus)} of 1,155 rows.',
    f'All go in as Furniture, Active, main supplier {SUPPLIER_NAME} ({SUPPLIER_CODE}), cost = Houzs Century Cost Price.',
    'No selling price is set. Brand goes into Branding; size, colour, material, assembly, pack, carton, weights and cubic into Description.',
    'Our code = <type>-HLM-<Hin Lim code>: SOF sofa, BED bedframe, MAT mattress, FUR dining / tables / storage, ACC accessory.',
    "The list's SKU Code is Hin Lim's own code: it is kept on the supplier link (the supplier's item code).",
    '',
    'Sheets: SKUs (one row per SKU), Summary (counts), Rules (how the sub-category was picked), Retired old codes, Questions.',
    f'Retired old codes: {len(retire)} old generic SKUs that are the same item become Inactive (not deleted: old documents keep them).',
    'Yellow rows on SKUs: worth a look (description also matched another sub-category, or the model name is already in an existing product).',
    '',
    f'Migration: {MIGRATION} (not applied anywhere yet).',
]:
    readme.append([line])
readme['A1'].font = Font(bold=True, size=13)
readme.column_dimensions['A'].width = 130

sheet('SKUs',
      ['Our code', 'Hin Lim code', 'Name', 'Brand', 'Sub-category', 'Keyword that picked it', 'Also matched',
       'Cost (RM)', 'Unit', 'Size', 'Colour', 'Material', 'Assembly', 'Pack', 'Cubic (m3)', 'unit_m3_milli',
       'Model word', 'Model name already in existing products', 'Replaces old code (made Inactive)', 'Check'],
      [[k['code'], k['supplier_code'], k['name'], k['brand'], SUB_LABEL[k['sub_category']], k['keyword'], k['also_matched'],
        k['cost_rm'], k['uom'], k['size'], k['colour'], k['material'], k['assembly'], k['pack'], k['cubic'], k['m3_milli'],
        k['model'], ', '.join(k['existing_hits'][:6]) + (f" (+{len(k['existing_hits']) - 6} more)" if len(k['existing_hits']) > 6 else ''),
        ', '.join(k['retires']),
        '; '.join(x for x in [
            'also matched ' + k['also_matched'] if k['also_matched'] else '',
            'model name in existing products' + (' (old code retired)' if k['retires'] else '') if k['existing_hits'] else '',
            'same name as ' + ', '.join(c for c in name_dups.get(k['name'], []) if c != k['code']) if k['name'] in name_dups else '',
            "Hin Lim code has '/'" if '/' in k['supplier_code'] else '',
            'no cost' if not k['cost_sen'] else '',
        ] if x)]
       for k in skus],
      [18, 16, 46, 15, 13, 18, 14, 10, 6, 26, 34, 34, 18, 12, 10, 10, 12, 40, 22, 40], flag_col=19)

summ = [['By sub-category', 'SKUs', 'Code prefix']]
for s in SUB_LABEL:
    summ.append([SUB_LABEL[s], per_sub.get(s, 0), TYPE_PREFIX[s]])
summ += [['Total', len(skus), ''], ['', '', ''], ['By brand', 'SKUs', '']]
for b, n in per_brand.most_common():
    summ.append([b, n, ''])
summ += [['Total', len(skus), ''], ['', '', ''],
         ['Sub-category x brand', '', '']]
s = out.create_sheet('Summary')
for r in summ:
    s.append(r)
brands = [b for b, _ in per_brand.most_common()]
s.append(['Sub-category'] + brands)
cross = collections.Counter((k['sub_category'], k['brand']) for k in skus)
for sc in SUB_LABEL:
    s.append([SUB_LABEL[sc]] + [cross.get((sc, b), 0) for b in brands])
for r in s.iter_rows():
    if r[0].value in ('By sub-category', 'By brand', 'Sub-category x brand', 'Sub-category', 'Total'):
        for c in r:
            c.font = bold
for i, w in enumerate([24, 12, 12, 12, 12, 16, 12]):
    s.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width = w

used = collections.Counter((k['sub_category'], k['keyword']) for k in skus)
sheet('Rules', ['Order', 'Keyword (whole word in the description)', 'Sub-category', 'SKUs it picked'],
      [[i + 1, kw.replace(' ?', ' / '), SUB_LABEL[sc], used.get((sc, kw.replace(' ?', ' / ')), 0)] for i, (sc, kw) in enumerate(RULES)]
      + [[len(RULES) + 1, '(nothing above matched)', 'Accessory', used.get(('ACCESSORY', '(no keyword: Accessory)'), 0)]],
      [8, 40, 16, 14])

qs = [
    ['Lounge chairs, recliners and ottomans are put under Sofa (living-room seating), not Dining. Right?',
     ', '.join(sorted({k['code'] for k in skus if k['keyword'] in ('LOUNGE CHAIR', 'RECLINER', 'OTTOMAN')}))],
    ['Poufs, mirrors and anything without a keyword fall to Accessory.',
     ', '.join(f"{k['code']} {k['name']}" for k in skus if k['sub_category'] == 'ACCESSORY')],
    ['Stools and benches go to Dining as asked, including ottoman-like stools (FINN STOOL) and the dressing-table stool set (put under Tables).',
     ''],
    ['Code format <type>-HLM-<Hin Lim code> confirmed by the owner (19 Nov 2026); it lives in one function in build.py (our_code).', ''],
    ['Units: SET for a "1SET/..." pack (dining sets) or a "SET OF" name (e.g. SANDRA set of 2), PCS for everything else.',
     ', '.join(k['code'] for k in skus if k['uom'] == 'SET')],
]
if name_dups:
    qs.append(['Rows with the same description but different Hin Lim codes (both imported):',
               '; '.join(f"{n}: {', '.join(c)}" for n, c in name_dups.items())])
slash = [k for k in skus if '/' in k['supplier_code']]
if slash:
    qs.append(["Hin Lim code holding two codes; our code uses '-' instead of '/':",
               ', '.join(f"{k['supplier_code']} -> {k['code']}" for k in slash)])
if no_cost:
    qs.append(['Rows with no cost price (imported at RM 0):', ', '.join(no_cost)])
sheet('Retired old codes', ['Old code', 'Old name', 'Becomes', 'Replaced by (Hin Lim codes)', 'Hin Lim names'],
      [[r['code'], r['name'], 'INACTIVE (kept; old documents still show it)', ', '.join(k['code'] for k in r['replaced_by']),
        '; '.join(k['name'] for k in r['replaced_by'])] for r in retire], [24, 30, 30, 50, 90])

sheet('Questions', ['Question / note', 'Rows'], qs, [80, 120])

out.save(os.path.join(root, 'docs/catalog-import/crm-hinlim/review.xlsx'))

print('skus', len(skus), 'priced', priced, 'no cost', len(no_cost))
print('by sub', dict(per_sub.most_common()))
print('by brand', dict(per_brand.most_common()))
print('rules used', {f'{SUB_LABEL[a]}<-{b}': n for (a, b), n in used.most_common()})
print('also matched', [(k['code'], k['name'], k['also_matched']) for k in skus if k['also_matched']])
print('existing hits', sum(1 for k in skus if k['existing_hits']))
print('name dups', name_dups)
for r in retire: print('retire', r['code'], '->', [k['code'] + ' ' + k['name'] for k in r['replaced_by']])
print('accessory', [k['name'] for k in skus if k['sub_category'] == 'ACCESSORY'])
