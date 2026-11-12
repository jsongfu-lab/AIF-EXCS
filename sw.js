const CACHE_PREFIX = `aif-c01-study:${encodeURIComponent(self.registration.scope)}:`;
const CACHE_NAME = `${CACHE_PREFIX}v14`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=14",
  "./app.js?v=14",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./data/questions.json",
  "./data/questions.zh.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map((asset) => new Request(
      new URL(asset, self.registration.scope), { cache: "reload" }
    )));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const url = new URL(request.url);
    const home = new URL(self.registration.scope);
    const entry = new URL("index.html", home);
    const isEntry = request.mode === "navigate" &&
      (url.pathname === home.pathname || url.pathname === entry.pathname);
    return await cache.match(isEntry ? entry.href : request) || fetch(request);
  })());
});
