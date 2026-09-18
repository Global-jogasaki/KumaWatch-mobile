/* KumaWatch mobile — landing page behaviour.
 *
 * Progressive enhancement only: the page is complete and readable with this
 * file blocked. Every metric table stays in the markup; the compact bar view
 * is derived from it at runtime, so there is one copy of each number. */
(function () {
  'use strict';

  /* ── compact bar view, built from each table ──────────────────────────── */
  document.querySelectorAll('.metric').forEach(function (metric) {
    var table = metric.querySelector('table');
    var host = metric.querySelector('[data-view-panel="bars"]');
    if (!table || !host) return;

    var heads = [].map.call(table.querySelectorAll('thead th'), function (th) {
      return th.textContent.trim();
    });
    var barCol = parseInt(metric.dataset.barCol, 10) || 1;
    var subCol = parseInt(metric.dataset.subCol, 10) || 0;

    var rows = [].map.call(table.querySelectorAll('tbody tr'), function (tr) {
      var cells = tr.children;
      return {
        name: cells[0].textContent.trim(),
        value: parseFloat(cells[barCol].textContent),
        sub: subCol ? parseFloat(cells[subCol].textContent) : null
      };
    }).filter(function (r) { return isFinite(r.value); });

    rows.sort(function (a, b) { return b.value - a.value; });
    var max = rows.length ? rows[0].value : 1;

    host.innerHTML = rows.map(function (r, i) {
      var pct = max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0;
      var sub = r.sub !== null && isFinite(r.sub)
        ? '<span class="bar-sub">' + heads[subCol] + ' ' + r.sub.toFixed(4) + '</span>' : '';
      return '<div class="bar-row' + (i === 0 ? ' top' : '') + '">' +
             '<span class="bar-name">' + r.name +
               (i === 0 ? '<em>best</em>' : '') + '</span>' +
             '<span class="bar-val">' + r.value.toFixed(4) + '</span>' +
             '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
             sub + '</div>';
    }).join('');

    /* The bar view answers "which method wins?"; the table answers "by how
       much, on every budget?". Both stay one tap apart. */
    metric.querySelectorAll('.seg button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var want = btn.dataset.view;
        metric.querySelectorAll('.seg button').forEach(function (b) {
          b.setAttribute('aria-selected', String(b === btn));
        });
        metric.querySelectorAll('[data-view-panel]').forEach(function (panel) {
          panel.hidden = panel.dataset.viewPanel !== want;
        });
      });
    });
  });

  /* ── fade the swipe hint once the table has actually been swiped ──────── */
  document.querySelectorAll('.tbl-wrap').forEach(function (wrap) {
    wrap.addEventListener('scroll', function onScroll() {
      var hint = wrap.parentElement.querySelector('.swipe-hint');
      if (hint) hint.style.opacity = '0';
      wrap.removeEventListener('scroll', onScroll);
    }, { passive: true });
  });

  /* ── back to top ──────────────────────────────────────────────────────── */
  var toTop = document.getElementById('to-top');
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── "Add to Home Screen" hint, iOS Safari only ───────────────────────── */
  var hint = document.getElementById('a2hs');
  if (hint) {
    var iOS = /iP(hone|od|ad)/.test(navigator.platform || '') ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true ||
                     window.matchMedia('(display-mode: standalone)').matches;
    var dismissed = false;
    try { dismissed = localStorage.getItem('kw-a2hs') === 'off'; } catch (e) { /* private mode */ }
    if (iOS && !standalone && !dismissed) {
      hint.hidden = false;
      hint.classList.add('show');
    }
    document.getElementById('a2hs-close').addEventListener('click', function () {
      hint.classList.remove('show');
      hint.hidden = true;
      try { localStorage.setItem('kw-a2hs', 'off'); } catch (e) { /* ignore */ }
    });
  }

  /* ── offline support ──────────────────────────────────────────────────── */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline is optional */ });
    });
  }
})();
