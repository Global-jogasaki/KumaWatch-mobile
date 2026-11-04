#!/usr/bin/env python3
"""Render the README's QR code for the published site.

The site is built for phones, but the README is read on a desktop, so the
quickest way onto a phone is a code to point a camera at.

Needs the `qrcode` package for the encoding (`pip install qrcode`); the PNG is
written here, as in make_icons.py, to keep the repository free of an image
dependency.

Usage:
    python mobile-tools/make_qr.py [URL] [-o mobile-docs/qr-site.png]
"""
from __future__ import annotations

import argparse
import pathlib
import struct
import sys
import zlib

DEFAULT_URL = "https://global-jogasaki.github.io/KumaWatch-mobile/"
DEFAULT_OUT = "mobile-docs/qr-site.png"

DARK = (0x14, 0x33, 0x21)     # same forest green as the app icon
LIGHT = (0xFF, 0xFF, 0xFF)    # a white quiet zone scans under either GitHub theme
SCALE = 8                     # pixels per module
QUIET = 4                     # modules of margin, as the QR spec requires


def png(rows: list[list[tuple[int, int, int]]]) -> bytes:
    raw = bytearray()
    for row in rows:
        raw.append(0)                       # filter: none
        for px in row:
            raw += bytes(px)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    h, w = len(rows), len(rows[0])
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", nargs="?", default=DEFAULT_URL)
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    try:
        import qrcode
    except ImportError:
        raise SystemExit("needs the qrcode package: pip install qrcode")

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=QUIET)
    qr.add_data(args.url)
    qr.make(fit=True)
    matrix = qr.get_matrix()          # already includes the quiet zone

    rows = []
    for line in matrix:
        pixels = []
        for module in line:
            pixels += [DARK if module else LIGHT] * SCALE
        rows += [pixels] * SCALE

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png(rows))
    print(f"{out}: {len(matrix)}x{len(matrix)} modules, {len(rows)}px, "
          f"{out.stat().st_size / 1024:.1f} kB")
    print(f"  encodes {args.url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
