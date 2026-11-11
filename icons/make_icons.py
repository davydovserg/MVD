"""Собирает иконки ярлыка: эмблема по центру на синем фоне.
Запуск: python icons/make_icons.py путь/к/эмблеме.png
Без аргумента берёт icons/emblem.png."""
import sys, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "emblem.png")
BLUE = (14, 42, 71)  # #0e2a47 — цвет шапки сайта

src = Image.open(SRC).convert("RGBA")
bbox = src.getbbox()
if bbox:
    src = src.crop(bbox)

def sky(size):
    """Радиальный градиент: светлый центр, синие края — как на образце."""
    import math
    img = Image.new("RGBA", (size, size))
    px = img.load()
    c1, c2, c3 = (106, 162, 226), (63, 120, 196), (42, 95, 171)
    cx, cy, R = size / 2, size * 0.42, size * 0.75
    for y in range(size):
        for x in range(size):
            t = min(1, math.hypot(x - cx, y - cy) / R)
            a, b, k = (c1, c2, t / .55) if t < .55 else (c2, c3, (t - .55) / .45)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3)) + (255,)
    return img

def make(size, scale, name):
    bg = sky(size)
    box = int(size * scale)
    em = src.copy()
    em.thumbnail((box, box), Image.LANCZOS)
    bg.alpha_composite(em, ((size - em.width) // 2, (size - em.height) // 2))
    bg.convert("RGB").save(os.path.join(HERE, name))

make(180, 0.86, "apple-touch-icon.png")   # iPhone
make(192, 0.86, "icon-192.png")           # Android
make(512, 0.86, "icon-512.png")
make(512, 0.66, "icon-maskable-512.png")  # Android с обрезкой в круг
make(48, 0.94, "favicon-48.png")          # вкладка браузера
print("ok")
