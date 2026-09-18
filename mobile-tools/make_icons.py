#!/usr/bin/env python3
"""Render the KumaWatch home-screen icons.

iOS ignores SVG for ``apple-touch-icon``, so the PNGs have to exist as files.
Rather than add an image dependency to a repository that otherwise needs none,
the few circles and ellipses this mark is made of are rasterised here with 4x
supersampling and written through ``zlib`` as plain RGB PNGs.

Usage:
    python mobile-tools/make_icons.py
"""
from __future__ import annotations

import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "mobile-icons"

BG = (0x14, 0x33, 0x21)      # deep forest green
FUR = (0x6a, 0xdf, 0x8a)     # KumaWatch accent
MUZZLE = (0xdc, 0xf5, 0xe2)
DARK = (0x0b, 0x1a, 0x10)

SS = 4                        # supersampling factor


def shapes(scale: float):
    """Bear mark in unit coordinates, scaled about the centre.

    ``scale`` shrinks the drawing so that a circular maskable crop cannot cut
    into the ears.
    """
    def s(x, y):
        return 0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale

    def r(v):
        return v * scale

    out = []
    for cx, cy in ((0.29, 0.34), (0.71, 0.34)):                  # ears
        out.append(("e", s(cx, cy), r(0.135), r(0.135), FUR))
    for cx, cy in ((0.30, 0.35), (0.70, 0.35)):                  # inner ears
        out.append(("e", s(cx, cy), r(0.062), r(0.062), BG))
    out.append(("e", s(0.5, 0.57), r(0.30), r(0.285), FUR))      # head
    out.append(("e", s(0.5, 0.67), r(0.155), r(0.120), MUZZLE))  # muzzle
    out.append(("e", s(0.405, 0.51), r(0.040), r(0.044), DARK))  # eyes
    out.append(("e", s(0.595, 0.51), r(0.040), r(0.044), DARK))
    out.append(("e", s(0.5, 0.625), r(0.058), r(0.042), DARK))   # nose
    return out


def render(size: int, scale: float) -> bytes:
    n = size * SS
    prims = shapes(scale)
    # Accumulate at supersampled resolution, then box-filter down.
    hi = [[BG] * n for _ in range(n)]
    for kind, (cx, cy), rx, ry, colour in prims:
        assert kind == "e"
        cxp, cyp, rxp, ryp = cx * n, cy * n, rx * n, ry * n
        y0, y1 = max(0, int(cyp - ryp) - 1), min(n - 1, int(cyp + ryp) + 1)
        x0, x1 = max(0, int(cxp - rxp) - 1), min(n - 1, int(cxp + rxp) + 1)
        for y in range(y0, y1 + 1):
            dy = (y + 0.5 - cyp) / ryp
            if abs(dy) > 1:
                continue
            row = hi[y]
            for x in range(x0, x1 + 1):
                dx = (x + 0.5 - cxp) / rxp
                if dx * dx + dy * dy <= 1.0:
                    row[x] = colour

    raw = bytearray()
    inv = 1.0 / (SS * SS)
    for y in range(size):
        raw.append(0)                      # PNG filter: none
        rows = hi[y * SS:(y + 1) * SS]
        for x in range(size):
            r = g = b = 0
            for row in rows:
                for px in row[x * SS:(x + 1) * SS]:
                    r += px[0]; g += px[1]; b += px[2]
            raw += bytes((int(r * inv + .5), int(g * inv + .5), int(b * inv + .5)))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # apple-touch-icon is masked by iOS itself, so it keeps a fuller drawing;
    # the manifest icons are declared maskable and stay inside the safe zone.
    for name, size, scale in (("apple-touch-icon.png", 180, 0.88),
                              ("icon-192.png", 192, 0.76),
                              ("icon-512.png", 512, 0.76)):
        path = OUT / name
        path.write_bytes(render(size, scale))
        print(f"{path.relative_to(OUT.parent)}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
