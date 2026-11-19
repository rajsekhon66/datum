/* Datum offline service worker — caches the app shell (the single
   self-contained index.html) so the home-screen app opens with no
   signal. All app assets are inlined in index.html, so caching the
   document itself is enough. Versioned cache; old caches are dropped.
   API calls (/api/*) and all cross-origin requests (registries,
   weather, map tiles, CDNs) always go to the network and are never
   cached. */
var CACHE = "datum-shell-v1";
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(["./", "./index.html"]);
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  if (e.request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        return res;
      }).catch(function () { return caches.match("./index.html"); })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      });
    }).catch(function () { return caches.match("./index.html"); })
  );
});
