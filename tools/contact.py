# python tools/contact.py <dir> <out.png> [crop x0,y0,x1,y1] — labeled grid of the PNGs in a directory.
import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
crop = tuple(map(int, sys.argv[3].split(','))) if len(sys.argv) > 3 else (300, 120, 1300, 780)
files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
W, H = 500, int(500 * (crop[3] - crop[1]) / (crop[2] - crop[0]))
cols = 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * (H + 18)), (20, 20, 24))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).convert('RGB').crop(crop).resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 18)
    sheet.paste(im, (x, y + 18))
    dr.text((x + 4, y + 3), f, fill=(255, 255, 255))
sheet.save(out)
print(out, sheet.size)
