import sys, pdfplumber
sys.stdout.reconfigure(encoding='utf-8')
with pdfplumber.open(sys.argv[1]) as pdf:
    for n,pg in enumerate(pdf.pages,1):
        for ti,t in enumerate(pg.find_tables()):
            print(f"--- p{n} table {ti} bbox {tuple(round(x) for x in t.bbox)}")
            crop=pg.crop(t.bbox)
            txt=crop.extract_text(layout=False)
            print(txt)
