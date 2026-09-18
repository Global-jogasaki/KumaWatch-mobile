/* Headless smoke test for the mobile site.
 *
 *   node mobile-tools/test/smoke.js [--headed] [--shots DIR]
 *
 * Emulates an iPhone-sized viewport with touch input, drives the real pages,
 * and fails on any console error. Leaflet and the OpenStreetMap tiles are
 * replaced by mobile-tools/test/leaflet-stub.js and a blank tile, so the test needs
 * no network access. */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = (() => {
  const i = process.argv.indexOf('--shots');
  return i > 0 ? path.resolve(process.argv[i + 1]) : null;
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

/* Pull the default-language strings out of a page the same way the runtime
   does, so the markup and the dictionary can be compared without a browser. */
function markupStrings(html) {
  const out = {};
  const re = /data-i18n(-html|-aria)?="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const [, kind, key] = m;
    const start = html.lastIndexOf('<', m.index);
    const tag = /^<([a-zA-Z0-9]+)/.exec(html.slice(start))[1];
    const openEnd = html.indexOf('>', m.index + m[0].length);
    let val;
    if (kind === '-aria') {
      val = /aria-label="([^"]*)"/.exec(html.slice(start, openEnd + 1))[1];
    } else {
      let depth = 1, i = openEnd + 1, close = -1;
      const tagRe = new RegExp('<(/?)' + tag + '[\\s>/]', 'g');
      tagRe.lastIndex = i;
      let t;
      while ((t = tagRe.exec(html))) {
        depth += t[1] ? -1 : 1;
        if (!depth) { close = t.index; break; }
      }
      val = html.slice(openEnd + 1, close);
    }
    out[key] = val.replace(/\s+/g, ' ').trim();
  }
  return out;
}

/* Evaluate a strings-*.js file outside the browser. */
function loadDict(file) {
  const dict = { en: {}, ja: {} };
  const KW = {
    addStrings(add) {
      for (const lang of Object.keys(add)) Object.assign(dict[lang], add[lang]);
    }
  };
  new Function('KW', fs.readFileSync(file, 'utf8'))(KW);
  return dict;
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: !process.argv.includes('--headed')
  });
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    // The device descriptor targets WebKit; Chromium provides the same
    // viewport, DPR, touch and mobile flags.
    userAgent: devices['iPhone 14'].userAgent,
    // Service workers bypass page-level request routing, which would send the
    // stubbed Leaflet request to the real unpkg.com. Offline behaviour is out
    // of scope for this test.
    serviceWorkers: 'block',
  });

  const errors = [];
  context.on('weberror', e => errors.push(String(e.error())));

  const stub = fs.readFileSync(path.join(__dirname, 'leaflet-stub.js'), 'utf8');
  await context.route('**/unpkg.com/**/leaflet.js', r =>
    r.fulfill({ contentType: 'text/javascript', body: stub }));
  await context.route('**/unpkg.com/**/leaflet.css', r =>
    r.fulfill({ contentType: 'text/css', body: '.leaflet-container{position:relative}' }));
  /* Basemap tiles: answered with a 1x1 PNG so the test needs no network, and
     counted so a regression back to a blocked tile host is caught. */
  const tileHosts = new Set();
  const BLANK_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64');
  await context.route(/tile|xyz\/pale/, r => {
    tileHosts.add(new URL(r.request().url()).hostname);
    return r.fulfill({ contentType: 'image/png', body: BLANK_PNG });
  });

  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  /* ── dictionaries agree with the markup they replace ───────────────── */
  for (const [page, file, lang] of [
    ['index.html', 'strings-index.js', 'en'],
    ['map.html', 'strings-map.js', 'ja'],
  ]) {
    const inMarkup = markupStrings(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    const dict = loadDict(path.join(ROOT, 'mobile-assets', file));
    const drift = Object.entries(inMarkup)
      .filter(([k, v]) => dict[lang][k] !== v)
      .map(([k]) => k);
    const untranslated = Object.keys(inMarkup)
      .filter(k => dict[lang === 'en' ? 'ja' : 'en'][k] === undefined);
    check(`${page}: markup matches the ${lang} dictionary`, drift.length === 0,
      drift.slice(0, 3).join(', '));
    check(`${page}: every key is translated`, untranslated.length === 0,
      untranslated.slice(0, 3).join(', '));
  }

  /* ── landing page ──────────────────────────────────────────────────── */
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  check('index: title', (await page.title()).includes('KumaWatch'));

  const bars = await page.locator('.metric').first().locator('.bar-row').count();
  check('index: compact bar view built from the table', bars === 10, `${bars} rows`);

  const firstBar = await page.locator('.metric').first().locator('.bar-row').first().innerText();
  check('index: bars sorted, best first', firstBar.includes('GLM-Logit') && firstBar.includes('0.5470'),
    firstBar.replace(/\n/g, ' '));

  const fillW = await page.locator('.metric').first().locator('.bar-fill').first()
    .evaluate(n => n.getBoundingClientRect().width);
  check('index: bar fill rendered', fillW > 100, `${Math.round(fillW)}px`);

  await page.locator('.metric').first().locator('.seg button[data-view="table"]').tap();
  const m0 = page.locator('.metric').first();
  check('index: table view reachable in one tap',
    await m0.locator('.tbl-wrap').isVisible() && !(await m0.locator('.bars').isVisible()));
  await m0.locator('.seg button[data-view="bars"]').tap();

  /* Language switch: the header control rewrites the page in place. */
  await page.locator('.lang button[data-lang="ja"]').tap();
  await page.waitForTimeout(150);
  const jaHero = await page.locator('.hero .sub').innerText();
  check('index: switches to Japanese from the header',
    jaHero.includes('野生動物遭遇予測') && (await page.getAttribute('html', 'lang')) === 'ja',
    jaHero.slice(0, 28));
  const jaMethod = await page.locator('.metric table tbody tr td').first().innerText();
  check('index: table and bar view follow the switch', jaMethod === 'GLM-Logit' &&
    (await page.locator('.metric .bar-row').first().innerText()).includes('0.5470'));
  const jaB1 = await page.locator('.metric table tbody tr:nth-child(4) td').first().innerText();
  check('index: baseline names are translated too', jaB1 === 'B1: 静的事前確率', jaB1);
  check('index: numbers are untouched by the switch',
    (await page.locator('.metric table tbody tr td.n').first().innerText()) === '0.3448');
  await page.locator('.lang button[data-lang="en"]').tap();
  await page.waitForTimeout(150);
  check('index: switches back to English',
    (await page.locator('.hero .sub').innerText()).includes('Benchmarking Wildlife'));

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('index: no horizontal page overflow', overflow <= 0, `${overflow}px`);

  const small = await page.evaluate(() => {
    let worst = 99;
    document.querySelectorAll('p, td, .stat-lbl, .small, .tnote').forEach(n => {
      if (n.offsetParent === null || !n.textContent.trim()) return;
      worst = Math.min(worst, parseFloat(getComputedStyle(n).fontSize));
    });
    return worst;
  });
  check('index: no text below 10px', small >= 10, `${small}px`);

  const taps = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('a.btn, .topbar .go, .seg button, .actionbar button').forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.height && r.height < 34) bad.push(n.className + ':' + Math.round(r.height));
    });
    return bad;
  });
  check('index: touch targets tall enough', taps.length === 0, taps.join(', '));

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'index.png'), fullPage: false });

  /* ── map ───────────────────────────────────────────────────────────── */
  await page.goto(`${base}/map.html?d=2025-10-15&l=glm&k=20&lang=ja`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 });
    check('map: data loaded, loader dismissed', true);
  } catch (e) {
    check('map: data loaded, loader dismissed', false,
      (await page.locator('#loader-msg').innerText()).replace(/\n/g, ' '));
    throw e;
  }

  check('map: date from the URL', (await page.locator('#date-display').innerText()) === '2025-10-15');
  const rows = await page.locator('#rank-list .rank-row').count();
  check('map: ranking list filled', rows === 20, `${rows} rows`);
  check('map: actual sightings for 2025-10-15',
    (await page.locator('#st-actual').innerText()) === '30',
    await page.locator('#st-actual').innerText());

  const painted = await page.evaluate(() =>
    [...document.querySelectorAll('.stub-rect')].filter(n => parseFloat(n.style.opacity) > 0).length);
  check('map: exactly K cells painted', painted === 20, `${painted} cells`);

  // Detail view via the ranking list.
  await page.locator('#rank-list .rank-row').first().tap();
  await page.waitForSelector('#detail.on');
  const city = await page.locator('#dp-city').innerText();
  const glmRank = await page.locator('#dp-rank').innerText();
  check('map: detail opens on the top-ranked cell', glmRank.startsWith('第1位'), `${city} / ${glmRank}`);
  check('map: history counts present', /\d/.test(await page.locator('#dp-h365').innerText()));
  await page.locator('#detail-back').tap();
  check('map: back returns to the ranking', await page.locator('#rank-panel').isVisible());

  // Budget chips.
  await page.locator('#topn-rail .chip[data-n="5"]').tap();
  const painted5 = await page.evaluate(() =>
    [...document.querySelectorAll('.stub-rect')].filter(n => parseFloat(n.style.opacity) > 0).length);
  check('map: budget chip repaints the grid', painted5 === 5, `${painted5} cells`);
  await page.locator('#topn-rail .chip[data-n="20"]').tap();

  // Layer switch: Extra Trees is rank-tiered, not probability-tiered.
  await page.locator('#layer-rail .chip[data-layer="et"]').tap();
  check('map: layer switch relabels the legend',
    (await page.locator('#leg-mode').innerText()) === '当日の相対順位',
    await page.locator('#leg-0').innerText());
  check('map: raw scores shown unformatted for Extra Trees',
    !(await page.locator('#rank-list .rank-row').first().innerText()).includes('%'));
  await page.locator('#layer-rail .chip[data-layer="glm"]').tap();

  // Date navigation.
  await page.locator('#next-day').tap();
  check('map: next-day advances', (await page.locator('#date-display').innerText()) === '2025-10-16');
  await page.locator('#prev-day').tap();

  // URL keeps the view shareable.
  await page.waitForTimeout(600);
  check('map: URL reflects the view', page.url().includes('d=2025-10-15') && page.url().includes('k=20'),
    page.url().slice(page.url().indexOf('?')));

  // Bottom sheet: tapping the handle expands it past the peek height.
  const peekBox = await page.locator('#sheet').boundingBox();
  await page.locator('#grab').tap();
  await page.waitForTimeout(450);
  const openBox = await page.locator('#sheet').boundingBox();
  check('map: sheet expands when the handle is tapped', openBox.y < peekBox.y - 80,
    `${Math.round(peekBox.y)} → ${Math.round(openBox.y)}`);

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'map-open.png') });

  await page.locator('#grab').tap();     // back to peek
  await page.waitForTimeout(450);
  const vh = page.viewportSize().height;
  const play = await page.locator('#play-btn').boundingBox();
  check('map: playback controls fit in the collapsed sheet',
    play.y + play.height <= vh, `bottom ${Math.round(play.y + play.height)} of ${vh}`);
  const mb = await page.locator('#mapbtns').boundingBox();
  const sb = await page.locator('#sheet').boundingBox();
  check('map: floating buttons clear the collapsed sheet', mb.y + mb.height <= sb.y + 1,
    `${Math.round(mb.y + mb.height)} vs ${Math.round(sb.y)}`);

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'map-peek.png') });

  /* ── landscape: the sheet becomes a side panel ─────────────────────── */
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const lsSheet = await page.locator('#sheet').boundingBox();
  check('landscape: sheet docks to the right edge as a panel',
    lsSheet.x > 400 && lsSheet.height >= 380,
    `x ${Math.round(lsSheet.x)}, h ${Math.round(lsSheet.height)}`);
  const lsBtns = await page.locator('#mapbtns').boundingBox();
  check('landscape: floating buttons clear the panel',
    lsBtns.x + lsBtns.width <= lsSheet.x + 1,
    `${Math.round(lsBtns.x + lsBtns.width)} vs ${Math.round(lsSheet.x)}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'map-landscape.png') });

  /* ── smallest phone still in use (iPhone SE, 320 px) ───────────────── */
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  const narrow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('320px: no horizontal overflow on the landing page', narrow <= 0, `${narrow}px`);
  await page.goto(`${base}/map.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 });
  const narrowMap = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('320px: map screen fits the viewport', narrowMap <= 0, `${narrowMap}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'map-320.png') });

  /* ── opened straight from disk (a copied folder, no web server) ────── */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('file://' + path.join(ROOT, 'map.html'));
  await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 });
  const fileRows = await page.locator('#rank-list .rank-row').count();
  check('file://: map works without a web server', fileRows === 20, `${fileRows} rows`);

  /* ── language on the map screen, and across a navigation ───────────── */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/map.html?d=2025-10-15&lang=en`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 });
  check('map: opens in the language the URL asks for',
    (await page.locator('#tb-layer').innerText()) === 'GLM-Logit score',
    await page.locator('#tb-layer').innerText());
  check('map: runtime strings follow the language',
    (await page.locator('#leg-0').innerText()).startsWith('Critical') &&
    (await page.locator('#play-btn').innerText()).includes('Play'),
    await page.locator('#leg-0').innerText());
  check('map: month rail is translated',
    (await page.locator('#month-rail .chip').first().innerText()) === 'Jan');

  await page.locator('#rank-list .rank-row').first().tap();
  check('map: detail panel is translated',
    (await page.locator('#dp-rank').innerText()).startsWith('Rank 1 of'),
    await page.locator('#dp-rank').innerText());
  await page.locator('#detail-back').tap();

  await page.locator('.lang button[data-lang="ja"]').tap();
  await page.waitForTimeout(200);
  check('map: switches to Japanese without reloading',
    (await page.locator('#tb-layer').innerText()) === 'GLM-Logit スコア' &&
    (await page.locator('#month-rail .chip').first().innerText()) === '1月');
  check('map: the day stays put across the switch',
    (await page.locator('#date-display').innerText()) === '2025-10-15');

  /* The choice is remembered when moving between the two pages. */
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  check('the language choice carries across pages',
    (await page.locator('.hero .sub').innerText()).includes('野生動物遭遇予測'));
  await page.locator('.lang button[data-lang="en"]').tap();

  await page.goto(`${base}/map.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 });

  check('basemap uses 地理院タイル (GSI), not a tile host that blocks file://',
    tileHosts.size > 0 && [...tileHosts].every(h => h === 'cyberjapandata.gsi.go.jp'),
    [...tileHosts].join(', ') || 'no tile requested');

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
