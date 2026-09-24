"""Generate the PWA / home-screen PNG icons from the SmartGym logo geometry.

Pure standard library (no Pillow): the logo is a rounded square with a charcoal
diagonal gradient and a lime lightning bolt, the same shapes as public/favicon.svg.
Shapes are rasterised with exact horizontal coverage and 8 vertical sub-samples
for smooth edges.

    python scripts/generate_icons.py        # writes public/icons/*.png
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

# Logo geometry in the favicon's 64x64 viewBox.
BOLT = [(35.8, 7.5), (17.0, 35.2), (30.4, 35.2), (27.0, 56.5), (47.0, 27.7), (33.4, 27.7)]
GRADIENT = ((0x33, 0x37, 0x3F), (0x11, 0x13, 0x18))  # charcoal tile
LIME = (0xC6, 0xF4, 0x32)
SUBROWS = 8


def spans_polygon(points: list[tuple[float, float]], y: float) -> list[tuple[float, float]]:
    """Even-odd spans of a polygon on the horizontal line at y."""
    xs = []
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        if (y1 <= y < y2) or (y2 <= y < y1):
            xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    return list(zip(xs[::2], xs[1::2]))


def spans_rounded_rect(size: float, radius: float, y: float) -> list[tuple[float, float]]:
    if not 0 <= y < size:
        return []
    inset = 0.0
    if radius > 0:
        dy = radius - y if y < radius else y - (size - radius) if y > size - radius else 0.0
        if dy > 0:
            inset = radius - (max(radius * radius - dy * dy, 0.0)) ** 0.5
    return [(inset, size - inset)]


def coverage(size: int, span_fn) -> list[list[float]]:
    """Per-pixel coverage (0..1) of the shape returned by span_fn(y)."""
    grid = [[0.0] * size for _ in range(size)]
    weight = 1.0 / SUBROWS
    for py in range(size):
        row = grid[py]
        for s in range(SUBROWS):
            for a, b in span_fn(py + (s + 0.5) / SUBROWS):
                a, b = max(a, 0.0), min(b, float(size))
                if b <= a:
                    continue
                first, last = int(a), min(int(b), size - 1)
                for px in range(first, last + 1):
                    overlap = min(b, px + 1) - max(a, px)
                    if overlap > 0:
                        row[px] += overlap * weight
    return grid


def render(size: int, *, rounded: bool, glyph_scale: float) -> bytes:
    unit = size / 64
    radius = 16 * unit if rounded else 0.0
    bolt = [((32 + (x - 32) * glyph_scale) * unit, (32 + (y - 32) * glyph_scale) * unit) for x, y in BOLT]
    background = coverage(size, lambda y: spans_rounded_rect(size, radius, y))
    glyph = coverage(size, lambda y: spans_polygon(bolt, y))
    (r0, g0, b0), (r1, g1, b1) = GRADIENT
    pixels = bytearray()
    for py in range(size):
        pixels.append(0)  # PNG filter byte, replaced in encode()
        for px in range(size):
            t = (px + py + 1) / (2 * size)
            bg = (r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t)
            a_bg = min(background[py][px], 1.0)
            a_fg = min(glyph[py][px], 1.0)
            alpha = a_fg + a_bg * (1 - a_fg)
            if alpha <= 0:
                pixels += b"\x00\x00\x00\x00"
                continue
            rgb = [(LIME[i] * a_fg + bg[i] * a_bg * (1 - a_fg)) / alpha for i in range(3)]
            pixels += bytes(round(min(max(v, 0), 255)) for v in rgb) + bytes([round(alpha * 255)])
    return encode(size, pixels)


def encode(size: int, raw: bytearray) -> bytes:
    """PNG (RGBA8) with a per-row choice between the None/Sub/Up filters."""
    stride = size * 4 + 1
    out = bytearray()
    previous = bytes(size * 4)
    for y in range(size):
        line = bytes(raw[y * stride + 1 : (y + 1) * stride])
        sub = bytes((line[i] - (line[i - 4] if i >= 4 else 0)) & 0xFF for i in range(len(line)))
        up = bytes((line[i] - previous[i]) & 0xFF for i in range(len(line)))
        candidates = [(0, line), (1, sub), (2, up)]
        kind, data = min(candidates, key=lambda c: sum(v if v < 128 else 256 - v for v in c[1]))
        out.append(kind)
        out += data
        previous = line

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b"")


ICONS = {
    # Browsers / install prompts: the rounded logo on transparent corners.
    "icon-192.png": dict(size=192, rounded=True, glyph_scale=1.0),
    "icon-512.png": dict(size=512, rounded=True, glyph_scale=1.0),
    # Android adaptive icons crop to a circle/squircle: full-bleed background and the
    # bolt shrunk into the central 80% safe zone.
    "maskable-512.png": dict(size=512, rounded=False, glyph_scale=0.72),
    # iOS rounds the corners itself and shows transparency as black.
    "apple-touch-icon.png": dict(size=180, rounded=False, glyph_scale=0.86),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, options in ICONS.items():
        data = render(**options)
        (OUT / name).write_bytes(data)
        print(f"{name:22} {options['size']}x{options['size']}  {len(data) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
