from PIL import Image

src = r"d:\file\20260726_Html\orbita\src-tauri\icons\logo-source.png"
out = src
public = r"d:\file\20260726_Html\orbita\public\icon.png"

im = Image.open(src).convert("RGBA")
px = im.load()
w, h = im.size


def is_leaf(r, g, b, a):
    if a < 10:
        return False
    if r > 200 and g > 200 and b > 200:
        return False
    if abs(r - g) < 12 and abs(g - b) < 12 and min(r, g, b) > 170:
        return False
    if abs(r - g) < 8 and abs(g - b) < 8 and 80 < r < 220:
        return False
    if r < 30 and g < 30 and b < 45:
        return False
    if r > 60 and b > 60 and g < max(r, b) - 15 and (r - g) > 20:
        return False
    if b > 80 and r > 40 and g < 80:
        return False
    return True


for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if is_leaf(r, g, b, a):
            px[x, y] = (r, g, b, a)
        else:
            px[x, y] = (0, 0, 0, 0)

im.save(out)
im.resize((128, 128), Image.Resampling.NEAREST).save(public)
print("saved", out, public)
