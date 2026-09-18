/* ==========================================================================
   KumaWatch mobile — language switching (日本語 / English)

   The two pages carry their text in the markup so they read correctly with
   this file blocked; the dictionaries in strings-*.js hold both languages and
   are the source of truth once it runs. Numbers — every value from the paper —
   live in the markup only, and are never duplicated into a dictionary.

   Markup contract:
     data-i18n="key"        replaces textContent
     data-i18n-html="key"   replaces innerHTML (text that carries markup)
     data-i18n-aria="key"   replaces the aria-label attribute
   ========================================================================== */
(function (global) {
  'use strict';

  var KW = global.KW = global.KW || {};
  var dict = { en: {}, ja: {} };
  var LANGS = { en: 1, ja: 1 };
  var STORE = 'kw-lang';

  KW.addStrings = function (add) {
    Object.keys(add).forEach(function (lang) {
      Object.keys(add[lang]).forEach(function (k) { dict[lang][k] = add[lang][k]; });
    });
  };

  function resolve() {
    var q = new URLSearchParams(location.search).get('lang');
    if (LANGS[q]) return q;
    try {
      var saved = localStorage.getItem(STORE);
      if (LANGS[saved]) return saved;
    } catch (e) { /* private mode */ }
    return /^ja/i.test(navigator.language || '') ? 'ja' : 'en';
  }

  KW.lang = 'en';

  /* Deferred scripts run with readyState === 'interactive', so this file
     cannot apply anything the moment it executes — the dictionaries load
     after it. Pages wait on KW.ready before drawing translated content. */
  var markReady;
  KW.ready = new Promise(function (resolve) { markReady = resolve; });

  /* Look up a string; `vars` fills {name} placeholders. A missing key is a
     bug in the dictionary, so it is reported rather than silently ignored. */
  KW.t = function (key, vars) {
    var s = dict[KW.lang] && dict[KW.lang][key];
    if (s === undefined) {
      console.error('[i18n] missing key: ' + key + ' (' + KW.lang + ')');
      s = (dict.en && dict.en[key]) !== undefined ? dict.en[key] : key;
    }
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] !== undefined ? vars[name] : m;
      });
    }
    return s;
  };

  KW.apply = function (root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = KW.t(n.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach(function (n) {
      n.innerHTML = KW.t(n.dataset.i18nHtml);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach(function (n) {
      n.setAttribute('aria-label', KW.t(n.dataset.i18nAria));
    });
  };

  KW.setLang = function (lang, opts) {
    if (!LANGS[lang]) return;
    KW.lang = lang;
    document.documentElement.setAttribute('lang', lang);
    try { localStorage.setItem(STORE, lang); } catch (e) { /* private mode */ }

    /* Keep the choice in the URL so a shared link opens in the same language,
       without disturbing the map's own d/l/k parameters. */
    if (!opts || opts.url !== false) {
      var q = new URLSearchParams(location.search);
      q.set('lang', lang);
      history.replaceState(null, '', '?' + q.toString());
    }
    KW.apply();
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    document.dispatchEvent(new CustomEvent('kw:lang', { detail: { lang: lang } }));
  };

  function init() {
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.addEventListener('click', function () { KW.setLang(b.dataset.lang); });
    });
    /* No URL rewrite on load: an untouched link keeps its clean address. */
    KW.setLang(resolve(), { url: false });
    markReady(KW.lang);
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    /* DOMContentLoaded fires once every deferred script has run, which is the
       first moment the dictionaries are complete. */
    document.addEventListener('DOMContentLoaded', init);
  }
})(window);
