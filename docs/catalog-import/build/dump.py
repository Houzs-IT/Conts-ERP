import sys, os, fitz
src, out = sys.argv[1], sys.argv[2]
i=0
for root,_,files in os.walk(src):
    for f in sorted(files):
        if not f.lower().endswith('.pdf'): continue
        p=os.path.join(root,f); i+=1
        d=fitz.open(p)
        rel=os.path.relpath(p,src)
        name=f"{i:02d}.txt"
        with open(os.path.join(out,name),'w',encoding='utf-8') as fh:
            fh.write(f"### {rel}\n")
            for n,pg in enumerate(d,1):
                fh.write(f"\n=== PAGE {n} ===\n"+pg.get_text())
        tot=sum(len(pg.get_text()) for pg in d)
        print(name, rel, 'pages',len(d),'chars',tot, 'imgs', sum(len(pg.get_images()) for pg in d))
