#!/usr/bin/env python3
"""Generate original PinVault icons (16/32/48/128 PNG + SVG source).

Original design: rounded-square red badge with a white vault door whose
center dial forms a downward download arrow. No Pinterest trademarks.
"""
import os
import math

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit("Pillow is required: pip install pillow")


def rounded_rect(draw, xy, radius, fill):
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    # Background badge (rounded square)
    pad = int(s * 0.04)
    rounded_rect(d, (pad, pad, s - pad, s - pad), int(s * 0.22), (230, 0, 35, 255))

    # Vault door: rounded rect, lighter red
    door_pad = int(s * 0.22)
    rounded_rect(
        d,
        (door_pad, door_pad, s - door_pad, s - door_pad),
        int(s * 0.10),
        (255, 255, 255, 235),
    )

    # Door seam: vertical line
    seam = int(s * 0.5)
    d.line((seam, door_pad, seam, s - door_pad), fill=(230, 0, 35, 255), width=max(1, int(s * 0.02)))

    # Vault dial: circle
    cx, cy = seam, int(s * 0.42)
    r = int(s * 0.10)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(230, 0, 35, 255), width=max(1, int(s * 0.025)))

    # Download arrow (white on red) below dial
    ax, ay = seam, int(s * 0.55)
    aw = int(s * 0.12)  # half width
    ah = int(s * 0.06)
    # stem
    d.line((ax, ay, ax, int(s * 0.82)), fill=(230, 0, 35, 255), width=max(2, int(s * 0.035)))
    # head
    d.polygon(
        [
            (ax - aw, int(s * 0.72)),
            (ax + aw, int(s * 0.72)),
            (ax, int(s * 0.82)),
        ],
        fill=(230, 0, 35, 255),
    )
    # baseline
    base_y = int(s * 0.82)
    d.line((int(s * 0.32), base_y, int(s * 0.68), base_y), fill=(230, 0, 35, 255), width=max(1, int(s * 0.02)))
    return img


SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff3d5c"/>
      <stop offset="1" stop-color="#b3001b"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bg)"/>
  <rect x="28" y="28" width="72" height="72" rx="12" fill="#ffffff" opacity="0.94"/>
  <line x1="64" y1="28" x2="64" y2="100" stroke="#e60023" stroke-width="3"/>
  <circle cx="64" cy="53" r="13" fill="none" stroke="#e60023" stroke-width="3.5"/>
  <line x1="64" y1="70" x2="64" y2="102" stroke="#e60023" stroke-width="4.5"/>
  <polygon points="47,92 81,92 64,106" fill="#e60023"/>
  <line x1="42" y1="106" x2="86" y2="106" stroke="#e60023" stroke-width="3"/>
</svg>
"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        draw_icon(size).save(os.path.join(OUT_DIR, f'icon{size}.png'))
    with open(os.path.join(OUT_DIR, 'icon.svg'), 'w', encoding='utf-8') as f:
        f.write(SVG)
    print('Icons written to', os.path.abspath(OUT_DIR))


if __name__ == '__main__':
    main()
