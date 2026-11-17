#!/usr/bin/env python3
"""Generate PWA icons (dark tile, green upward chart) into icons/."""
from pathlib import Path
from PIL import Image, ImageDraw

BG = (7, 9, 12, 255)
BLUE = (77, 163, 255, 255)
GREEN = (34, 197, 94, 255)
OUT = Path(__file__).resolve().parents[1] / "icons"

def render(size, *, maskable=False):
    scale = 8
    S = size * scale
    img = Image.new("RGBA", (S, S), BG)
    d = ImageDraw.Draw(img)
    if maskable:
        box = (int(S * 0.20), int(S * 0.20), int(S * 0.80), int(S * 0.80))
    else:
        margin = int(S * 0.06)
        radius = int(S * 0.22)
        tile = (18, 28, 36, 255)
        d.rounded_rectangle((margin, margin, S - 1 - margin, S - 1 - margin), radius=radius, fill=tile)
        sw = max(scale, int(S * 0.035))
        inset = margin + sw // 2
        d.rounded_rectangle(
            (inset, inset, S - 1 - inset, S - 1 - inset),
            radius=max(0, radius - sw // 2),
            outline=BLUE,
            width=sw,
        )
        box = (int(S * 0.22), int(S * 0.22), int(S * 0.78), int(S * 0.78))
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    src = [(8, 20), (13, 13), (17, 17), (24, 9)]
    sx0, sy0, sx1, sy1 = 8, 9, 24, 20
    def map_pt(x, y):
        return (x0 + (x - sx0) / (sx1 - sx0) * w, y0 + (y - sy0) / (sy1 - sy0) * h)
    pts = [map_pt(x, y) for x, y in src]
    line_w = max(scale * 2, int(S * 0.055))
    d.line(pts, fill=GREEN, width=line_w, joint="curve")
    r_cap = line_w / 2
    for p in pts:
        d.ellipse((p[0] - r_cap, p[1] - r_cap, p[0] + r_cap, p[1] + r_cap), fill=GREEN)
    end = pts[-1]
    r = max(line_w * 0.85, int(S * 0.04))
    d.ellipse((end[0] - r, end[1] - r, end[0] + r, end[1] + r), fill=GREEN)
    return img.resize((size, size), Image.Resampling.LANCZOS)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    render(192).save(OUT / "icon-192.png", "PNG")
    render(512).save(OUT / "icon-512.png", "PNG")
    render(512, maskable=True).save(OUT / "icon-maskable-512.png", "PNG")
    render(180).save(OUT / "apple-touch-icon.png", "PNG")

if __name__ == "__main__":
    main()
