/* Cache version: bump this whenever the app shell (html/css/js/icons) changes. */
const CACHE_VERSION = "smt-shell-v7";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./favicon.svg",
  "./favicon.png",
  "./icons/logo-128.png",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache cross-origin requests (GeckoTerminal, DexScreener, RugCheck,
  // GoPlus, RPC, CoinGecko, fonts, chart CDN). Let them pass straight through.
  if (url.origin !== self.location.origin) return;

  if (isDataJson(url)) {
    event.respondWith(networkFirstData(request));
    return;
  }

  event.respondWith(cacheFirstThenRevalidate(request));
});

function isDataJson(url) {
  return /\/data\/[^/]+\.json$/i.test(url.pathname);
}

function dataCacheRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.href, { method: "GET", headers: request.headers });
}

async function networkFirstData(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cacheReq = dataCacheRequest(request);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(cacheReq, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(cacheReq);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstThenRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  if (request.mode === "navigate") {
    const fallback = await cache.match("./index.html") || await cache.match("./");
    if (fallback) return fallback;
  }
  return Response.error();
}
