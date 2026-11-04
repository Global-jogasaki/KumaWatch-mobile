# KumaWatch — Mobile Edition 🐻📱

[![Live site](https://img.shields.io/badge/Live%20site-GitHub%20Pages-brightgreen.svg)](https://global-jogasaki.github.io/KumaWatch-mobile/)
[![Code](https://img.shields.io/badge/code-Apache%202.0-blue.svg)](LICENSE)
[![Data](https://img.shields.io/badge/data-CC%20BY%204.0-blue.svg)](https://creativecommons.org/licenses/by/4.0/)

## 🌐 公開サイト / Live site

### https://global-jogasaki.github.io/KumaWatch-mobile/

| ページ | 内容 |
|---|---|
| [**📱 トップページ**](https://global-jogasaki.github.io/KumaWatch-mobile/) | ベンチマーク結果 — Recall@K / Precision@K / ROC-AUC / 日次ケース |
| [**🗺️ 予測マップ**](https://global-jogasaki.github.io/KumaWatch-mobile/map.html) | 山形県 144セル × 365日 × 4レイヤーのインタラクティブマップ |
| [**🌐 English**](https://global-jogasaki.github.io/KumaWatch-mobile/?lang=en) | 日本語 / English は各ページ右上でいつでも切り替え |

<img src="mobile-docs/qr-site.png" alt="QR code for https://global-jogasaki.github.io/KumaWatch-mobile/" width="150">

スマートフォンのカメラでこのQRコードを読み取ると、そのまま開けます。
ホーム画面に追加しておくと、次回以降は通信がなくても開けます(背景地図を除く)。

マップのURLは日付・レイヤー・表示セル数・言語を保持するので、特定の日の予測をそのまま共有できます —
例: [2025-10-15 の GLM-Logit 上位20セル](https://global-jogasaki.github.io/KumaWatch-mobile/map.html?d=2025-10-15&l=glm&k=20&lang=ja)。

---

スマートフォン(iPhone / Android)向けに最適化した **KumaWatch** の公開サイトです。
デスクトップ版([todalaba/KumaWatch](https://github.com/todalaba/KumaWatch) / [Global-jogasaki/KumaWatch](https://github.com/Global-jogasaki/KumaWatch))と
**同一の公開済みスコア行列・同一の数値**を、片手操作・低速回線・小さい画面を前提に作り直したものです。

> ⚠ 本マップの予測は行政機関による公式の出没情報・警告に代わるものではありません。
> 2025年は厳密なホールドアウト期間であり、運用評価(パトロール効率・被害低減)の主張は一切行いません。

- **Landing page** — `index.html`: ベンチマーク結果(Recall@K / Precision@K / ROC-AUC / 日次ケース)
- **Map** — `map.html`: 山形県 144セル × 365日 × 4レイヤーのインタラクティブマップ

Related paper: *Benchmarking Wildlife Encounter Prediction for Municipal Decision Support in Northern Japan*,
ACM SIGSPATIAL 2026, Applications Track (short paper).

---

## What is different from the desktop site

| | Desktop (`KumaWatch`) | Mobile (this repository) |
|---|---|---|
| Map payload | 2.37 MB HTML with the score matrices inlined | 40 kB shell + `mobile-data/yamagata_2025.json` fetched in parallel (1.89 MB raw, **≈ 358 kB gzipped**), started from the page `<head>` before Leaflet parses |
| Data layout | `{date: {cell_id: [...]}}` — the cell ids repeat 52,560 times | column-wise arrays in a fixed cell order; identical values, no rounding |
| Controls | 315 px left sidebar, hover-driven | draggable bottom sheet with peek / half / full snap points, every control inside the thumb arc |
| Layer & budget | `<select>` + 1–144 slider | chip rails (GLM-Logit / HierBayes / TTM / Extra Trees, 上位5–全144) |
| Touch targets | 24–30 px | ≥ 44 px (Apple HIG), `touch-action: manipulation` to drop the 300 ms tap delay |
| Tables | wide tables in a scroll box | ranked bar view by default, full table one tap away, first column pinned while scrolling |
| Viewport | fixed `100vh` | `100dvh` + `env(safe-area-inset-*)` — correct under the notch, the home indicator and Safari's collapsing URL bar |
| Offline | none | service worker caches the shell, the scores and Leaflet (map tiles are deliberately **not** cached) |
| Basemap | OpenStreetMap tiles | 地理院タイル (GSI, 淡色地図) — OSM's volunteer tile servers answer 403 to a page opened from `file://`, which a copied folder always is |
| Home screen | none | web app manifest + `apple-touch-icon`, standalone display, iOS "Add to Home Screen" hint |
| Sharing a view | none | `map.html?d=2025-10-15&l=glm&k=20` — day, layer and budget live in the URL |
| Location | none | 現在地ボタン: shows the device position and opens the containing grid cell |
| Language | landing page English, map Japanese | both pages in both languages, switched from the header (日本語 / EN), remembered across pages and carried in the URL |

Behaviour that is intentionally **unchanged**: the tier thresholds (GLM-Logit and HierBayes are cut on the
predicted probability, TTM and Extra Trees on the cell's rank that day, because their raw scores are not
calibrated), the daily ranking, the detail panel and the K = 20 default.

## Layout

```
index.html                 # landing page — benchmark tables, mobile-first
map.html                   # map screen — Leaflet + bottom sheet
mobile-assets/
  base.css                 # shared tokens (colour, spacing, safe areas, tap size)
  i18n.js                  # language switch: dictionary lookup + data-i18n binding
  strings-index.js         # landing-page strings, en + ja
  strings-map.js           # map-screen strings, en + ja
  index.css  index.js      # landing page
  map.css    map.js        # map screen
mobile-data/
  yamagata_2025.json       # 144 cells x 365 days x 5 series (glm, hb, ttm, et, actual)
  yamagata_2025.js         # same payload as a <script> tag, for file:// use
mobile-icons/              # SVG favicon + PNG home-screen icons
manifest.webmanifest       # installable web app
sw.js                      # offline cache (shell + scores + Leaflet)
mobile-tools/
  build_data.py            # rebuild mobile-data/*.json from the desktop map
  make_icons.py            # rasterise the home-screen icons (no image dependencies)
  make_qr.py               # render the README's QR code for the live site
  test/smoke.js            # headless iPhone-sized smoke test
mobile-docs/
  qr-site.png              # QR code shown in this README
```

## Languages

Both pages exist in Japanese and English and switch in place from the control in the header. The choice
is kept in `localStorage`, so it carries from one page to the other, and written to the URL
(`?lang=ja`), so a shared link opens in the language it was shared in. With no choice stored, the
browser's own language decides.

Text lives in `mobile-assets/strings-*.js`, once per language. **No number from the paper appears in a
dictionary** — every metric stays in the markup, so a value cannot say one thing in Japanese and
something else in English. The smoke test enforces both halves of that contract: the markup must match
its page's default-language dictionary word for word, and every key must exist in both languages.

## Data provenance

`mobile-data/yamagata_2025.json` is extracted from `maps/kumawatch_primary_layer.html` in the KumaWatch
repository — the same released score matrices the paper reports on. Values are copied verbatim, so the
mobile map ranks cells exactly as the published map does.

```bash
# from a checkout that sits next to a KumaWatch checkout
python mobile-tools/build_data.py                                   # default source path
python mobile-tools/build_data.py ../KumaWatch/maps/kumawatch_primary_layer.html
```

Each day holds five series per cell: `glm`, `hb` (HierBayes posterior mean), `ttm`, `et`, and `actual`
(reported sightings). Training data ends 2024-12-31; 2025 is a strict hold-out.

## Running locally

```bash
python -m http.server 8000     # any static server; the pages are plain files
open http://localhost:8000/
```

The map needs Leaflet 1.9.4 and 地理院タイル (GSI) basemap tiles from the network on first load;
afterwards the service worker serves the shell and the scores offline.

### From a copied folder, without a server

Copy the whole folder anywhere and open `index.html` directly — double-clicking it works. Browsers
block `fetch()` of a local file, so on `file://` the scores are pulled in through
`mobile-data/yamagata_2025.js` (the same payload, wrapped in a `<script>` assignment) instead of the
JSON. Everything but the basemap works offline this way; Leaflet and the 地理院タイル basemap still
come from the network, so without a connection the grid, ranking and detail panel render over an
empty background. Service workers do not run on `file://`, which is expected and harmless.

## Tests

```bash
npm install -D playwright          # or use an existing Playwright install
node mobile-tools/test/smoke.js           # add --shots DIR to save screenshots
```

The suite emulates an iPhone-sized viewport with touch input and drives both pages: bar/table views,
ranking, detail panel, layer and budget switching, date navigation, URL state, sheet snapping, the
landscape side-panel layout and a 320 px-wide screen. It fails on any console error. Leaflet and the
tiles are stubbed (`mobile-tools/test/leaflet-stub.js`), so it runs without network access.

## Deployment

GitHub Pages serves the repository root of `main` (https://global-jogasaki.github.io/KumaWatch-mobile/);
`.nojekyll` keeps Jekyll from touching the files. The site is plain static files, so there is no
build step and nothing to configure beyond the source branch:

> Settings → Pages → Source: *Deploy from a branch* → Branch: `main` / `(root)`

That switch has to be thrown once by a repository admin — creating the Pages site is a settings
write, which an API token scoped to repository contents cannot do.

The QR code above is regenerated with `python mobile-tools/make_qr.py` (needs `pip install qrcode`),
and only has to change if the published URL does.

## License

Code: Apache License 2.0 (see `LICENSE`).
Data: CC BY 4.0 — Yamagata & Akita prefectural wildlife observation databases (public).
Basemap: 地理院タイル (Geospatial Information Authority of Japan), shown with the attribution its
terms of use require.
Author: Hiroshi Jogasaki.
