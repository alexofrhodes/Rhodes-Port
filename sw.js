/* Service worker: shell only. Never intercept /api/ (avoids false 503 on slow AIS). */
const CACHE = "rpa-shell-v7";
const SHELL = [
  "./",
  "./index.html",
  "./ferries.html",
  "./ports.html",
  "./live.html",
  "./css/styles.css",
  "./css/ferries.css",
  "./js/ferries.js",
  "./icons/icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/")) {
    // bypass SW completely for APIs (root or /Rhodes-Port/api/)
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
