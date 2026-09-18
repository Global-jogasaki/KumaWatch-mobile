/* Minimal stand-in for the parts of Leaflet that mobile-assets/map.js uses.
 * Only for the headless smoke test in mobile-tools/test/smoke.js: the sandbox that
 * runs the test has no egress to unpkg.com, and the real library is not
 * needed to exercise the app's own logic. It projects lat/lng linearly onto
 * the container so the rendered grid is still visually checkable. */
(function (global) {
  'use strict';

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (parent || document.body).appendChild(n);
    return n;
  }

  function MapStub(id, opts) {
    this.container = document.getElementById(id);
    this.container.classList.add('leaflet-container');
    this.pane = el('div', 'stub-pane', this.container);
    this.pane.style.cssText = 'position:absolute;inset:0;overflow:hidden';
    this.opts = opts || {};
    this._zoom = 8;
    this._handlers = {};
    this.attributionControl = { setPrefix: function () {} };
    // Default view: Yamagata, replaced by the first fitBounds().
    this._view = { latMin: 37.7, latMax: 39.0, lngMin: 139.5, lngMax: 140.9 };
    this._layers = [];
  }
  MapStub.prototype.size = function () {
    return { x: this.container.clientWidth, y: this.container.clientHeight };
  };
  MapStub.prototype.getSize = function () { return this.size(); };
  MapStub.prototype.getZoom = function () { return this._zoom; };
  MapStub.prototype.on = function (ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); };
  MapStub.prototype.fire = function (ev) { (this._handlers[ev] || []).forEach(function (f) { f(); }); };
  MapStub.prototype.setMaxBounds = function () {};
  MapStub.prototype.invalidateSize = function () { this._layers.forEach(function (l) { l._place(); }); };
  MapStub.prototype.fitBounds = function (b) {
    this._view = { latMin: b._a[0], latMax: b._b[0], lngMin: b._a[1], lngMax: b._b[1] };
    this.invalidateSize();
  };
  MapStub.prototype.setView = function () {};
  MapStub.prototype.panTo = function () {};
  MapStub.prototype.removeLayer = function (l) { if (l && l.node) l.node.remove(); };
  MapStub.prototype.project = function (ll) { return { x: ll[1], y: ll[0] }; };
  MapStub.prototype.unproject = function (p) { return [p.y, p.x]; };
  MapStub.prototype.px = function (lat, lng) {
    var v = this._view, s = this.size();
    return {
      x: (lng - v.lngMin) / (v.lngMax - v.lngMin) * s.x,
      y: (v.latMax - lat) / (v.latMax - v.latMin) * s.y
    };
  };

  var theMap = null;

  function Rect(bounds) {
    this.bounds = bounds;
    this.node = null;
    this._style = {};
  }
  Rect.prototype.addTo = function (m) {
    this.node = el('div', 'stub-rect', m.pane);
    this.node.style.position = 'absolute';
    m._layers.push(this);
    this._place();
    return this;
  };
  Rect.prototype._place = function () {
    if (!this.node || !theMap) return;
    var a = theMap.px(this.bounds[0][0], this.bounds[0][1]);
    var b = theMap.px(this.bounds[1][0], this.bounds[1][1]);
    this.node.style.left = Math.min(a.x, b.x) + 'px';
    this.node.style.top = Math.min(a.y, b.y) + 'px';
    this.node.style.width = Math.abs(a.x - b.x) + 'px';
    this.node.style.height = Math.abs(a.y - b.y) + 'px';
  };
  Rect.prototype.on = function (ev, fn) { if (this.node) this.node.addEventListener(ev, fn); };
  Rect.prototype.setStyle = function (s) {
    Object.assign(this._style, s);
    if (!this.node) return;
    this.node.style.background = s.fillColor || this._style.fillColor || 'transparent';
    this.node.style.opacity = String(s.fillOpacity !== undefined ? s.fillOpacity : 0);
    this.node.style.border = (s.weight || 0) + 'px solid ' + (s.color || '#fff');
  };

  function Marker(ll, opts) {
    this.ll = ll; this.opts = opts; this.node = null;
  }
  Marker.prototype.addTo = function (m) {
    this.node = el('div', (this.opts.icon && this.opts.icon.options.className) || '', m.pane);
    this.node.innerHTML = (this.opts.icon && this.opts.icon.options.html) || '';
    this.node.style.position = 'absolute';
    m._layers.push(this);
    this._place();
    return this;
  };
  Marker.prototype._place = function () {
    if (!this.node || !theMap) return;
    var p = theMap.px(this.ll[0], this.ll[1]);
    this.node.style.left = (p.x - 48) + 'px';
    this.node.style.top = (p.y - 8) + 'px';
    this.node.style.width = '96px';
  };
  Marker.prototype.getElement = function () { return this.node; };

  global.L = {
    map: function (id, opts) { theMap = new MapStub(id, opts); return theMap; },
    tileLayer: function () { return { addTo: function () { return this; } }; },
    rectangle: function (b) { return new Rect(b); },
    marker: function (ll, o) { return new Marker(ll, o); },
    divIcon: function (o) { return { options: o }; },
    circle: function () { return { addTo: function () { return this; } }; },
    circleMarker: function () { return { addTo: function () { return this; } }; },
    latLngBounds: function (a, b) { return { _a: a, _b: b, pad: function () { return this; } }; },
    control: { attribution: function () { return {}; } }
  };
})(window);
