import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    pages = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv)>2 else range(1,len(pdf.pages)+1)
    for n in pages:
        pg=pdf.pages[n-1]
        for ti,t in enumerate(pg.extract_tables()):
            print(f"--- p{n} table {ti}")
            for r in t: print(" | ".join('' if c is None else c.replace('\n',' ') for c in r))
