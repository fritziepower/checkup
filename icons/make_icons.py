# Generates the pixel-art heart app icons. Run: python3 icons/make_icons.py
from PIL import Image, ImageDraw
HEART = [
"..XXX...XXX..",
".XXXXX.XXXXX.",
"XXWWXXXXXXXXX",
"XXWXXXXXXXXXX",
"XXXXXXXXXXXXX",
"XXXXXXXXXXXXX",
".XXXXXXXXXXX.",
"..XXXXXXXXX..",
"...XXXXXXX...",
"....XXXXX....",
".....XXX.....",
"......X......",
]
def make(size, path, pad=0.22):
    grid = 32
    img = Image.new("RGB", (grid, grid), (255, 214, 232))
    d = ImageDraw.Draw(img)
    # terminal window
    d.rectangle([3, 4, 28, 27], fill=(255, 247, 251), outline=(122, 62, 98))
    d.rectangle([4, 5, 27, 8], fill=(255, 179, 214))
    for i, c in enumerate([(255, 110, 150), (200, 160, 255), (140, 220, 190)]):
        d.point((6 + i * 2, 6), fill=c); d.point((6 + i * 2, 7), fill=c)
    ox, oy = 9, 12
    for y, row in enumerate(HEART):
        for x, ch in enumerate(row):
            if ch == "X": d.point((ox + x, oy + y), fill=(255, 92, 150))
            elif ch == "W": d.point((ox + x, oy + y), fill=(255, 255, 255))
    img.resize((size, size), Image.NEAREST).save(path)
for s, n in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    make(s, f"icons/{n}")
