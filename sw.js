/* KumaWatch mobile — offline cache.
 *
 * A phone in the mountains is exactly where this map is useful and exactly
 * where the network is not, so the shell, the 2025 score matrices and the
 * Leaflet bundle are all kept locally after the first visit. Map tiles are
 * deliberately NOT cached: they are third-party and unbounded in number, and
 * bulk-storing a public tile service is what its usage terms ask clients not
 * to do.
 */
var VERSION = 'kw-mobile-v2';   // bumped when the asset paths changed

var SHELL = [
  './',
  './index.html',
  './map.html',
  './mobile-assets/base.css',
  './mobile-assets/index.css',
  './mobile-assets/map.css',
  './mobile-assets/index.js',
  './mobile-assets/map.js',
  './mobile-data/yamagata_2025.json',
  './manifest.webmanifest',
  './mobile-icons/icon.svg',
  './mobile-icons/apple-touch-icon.png',
  './mobile-icons/icon-192.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* One failed entry must not fail the whole install. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' }))
          .catch(function () { /* fetched later, on demand */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.hostname.indexOf('cyberjapandata.gsi.go.jp') >= 0) return;   // never cached

  /* Same-origin pages: network first, so a republished site is picked up on
     the next online visit; cache is the offline fallback. */
  if (url.origin === location.origin && req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* Everything else (assets, data, Leaflet): cache first, refresh in the
     background — the payload is versioned with the release. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
