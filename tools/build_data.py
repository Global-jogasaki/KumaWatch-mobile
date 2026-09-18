#!/usr/bin/env python3
"""Extract the daily score matrices from the desktop KumaWatch map into a
compact JSON payload for the mobile site.

The desktop map (``maps/kumawatch_primary_layer.html`` in todalaba/KumaWatch)
inlines ~2.3 MB of JSON in two ``const`` declarations. Inlining that much data
costs a mobile client a 2.3 MB parse before the first paint, so the mobile
build fetches it separately and stores it column-wise, which removes the
repeated cell-id keys.

Values are copied verbatim — no rounding, no re-scaling — so the mobile map
ranks cells exactly as the published map does.

Usage:
    python tools/build_data.py [SOURCE_HTML] [-o data/yamagata_2025.json]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import gzip
import json
import pathlib
import re
import sys

LAYERS = ["glm", "hb", "ttm", "et", "act"]
DEFAULT_SRC = "../KumaWatch/maps/kumawatch_primary_layer.html"
DEFAULT_OUT = "data/yamagata_2025.json"


def parse_source(html: str) -> tuple[dict, dict]:
    m = re.search(r"const COORDS\s*=\s*(\{.*?\});?\s*\nconst DAILY\s*=\s*(\{.*?\});?\s*\n",
                  html, re.S)
    if not m:
        raise SystemExit("COORDS / DAILY blocks not found in the source map")
    return json.loads(m.group(1)), json.loads(m.group(2))


def build(coords: dict, daily: dict) -> dict:
    gids = list(coords)
    dates = sorted(daily)
    missing = [d for d in dates if set(daily[d]) != set(gids)]
    if missing:
        raise SystemExit(f"cell set differs from COORDS on {len(missing)} day(s), e.g. {missing[0]}")
    return {
        "meta": {
            "source": "todalaba/KumaWatch maps/kumawatch_primary_layer.html",
            "prefecture": "山形県",
            "cell_km": 10,
            "layers": ["glm", "hb", "ttm", "et"],
            "n_cells": len(gids),
            "train_period": "2018-10 – 2024-12",
            "test_period": "2025-01-01 – 2025-12-31",
            "built": _dt.date.today().isoformat(),
        },
        # Cell ids, in the order every array below uses.
        "gids": gids,
        # Municipality label, "" for cells the desktop map leaves unlabelled.
        "cities": [c["city"] if c.get("city") and c["city"] != g else "" for g, c in coords.items()],
        # [lat_min, lng_min, lat_max, lng_max]; the centre is the midpoint.
        "bounds": [[c["lat_min"], c["lng_min"], c["lat_max"], c["lng_max"]] for c in coords.values()],
        # Training-period sighting counts: [last 30 d, 2024 total, all time].
        "hist": [[c.get("h30", 0), c.get("h365", 0), c.get("hall", 0)] for c in coords.values()],
        "dates": dates,
        # daily[d][layer][cell] — five rows per day: glm, hb, ttm, et, actual.
        "daily": [[[daily[d][g][k] for g in gids] for k in range(5)] for d in dates],
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", default=DEFAULT_SRC)
    ap.add_argument("-o", "--out", default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    src = pathlib.Path(args.source)
    payload = build(*parse_source(src.read_text(encoding="utf-8")))

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    out.write_text(text, encoding="utf-8")

    raw = len(text.encode("utf-8"))
    gz = len(gzip.compress(text.encode("utf-8"), 9))
    print(f"{out}: {len(payload['gids'])} cells x {len(payload['dates'])} days")
    print(f"  {raw/1e6:.2f} MB raw, {gz/1e3:.0f} kB gzipped "
          f"(source HTML {src.stat().st_size/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
