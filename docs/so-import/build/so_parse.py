"""Notion SO PDFs -> structured JSON. Coordinate based: the PDFs are spreadsheet prints with fixed columns."""
import sys, os, re, json, pdfplumber
D, OUT = sys.argv[1], sys.argv[2]
NUM = re.compile(r'^-?[\d,]+(\.\d+)?$')
def num(t): return float(t.replace(',', ''))
DIM = re.compile(r'^(W|H|D|L|DEPTH|WIDTH|HEIGHT)\s*:|^\(|^W:|^H:|^D:|\d+(\.\d+)?\s*(FT|MM|CM|M)\b', re.I)

def clusters(words):
    ws = sorted(words, key=lambda w: (w['top'], w['x0'])); out = []
    for w in ws:
        if out and w['top'] - out[-1][0] <= 3.5: out[-1][1].append(w)
        else: out.append([w['top'], [w]])
    return [sorted(c[1], key=lambda w: w['x0']) for c in out]

def header_fields(ws):
    t = ' '.join(w['text'] for w in ws)
    g = lambda k: (re.search(k + r'\s+(.+?)\s{0,}(?=Prepared|Building|Unit|Date|$)', t) or [None, ''])[1].strip()
    return t

def parse(path):
    pdf = pdfplumber.open(path); doc = {'pages': len(pdf.pages), 'items': [], 'stated': {}, 'head': {}, 'summary': []}
    sec = None; fmt = None
    for pi, pg in enumerate(pdf.pages):
        cl = clusters(pg.extract_words())
        hi = next((i for i, c in enumerate(cl) if any(w['text'] in ('Description', 'DESCRIPTION') for w in c)), None)
        if hi is None: continue
        hdr = cl[hi] + (cl[hi + 1] if hi + 1 < len(cl) else []) + cl[hi - 1]
        X = {}
        for w in hdr:
            t = w['text']
            if t.startswith('Qty'): X['qty'] = w['x0']
            if t in ('Amount', 'AMOUNT'): X['amt'] = w['x0']
            if t in ('Unit', 'UNIT', 'DISC', 'COST') or t.endswith('DISC'): X['price'] = w['x0'] + (15 if t.endswith('DISC') and t != 'DISC' else 0); fmt = fmt or t.replace('Qty', '')
        if 'qty' not in X or 'amt' not in X: continue
        # header block above the table
        for c in cl[:hi]:
            line = ' '.join(w['text'] for w in c)
            for key, pat in (('to', r'\bTo\s+(.+?)(?:\s+Building|\s+Prepared|$)'), ('attention', r'Attention\s+(.+?)(?:\s+Prepared|$)'),
                             ('prepared', r'Prepared By\s+(.+)$'), ('building', r'Building\s+(.+)$'), ('unit', r'\bUnit\s+(.+)$'),
                             ('date', r'\bDate\s+(\d{1,2}/\d{1,2}/\d{2,4})'), ('amend', r'LAST AMEND\s*:\s*(\S+)')):
                m = re.search(pat, line)
                if m and key not in doc['head']: doc['head'][key] = m.group(1).strip()
        last = None; page_start = len(doc['items']); in_terms = False
        for c in cl[hi + 1:]:
            line = ' '.join(w['text'] for w in c)
            for mm in re.finditer(r'(FINAL TOTAL|GRAND TOTAL)\s*(?!\(RM\))[:]?\s*(?:RM)?\s*([\d,]{3,}(?:\.\d+)?)', line):
                doc['stated'].setdefault(mm.group(1) + ' X', []).append(num(mm.group(2)))
            if re.match(r'^(PAYMENT TERMS|TERMS\s*(&|AND)\s*CONDITION)', line.strip(), re.I):
                in_terms = True
            if in_terms:
                m = re.search(r'(FINAL TOTAL|GRAND TOTAL)\s*\(RM\)\s*([\d,]+\.?\d*)', line)
                if m: doc['stated'].setdefault(m.group(1), []).append(num(m.group(2)))
                continue
            if re.match(r'(Payment shall|Customer shall|Goods sold|The company reserves|PAGE OF)', line.strip(), re.I):
                m = re.search(r'(FINAL TOTAL|GRAND TOTAL|TOTAL)\s*\(RM\)\s*([\d,]+\.?\d*)', line)
                if m: doc['stated'].setdefault(m.group(1), []).append(num(m.group(2)))
                m = re.search(r'\bRM\s*([\d,]{4,}(\.\d+)?)\s*$', line)
                if m: doc['stated'].setdefault('RM', []).append(num(m.group(1)))
                continue
            if re.fullmatch(r'(GRAND\s+)?TOTAL', line.strip()) or re.fullmatch(r'RM\s*[\d,]{4,}(\.\d+)?', line.strip()):
                m = re.search(r'([\d,]{4,}(\.\d+)?)', line)
                if m: doc['stated'].setdefault('RM', []).append(num(m.group(1)))
                elif 'GRAND' in line: doc['stated'].setdefault('GRANDLABEL', []).append(1)
                continue
            if re.search(r'\bTOTAL\b', line) and not re.search(r'[A-Z]{3,}', re.sub(r'(FINAL|GRAND|SUB)?\s*TOTAL|\(RM\)|RM', '', line)):
                m = re.findall(r'([\d,]+\.?\d*)', line)
                k = 'FINAL TOTAL' if 'FINAL' in line else 'GRAND TOTAL' if 'GRAND' in line else 'TOTAL'
                if m: doc['stated'].setdefault(k, []).append(num(m[-1]))
                continue
            desc = [w for w in c if w['x1'] < X['qty'] - 4]
            rest = [w for w in c if w['x1'] >= X['qty'] - 4]
            qty = price = amt = disc = None; extra = []
            for w in rest:
                t = w['text']
                if t.endswith('%'): disc = t; continue
                if w['x0'] >= X['amt'] - 25 and NUM.match(t): amt = num(t); continue
                if abs(w['x0'] - X['qty']) < 12 and (NUM.match(t) or t in ('LS', 'L/S', 'LOT')): qty = t; continue
                if X.get('price') and w['x0'] >= X['qty'] + 8 and NUM.match(t): price = num(t); continue
                extra.append(t)
            dtext = ' '.join(w['text'] for w in desc + [w for w in rest if w['text'] in extra]).strip()
            no = None
            if desc and re.match(r'^\d{1,2}$', desc[0]['text']) and desc[0]['x0'] < 158:
                no = desc[0]['text']; dtext = ' '.join(w['text'] for w in desc[1:]).strip()
            has_num = any(v is not None for v in (qty, price, amt))
            if not dtext and not has_num: continue
            if not dtext and has_num and qty is None and price is not None and amt is None:
                continue  # page subtotal of discounted prices
            if not dtext:  # stray amount / qty for the line above
                if last is not None:
                    if amt is not None and last.get('amt') is None: last['amt'] = amt
                    if price is not None and last.get('price') is None: last['price'] = price
                    if qty is not None and last.get('qty') is None: last['qty'] = qty
                    if disc and not last.get('disc'): last['disc'] = disc
                continue
            if dtext and re.search(r'\bTOTAL\b', dtext, re.I) and (has_num or re.search(r'[\d,]+\.?\d*', dtext)):
                doc['summary'].append({'desc': dtext, 'price': price, 'amt': amt}); continue
            if dtext and re.search(r'SPECIAL PROMO|DISCOUNTED\s*:|ROUND\s*(OFF|UP)|PACKAGE PRICE|NETT? PRICE', dtext, re.I):
                doc['summary'].append({'desc': dtext, 'price': price, 'amt': amt}); continue
            if dtext and re.search(r'^(LESS\s*:?\s*)?([A-Z ]*\s)?DISCOUNT\b|^DEPOSIT|^BALANCE|^SST\b|^ROUNDING', dtext, re.I) and has_num:
                doc['summary'].append({'desc': dtext, 'price': price, 'amt': amt}); continue
            heading_like = not has_num and no is None and dtext.isupper() and not DIM.search(dtext) and (
                re.search(r'WORK|@|AREA|ROOM|KITCHEN|CURTAIN|LIVING|MASTER|M\s*&\s*E|ELECTRIC|PLUMB|PAINT|CEILING|TILE|FLOOR|MISC|OTHER|FURNITURE|DESIGN|LIGHT|SERVICE', dtext))
            if heading_like:
                sec = dtext; last = None; continue
            if not has_num and no is None and last is not None:
                last['detail'].append(dtext); continue
            if not has_num and no is None and last is None:
                sec = dtext; continue
            last = {'page': pi + 1, 'sec': sec, 'no': no, 'desc': dtext, 'qty': qty, 'price': price, 'disc': disc, 'amt': amt, 'detail': []}
            doc['items'].append(last)
        # a page subtotal printed in the amount column beside a body line
        pg_items = [i for i in doc['items'][page_start:] if i['amt'] is not None]
        if len(pg_items) > 1:
            lastamt = pg_items[-1]
            if abs(sum(i['amt'] for i in pg_items[:-1]) - lastamt['amt']) < 1: lastamt['amt'] = None; lastamt['subtotal_dropped'] = True
    doc['fmt'] = fmt
    # a grand-total row that landed in the body: its amount is the sum of everything above it
    keep = []; run = 0.0
    for it in doc['items']:
        a = it['amt']
        if a is not None and run > 0 and abs(a - run) < 1.5 and len(keep) > 3:
            doc['summary'].append({'desc': it['desc'], 'price': it['price'], 'amt': a, 'grand_row': True})
            if it['price'] is not None and it['price'] < a: doc['stated'].setdefault('FINAL TOTAL', []).append(it['price'])
            continue
        keep.append(it); run += a or 0
    doc['items'] = keep
    pdf.close(); return doc

res = {}
for f in sorted(os.listdir(D)):
    if f.endswith('.pdf'):
        try: res[f] = parse(os.path.join(D, f))
        except Exception as e: res[f] = {'error': repr(e)}
json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(res), 'parsed', sum('error' in v for v in res.values()), 'errors')
