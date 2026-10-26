"""Parsed Notion SO PDFs -> docs/so-import/so-notion-data.json: one entry per project, its versions oldest first."""
import json, re, sys, datetime, collections
R = json.load(open('so_parsed.json', encoding='utf-8'))
OUT = sys.argv[1]
PROJECTS = {l.strip().upper(): l.strip() for l in open('projnames.txt', encoding='utf-8') if l.strip()}
PID = json.load(open('projids.json', encoding='utf-8'))  # name -> id
ALIAS = {'ASTER HILL B-01-06 MR AIDEN': 'ASTER HILL A-01-06 MR AIDEN'}
SKIP_FILES = {'MAPLE B18-3 MR LIEW -- SO MAPLE RESIDENCE B-18-3 MR LIEW COPY.pdf'}
FILE_DATE = re.compile(r'\((\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)', re.I)

def pdate(s):
    if not s: return None
    for f in ('%d/%m/%Y', '%m/%d/%Y', '%d/%m/%y'):
        try: return datetime.datetime.strptime(s.strip(), f).date()
        except ValueError: pass
    return None

def qn(q):
    try: return float(q)
    except (TypeError, ValueError): return 1.0

def sen(x): return int(round(x * 100))

def line_of(i, discfmt=False):
    p, a = i['price'], i['amt']
    q = qn(i['qty']); qi = max(1, int(round(q)))
    desc = i['desc']
    if i['detail']: desc = (desc + ' - ' + ' / '.join(i['detail']))
    desc = re.sub(r'^[-*\s]+', '', desc)[:480]
    if p is None and a is None:
        if i['sku'] in ('SKIP', 'TEXT'): return {'kind': 'TEXT', 'description': desc}
        return {'kind': 'ITEM', 'itemCode': i['sku'], 'description': desc, 'qty': qi, 'unitPriceSen': 0, 'netSen': 0}
    if p is not None and a is not None and not abs(q * p - a) < 1 and (i.get('disc') or (discfmt and p < a)):
        listSen, netS = sen(a), sen(p)   # DISC PRICE column: list amount and the discounted amount
    elif a is not None: listSen = netS = sen(a)
    else: listSen = netS = sen(p)
    code = i['sku'] if i['sku'] not in ('SKIP', 'TEXT') else 'RN-PROJECT_MGMT'
    unit = int(round(listSen / qi))
    l = {'kind': 'ITEM', 'itemCode': code, 'description': desc, 'qty': qi, 'unitPriceSen': unit, 'netSen': netS}
    if listSen and netS != listSen:
        l['discountBp'] = max(0, min(10000, int(round((1 - netS / listSen) * 10000))))
    return l

def sections_of(d):
    secs, cur = [], None
    for i in d['items']:
        h = (i['sec'] or '').strip()[:200]
        if cur is None or cur['heading'] != h: cur = {'heading': h, 'lines': []}; secs.append(cur)
        cur['lines'].append(line_of(i, 'DISC' in (d['fmt'] or '')))
    return secs

by_proj = collections.defaultdict(list)
for f, d in R.items():
    if f in SKIP_FILES: continue
    name = f.split(' -- ')[0]; name = ALIAS.get(name, name)
    by_proj[name].append((f, d))

out, problems = [], []
for name, vs in sorted(by_proj.items()):
    def key(fv):
        f, d = fv; h = d['head']
        am = pdate(h.get('amend')) or pdate(h.get('date')) or datetime.date(2000, 1, 1)
        m = FILE_DATE.search(f.split(' -- ')[1])
        tie = 0
        if m:
            mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].index(m.group(2).upper()[:3]) + 1
            tie = mon * 100 + int(m.group(1))
        return (am, tie, 'SIGNED' in f.upper(), len(d['items']))
    vs.sort(key=key)
    versions, prev_sig = [], None
    for f, d in vs:
        secs = sections_of(d)
        linesSen = sum(l.get('netSen', 0) for s in secs for l in s['lines'])
        payable = d.get('payable')
        disc = d['fmt'] and 'DISC' in (d['fmt'] or '')
        if payable is None or (disc and d.get('payable_how') == 'pagetotals'): payable = linesSen / 100
        paySen = sen(payable)
        sig = json.dumps(secs) + str(paySen)
        if sig == prev_sig: continue
        prev_sig = sig
        h = d['head']
        dd = pdate(h.get('date')); am = pdate(h.get('amend'))
        versions.append({'file': f.split(' -- ')[1], 'docDate': str(dd) if dd else None, 'lastAmended': str(am) if am else None,
                         'preparedBy': (h.get('prepared') or '')[:100], 'to': (h.get('to') or h.get('attention') or '')[:200],
                         'building': h.get('building'), 'unit': h.get('unit'), 'payableSen': paySen, 'linesSen': linesSen, 'sections': secs})
        if abs(linesSen - paySen) > 0.1 * max(paySen, 1): problems.append((name, f.split(' -- ')[1], linesSen / 100, paySen / 100))
    out.append({'project': name, 'projectId': PID.get(name.upper()), 'versions': versions})
json.dump({'built': str(datetime.date.today()), 'source': 'Notion SO export (Notion SO.zip, 107 PDFs), owner 26 Oct 2026', 'projects': out},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('projects', len(out), 'versions', sum(len(p['versions']) for p in out), 'no project id', [p['project'] for p in out if not p['projectId']])
print('SO + VO:', sum(1 for p in out if p['versions']), 'SOs,', sum(len(p['versions']) - 1 for p in out), 'VOs')
print('lines far from the printed total (>10%):'); [print('  ', p) for p in problems]
