"""Builds the app's logo files from the company's own mark (public/brand/the-conts-logo.png).

The source is a beige-gold lockup on a transparent background: the towers, THE CONTS, and a
PROPERTY MANAGEMENT line too small to read at any size the app uses. This writes, into public/brand/:

  mark-gold.png      the towers alone, solid brand gold #C8A46A (sidebar, top bars; on black)
  logo-gold.png      towers + THE CONTS, solid brand gold (login hero; on black)
  favicon-64.png     the gold towers on the black rounded tile, 64 x 64 (browser tab)
  apple-touch-icon.png  the same tile, 180 x 180, square (phone home screen)

Run once after the source changes:  python scripts/brand/make-logo-variants.py
Needs Pillow (a development tool only; nothing here runs in the app).
"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND = Path(__file__).resolve().parents[2] / 'public' / 'brand'
GOLD = (0xC8, 0xA4, 0x6A)
TILE = (0x15, 0x15, 0x15)

src = Image.open(BRAND / 'the-conts-logo.png').convert('RGBA')
alpha = src.getchannel('A')


def tinted(box):
    """The crop at `box`, every pixel brand gold, keeping the source's own edge softness."""
    a = alpha.crop(box)
    a = a.crop(a.getbbox())
    out = Image.new('RGBA', a.size, GOLD + (0,))
    out.putalpha(a)
    return out


# Rows 0-139 hold the towers, 140-167 THE CONTS, 168 onwards the unreadable tagline.
mark = tinted((0, 0, src.width, 140))
logo = tinted((0, 0, src.width, 168))
mark.save(BRAND / 'mark-gold.png', optimize=True)
logo.save(BRAND / 'logo-gold.png', optimize=True)


def tile(size, radius):
    """The gold towers centred on the black tile, the mark about 70% of the tile's height."""
    scale = 4  # draw large, then reduce, for clean edges
    big = Image.new('RGBA', (size * scale, size * scale), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=TILE + (255,))
    h = round(size * scale * 0.70)
    w = round(mark.width * h / mark.height)
    m = mark.resize((w, h), Image.LANCZOS)
    # Optical centre: the towers' weight sits right and low in their box (MARK_OPTICAL in src/components/Logo.tsx).
    big.alpha_composite(m, ((size * scale - w) // 2 - round(0.05 * w), (size * scale - h) // 2 - round(0.02 * h)))
    return big.resize((size, size), Image.LANCZOS)


# Dream Crafter (the supply chain workspace): public/brand/dream-crafter-logo.png is the brand's stacked lockup,
# black building and bear with gold bars. Rows 0-2671 hold the mark, the rest DREAM CRAFTER. For the dark sidebar
# the black turns white and the gold bars keep their own colour.
dc = Image.open(BRAND / 'dream-crafter-logo.png').convert('RGBA')
dc = dc.crop((0, 0, dc.width, 2672))
dc = dc.crop(dc.getchannel('A').getbbox())
px = dc.load()
for y in range(dc.height):
    for x in range(dc.width):
        r, g, b, a = px[x, y]
        if a and max(r, g, b) < 100:
            px[x, y] = (255, 255, 255, a)
dc.thumbnail((dc.width, 160), Image.LANCZOS)
dc.save(BRAND / 'dc-mark.png', optimize=True)

tile(64, 14).save(BRAND / 'favicon-64.png', optimize=True)
tile(180, 0).save(BRAND / 'apple-touch-icon.png', optimize=True)
print('wrote', ', '.join(p.name for p in sorted(BRAND.glob('*.png'))))
