/* ==========================================================================
   KumaWatch mobile — map screen
   Port of maps/kumawatch_primary_layer.html (todalaba/KumaWatch) for phones.

   Behaviour kept identical to the desktop map: same score matrices, same
   tiering rules, same ranking, same detail panel. What changes is the shell —
   the 2.3 MB inline payload became a fetched JSON file, the sidebar became a
   draggable bottom sheet, and every control is a 44 px touch target.
   ========================================================================== */
(function () {
  'use strict';

  var DATA_URL = 'mobile-data/yamagata_2025.json';
  var DEFAULT_DATE = '2025-10-12';

  /* Column order inside data.daily[day] — see mobile-tools/build_data.py. */
  var COL = { glm: 0, hb: 1, ttm: 2, et: 3, act: 4 };

  var LAYER_NAMES = {
    glm: 'GLM-Logit スコア',
    hb: 'HierBayes 事後平均',
    ttm: 'TTM スコア',
    et: 'Extra Trees スコア'
  };
  var LAYER_NOTES = {
    glm: '主層。ロジスティック回帰による較正済み予測確率。論文の主結果 (Recall@20 = 0.547)。',
    hb: '不確実性層。階層ベイズの事後平均。GLM-Logit との差は有意ではない (p = 0.621)。',
    ttm: '補完層。IBM Granite TTM の生スコア。確率として較正されていない。',
    et: '補完層。Extra Trees の生スコア。強く誤較正されている (Brier Skill Score = −1.63)。'
  };

  /* GLM-Logit and HierBayes emit calibrated probabilities, so their tiers cut
     on the probability itself. TTM and Extra Trees do not — dressing their raw
     values as "70 % risk" would overstate danger to a municipal user, so those
     two are tiered by the cell's rank within the day instead. */
  var PROB_LAYERS = { glm: 1, hb: 1 };
  var PROB_TIERS = [0.20, 0.10, 0.05];
  var RANK_TIERS = [5, 10, 20];
  var TIER = [
    { cls: 't-alert', color: '#e81515' },
    { cls: 't-high', color: '#f06520' },
    { cls: 't-mid', color: '#e0b800' },
    { cls: 't-low', color: '#28a030' }
  ];
  var TIER_LABEL_PROB = ['緊急', '高危険', '警戒', '注意'];
  var TIER_LABEL_RANK = ['上位5', '上位10', '上位20', 'それ以外'];
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];

  var D = null;                 // payload from mobile-data/yamagata_2025.json
  var idx = 0;                  // current day index
  var layer = 'glm';
  var topN = 20;
  var playing = false;
  var playTimer = null;
  var selected = null;          // selected cell index, or null
  var map, rects = [], labels = [], gridBounds, meMarker = null, meCircle = null;

  var $ = function (id) { return document.getElementById(id); };

  /* ── tiering ───────────────────────────────────────────────────────────── */
  function tierOf(rank, value) {
    if (PROB_LAYERS[layer]) {
      if (value >= PROB_TIERS[0]) return 0;
      if (value >= PROB_TIERS[1]) return 1;
      if (value >= PROB_TIERS[2]) return 2;
      return 3;
    }
    if (rank <= RANK_TIERS[0]) return 0;
    if (rank <= RANK_TIERS[1]) return 1;
    if (rank <= RANK_TIERS[2]) return 2;
    return 3;
  }
  function tierInfo(rank, value) {
    var i = tierOf(rank, value);
    return {
      level: i,
      label: PROB_LAYERS[layer] ? TIER_LABEL_PROB[i] : TIER_LABEL_RANK[i],
      cls: TIER[i].cls,
      color: TIER[i].color
    };
  }
  function fmtScore(v) { return PROB_LAYERS[layer] ? (v * 100).toFixed(1) + '%' : v.toFixed(3); }
  function scores(dayIdx, which) { return D.daily[dayIdx][COL[which]]; }
  function cityOf(c) { return D.cities[c] || D.gids[c]; }

  /* Cell indices for the given day, best first. */
  function order(dayIdx, which) {
    var v = scores(dayIdx, which);
    var o = v.map(function (_, i) { return i; });
    o.sort(function (a, b) { return v[b] - v[a]; });
    return o;
  }

  /* ── bottom sheet ──────────────────────────────────────────────────────── */
  var sheet, snaps = [], snapIdx = 0;

  function measurePeek() {
    var blk = document.querySelector('#sheet-scroll .blk');
    if (!blk) return;
    /* The collapsed sheet shows exactly the date block — date, slider, month
       rail and playback — and never clips it. */
    var h = $('grab').offsetHeight + blk.offsetHeight + 14;
    h = Math.max(180, Math.min(h, Math.round(window.innerHeight * 0.52)));
    document.documentElement.style.setProperty('--peek', h + 'px');
  }
  function measureSnaps() {
    measurePeek();
    var h = sheet.offsetHeight;
    snaps = [h - sheetPeek(), Math.round(h * 0.45), 0];   // peek · half · full
  }
  function sideBySide() {
    /* In the landscape/tablet layout the sheet is a fixed side panel and must
       not be translated at all. */
    return window.matchMedia('(min-width: 720px) and (orientation: landscape)').matches;
  }
  function snapTo(i) {
    if (sideBySide()) return;
    snapIdx = Math.max(0, Math.min(snaps.length - 1, i));
    sheet.style.transform = 'translateY(' + snaps[snapIdx] + 'px)';
  }
  function atLeastHalf() { if (snapIdx < 1) snapTo(1); }

  function initSheet() {
    sheet = $('sheet');
    measureSnaps();
    snapTo(0);

    var grab = $('grab');
    var dragging = false, startY = 0, startT = 0, lastY = 0, startTime = 0;

    grab.addEventListener('pointerdown', function (e) {
      if (sideBySide()) return;
      dragging = true;
      startY = lastY = e.clientY;
      startT = snaps[snapIdx];
      startTime = Date.now();
      sheet.classList.add('dragging');
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      lastY = e.clientY;
      var y = Math.max(0, Math.min(snaps[0], startT + (e.clientY - startY)));
      sheet.style.transform = 'translateY(' + y + 'px)';
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('dragging');
      var moved = lastY - startY;
      var quick = Date.now() - startTime < 300;
      if (Math.abs(moved) < 8) {                 // treated as a tap
        snapTo(snapIdx >= snaps.length - 1 ? 0 : snapIdx + 1);
        return;
      }
      if (quick && Math.abs(moved) > 60) {       // flick
        snapTo(snapIdx + (moved > 0 ? -1 : 1));
        return;
      }
      var y = startT + moved, best = 0;          // nearest snap
      snaps.forEach(function (s, i) {
        if (Math.abs(s - y) < Math.abs(snaps[best] - y)) best = i;
      });
      snapTo(best);
      if (e) { /* pointer capture is released automatically */ }
    }
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    grab.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        snapTo(snapIdx >= snaps.length - 1 ? 0 : snapIdx + 1);
      }
    });
  }

  /* ── toast ─────────────────────────────────────────────────────────────── */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ── map ───────────────────────────────────────────────────────────────── */
  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      /* Canvas keeps 144 rectangles smooth on a phone GPU during playback. */
      preferCanvas: true,
      tap: true,
      zoomSnap: 0.25,
      maxZoom: 16
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18
    }).addTo(map);
    map.attributionControl.setPrefix('');

    var latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
    D.bounds.forEach(function (b, i) {
      latMin = Math.min(latMin, b[0]); lngMin = Math.min(lngMin, b[1]);
      latMax = Math.max(latMax, b[2]); lngMax = Math.max(lngMax, b[3]);
      var rect = L.rectangle([[b[0], b[1]], [b[2], b[3]]],
        { weight: 0.5, color: '#1a3020', fillOpacity: 0, opacity: 0 }).addTo(map);
      rect.on('click', function () { showDetail(i, true); });
      rects[i] = rect;

      if (D.cities[i]) {
        var lm = L.marker([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], {
          icon: L.divIcon({
            className: 'cell-label', html: D.cities[i],
            iconSize: [96, 16], iconAnchor: [48, 8]
          }),
          interactive: false, zIndexOffset: 500
        }).addTo(map);
        var el = lm.getElement();
        if (el) el.style.visibility = 'hidden';
        labels[i] = lm;
      }
    });
    gridBounds = L.latLngBounds([latMin, lngMin], [latMax, lngMax]);
    /* Keep the prefecture on screen: panning far away on a phone is easy and
       there is nothing to see out there. */
    map.setMaxBounds(gridBounds.pad(0.6));
    resetView();

    /* Labels crowd each other when the whole prefecture is in view. */
    map.on('zoomend', renderMap);
  }

  function sheetPeek() {
    if (sideBySide()) return 0;
    return parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--peek')) || 228;
  }
  function resetView() {
    map.fitBounds(gridBounds, {
      paddingTopLeft: [12, 54],
      paddingBottomRight: [sideBySide() ? 372 : 12, sheetPeek() + 12]
    });
  }

  /* ── render ────────────────────────────────────────────────────────────── */
  function renderMap() {
    var v = scores(idx, layer);
    var o = order(idx, layer);
    var rank = new Array(v.length);
    o.forEach(function (c, i) { rank[c] = i + 1; });
    var zoomed = map.getZoom() >= 9;

    for (var c = 0; c < v.length; c++) {
      var shown = rank[c] <= topN;
      if (!shown) {
        rects[c].setStyle({ fillOpacity: 0, opacity: 0 });
      } else {
        var ti = tierInfo(rank[c], v[c]);
        rects[c].setStyle({
          fillColor: ti.color,
          fillOpacity: selected === c ? 0.68 : 0.45,
          color: '#ffffff',
          opacity: selected === c ? 1 : 0.8,
          weight: selected === c ? 3 : 1.5
        });
      }
      if (labels[c]) {
        var el = labels[c].getElement();
        /* Below zoom 9 the grid is dense enough that only the leading cells
           can carry a readable label. */
        if (el) el.style.visibility = (shown && (zoomed || rank[c] <= 10)) ? 'visible' : 'hidden';
      }
    }
  }

  function renderSheet() {
    var date = D.dates[idx];
    var v = scores(idx, layer);
    var act = scores(idx, 'act');
    var o = order(idx, layer);

    $('date-display').textContent = date;
    $('day-info').textContent = '(' + DOW[new Date(date + 'T00:00:00').getDay()] + ') '
      + LAYER_NAMES[layer];
    $('tb-layer').textContent = LAYER_NAMES[layer];
    $('day-slider').value = idx;
    $('prev-day').disabled = idx === 0;
    $('next-day').disabled = idx === D.dates.length - 1;

    var totalAct = 0, topTier = 0;
    for (var i = 0; i < v.length; i++) totalAct += act[i];
    o.forEach(function (c, i) { if (tierOf(i + 1, v[c]) === 0) topTier++; });

    var best = o.length ? tierInfo(1, v[o[0]]) : { cls: 't-low', label: '—' };
    $('st-active').textContent = Math.min(topN, o.length);
    $('st-maxrisk').innerHTML = '<span class="badge ' + best.cls + '">' + best.label + '</span>';
    $('st-alert').textContent = topTier;
    $('st-actual').textContent = totalAct;

    var html = '';
    o.slice(0, Math.min(topN, 20)).forEach(function (c, i) {
      var ti = tierInfo(i + 1, v[c]);
      html += '<button class="rank-row" type="button" data-cell="' + c + '">'
        + '<span class="rank-no">' + (i + 1) + '</span>'
        + '<span class="rank-city">' + cityOf(c) + '</span>'
        + '<span class="badge ' + ti.cls + '">' + ti.label + '</span>'
        + '<span class="rank-pct">' + fmtScore(v[c]) + '</span>'
        + '</button>';
    });
    $('rank-list').innerHTML = html
      || '<div class="small" style="padding:8px 0">本日は表示対象のセルなし</div>';

    if (selected !== null) fillDetail(selected);
  }

  function render() { renderMap(); renderSheet(); markMonth(); syncURL(); }

  /* ── cell detail ───────────────────────────────────────────────────────── */
  function showDetail(cell, fromMap) {
    selected = cell;
    fillDetail(cell);
    $('rank-panel').classList.add('off');
    $('detail').classList.add('on');
    renderMap();
    if (fromMap) {
      atLeastHalf();
      $('detail').scrollIntoView({ block: 'nearest' });
    } else {
      centreOnCell(cell);
    }
  }
  function closeDetail() {
    selected = null;
    $('detail').classList.remove('on');
    $('rank-panel').classList.remove('off');
    renderMap();
  }

  /* Pan so the cell sits in the strip of map the sheet leaves visible. */
  function centreOnCell(cell) {
    var b = D.bounds[cell];
    var target = map.project([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], map.getZoom());
    var visibleTop = 54, visibleBottom = map.getSize().y - sheetPeek();
    if (!sideBySide()) target.y += (map.getSize().y / 2) - (visibleTop + visibleBottom) / 2;
    map.panTo(map.unproject(target, map.getZoom()), { animate: true, duration: 0.35 });
  }

  function fillDetail(cell) {
    var day = D.daily[idx];
    var glm = day[COL.glm], hb = day[COL.hb], ttm = day[COL.ttm], et = day[COL.et];

    $('dp-city').textContent = cityOf(cell);
    $('dp-gid').textContent = '[' + D.gids[cell] + ']';

    var glmOrder = order(idx, 'glm');
    var glmRank = glmOrder.indexOf(cell) + 1;
    $('dp-glm').textContent = (glm[cell] * 100).toFixed(1) + '%';
    $('dp-rank').textContent = '第' + glmRank + '位 / ' + glm.length + '位中';
    $('dp-hbm').textContent = (hb[cell] * 100).toFixed(1) + '%';

    /* "agrees" = the complementary layer puts this cell on the same side of
       the K = 20 patrol boundary as the primary layer does. */
    var inGlm = glmRank <= 20;
    var inTtm = order(idx, 'ttm').indexOf(cell) < 20;
    var inEt = order(idx, 'et').indexOf(cell) < 20;
    $('dp-ttm').textContent = ttm[cell].toFixed(3);
    $('dp-et').textContent = et[cell].toFixed(3);
    $('dp-ttm-agree').innerHTML = inGlm === inTtm
      ? '<span class="dp-agree">✓ 一致</span>' : '<span class="dp-disagree">✗ 不一致</span>';
    $('dp-et-agree').innerHTML = inGlm === inEt
      ? '<span class="dp-agree">✓ 一致</span>' : '<span class="dp-disagree">✗ 不一致</span>';

    var h = D.hist[cell];
    $('dp-h30').textContent = h[0];
    $('dp-h365').textContent = h[1];
    $('dp-hall').textContent = h[2];
  }

  /* ── legend ────────────────────────────────────────────────────────────── */
  function updateLegend() {
    var prob = !!PROB_LAYERS[layer];
    var pct = PROB_TIERS.map(function (v) { return (v * 100).toFixed(0); });
    var labs = prob
      ? ['緊急 (≥' + pct[0] + '%)', '高危険 (' + pct[1] + '–' + pct[0] + '%)',
         '警戒 (' + pct[2] + '–' + pct[1] + '%)', '注意 (' + pct[2] + '% 未満)']
      : ['本日 上位' + RANK_TIERS[0], '上位' + RANK_TIERS[1], '上位' + RANK_TIERS[2], 'それ以外'];
    for (var i = 0; i < 4; i++) $('leg-' + i).textContent = labs[i];
    $('leg-mode').textContent = prob ? '予測確率' : '当日の相対順位';
    $('leg-note').textContent = prob
      ? 'GLM-Logit と HierBayes の値は予測確率そのもの。'
      : 'TTM と Extra Trees の生スコアは確率として較正されていない'
        + '(Extra Trees の Brier Skill Score は −1.63)。確率としては読めないため、'
        + '当日の順位で色分けしている。';
    $('layer-note').textContent = LAYER_NOTES[layer];
  }

  /* ── navigation ────────────────────────────────────────────────────────── */
  function goTo(i) {
    idx = Math.max(0, Math.min(D.dates.length - 1, i));
    render();
  }
  function setLayer(next) {
    layer = next;
    document.querySelectorAll('#layer-rail .chip').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.layer === next));
    });
    updateLegend();
    render();
  }
  function setTopN(n) {
    topN = n;
    $('topn-val').textContent = n;
    document.querySelectorAll('#topn-rail .chip').forEach(function (b) {
      b.setAttribute('aria-pressed', String(parseInt(b.dataset.n, 10) === n));
    });
    render();
  }
  function setPlaying(on) {
    playing = on;
    $('play-btn').textContent = on ? '⏸ 停止' : '▶ 再生';
    clearTimeout(playTimer);
    if (on) step();
  }
  function step() {
    if (!playing) return;
    goTo(idx < D.dates.length - 1 ? idx + 1 : 0);
    playTimer = setTimeout(step, parseInt($('speed-sel').value, 10));
  }

  /* ── URL state (shareable day / layer / budget) ────────────────────────── */
  var urlTimer = null;
  function syncURL() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      var q = '?d=' + D.dates[idx] + '&l=' + layer + '&k=' + topN;
      history.replaceState(null, '', q);
    }, 400);
  }
  function readURL() {
    var p = new URLSearchParams(location.search);
    var d = p.get('d'), l = p.get('l'), k = parseInt(p.get('k'), 10);
    if (l && LAYER_NAMES[l]) layer = l;
    if (k && k >= 1 && k <= D.gids.length) topN = k;
    var want = d && D.dates.indexOf(d) >= 0 ? d : DEFAULT_DATE;
    idx = D.dates.indexOf(want);
    if (idx < 0) idx = Math.min(284, D.dates.length - 1);
  }

  /* ── geolocation ───────────────────────────────────────────────────────── */
  function toggleLocate() {
    var btn = $('btn-locate');
    if (meMarker) {
      map.removeLayer(meMarker);
      if (meCircle) map.removeLayer(meCircle);
      meMarker = meCircle = null;
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('on');
      return;
    }
    if (!navigator.geolocation) { toast('この端末では現在地を取得できません'); return; }
    toast('現在地を取得中…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var ll = [pos.coords.latitude, pos.coords.longitude];
      meCircle = L.circle(ll, {
        radius: Math.max(pos.coords.accuracy || 0, 60),
        color: '#6ab8df', weight: 1, fillColor: '#6ab8df', fillOpacity: 0.15
      }).addTo(map);
      meMarker = L.circleMarker(ll, {
        radius: 7, color: '#ffffff', weight: 2,
        fillColor: '#6ab8df', fillOpacity: 1
      }).addTo(map);
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('on');

      var cell = cellAt(ll[0], ll[1]);
      if (cell === -1) {
        map.setView(ll, 10);
        toast('現在地は山形県の予測グリッド外です');
        return;
      }
      map.setView(ll, 10);
      showDetail(cell, true);
      toast(cityOf(cell) + ' のセルを表示中');
    }, function (err) {
      toast(err.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  function cellAt(lat, lng) {
    for (var i = 0; i < D.bounds.length; i++) {
      var b = D.bounds[i];
      if (lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]) return i;
    }
    return -1;
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */
  function bind() {
    $('prev-day').addEventListener('click', function () { setPlaying(false); goTo(idx - 1); });
    $('next-day').addEventListener('click', function () { setPlaying(false); goTo(idx + 1); });
    $('day-slider').max = D.dates.length - 1;
    $('day-slider').addEventListener('input', function () {
      setPlaying(false);
      goTo(parseInt(this.value, 10));
    });

    var rail = $('month-rail');
    ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
      .forEach(function (name, m) {
        var b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = name;
        b.dataset.month = m;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () {
          var target = '2025-' + String(m + 1).padStart(2, '0') + '-01';
          var i = D.dates.findIndex(function (d) { return d >= target; });
          if (i >= 0) { setPlaying(false); goTo(i); }
          b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        });
        rail.appendChild(b);
      });

    document.querySelectorAll('#layer-rail .chip').forEach(function (b) {
      b.addEventListener('click', function () { setLayer(b.dataset.layer); });
    });
    document.querySelectorAll('#topn-rail .chip').forEach(function (b) {
      b.addEventListener('click', function () { setTopN(parseInt(b.dataset.n, 10)); });
    });

    $('play-btn').addEventListener('click', function () { setPlaying(!playing); });
    $('speed-sel').addEventListener('change', function () { if (playing) setPlaying(true); });

    $('rank-list').addEventListener('click', function (e) {
      var row = e.target.closest('.rank-row');
      if (row) { atLeastHalf(); showDetail(parseInt(row.dataset.cell, 10), false); }
    });
    $('detail-back').addEventListener('click', closeDetail);

    $('btn-locate').addEventListener('click', toggleLocate);
    $('btn-reset').addEventListener('click', function () { resetView(); });

    /* Playback would otherwise keep the CPU busy in a backgrounded tab. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && playing) setPlaying(false);
    });

    var resizeTimer = null;
    var wasSideBySide = sideBySide();
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        measureSnaps();
        snapTo(snapIdx);
        map.invalidateSize();
        /* Rotating the phone swaps the sheet between a bottom sheet and a side
           panel, which moves the part of the map that is actually visible. */
        if (sideBySide() !== wasSideBySide) {
          wasSideBySide = sideBySide();
          resetView();
        }
      }, 200);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { setPlaying(false); goTo(idx - 1); }
      if (e.key === 'ArrowRight') { setPlaying(false); goTo(idx + 1); }
      if (e.key === 'Escape' && selected !== null) closeDetail();
    });
  }

  /* Month chips follow the day being shown. */
  var shownMonth = -1;
  function markMonth() {
    var m = parseInt(D.dates[idx].slice(5, 7), 10) - 1;
    document.querySelectorAll('#month-rail .chip').forEach(function (b) {
      var on = parseInt(b.dataset.month, 10) === m;
      b.setAttribute('aria-pressed', String(on));
      /* 12 chips do not fit a phone's width; bring the active one into view
         whenever the month changes — including during playback. */
      if (on && m !== shownMonth) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    shownMonth = m;
  }
  /* ── boot ──────────────────────────────────────────────────────────────── */
  function fail(msg) {
    var l = $('loader');
    l.classList.add('error');
    $('loader-msg').innerHTML = msg;
  }
  function boot() {
    if (typeof L === 'undefined' || !L.map) {
      fail('地図ライブラリ (Leaflet) を読み込めませんでした。<br><span class="small">オフラインの場合は接続を確認してください。</span>');
      return;
    }
    var pending = window.__kwData || fetch(DATA_URL).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    window.__kwData = null;
    pending
      .then(function (payload) {
        if (!payload || !payload.dates) throw new Error('empty payload');
        D = payload;
        readURL();
        initSheet();
        initMap();
        bind();
        setTopN(topN);
        setLayer(layer);
        /* bind() fills the month rail, so the collapsed height can only be
           measured once the date block is complete. */
        measureSnaps();
        snapTo(0);
        $('loader').classList.add('done');
      })
      .catch(function () {
        window.__kwData = null;
        fail('予測データを読み込めませんでした。<br><span class="small">通信状況を確認して再試行してください。</span>');
      });
  }

  $('loader-retry').addEventListener('click', function () {
    $('loader').classList.remove('error');
    $('loader-msg').textContent = '再読み込み中…';
    boot();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline is optional */ });
  }

  boot();
})();
