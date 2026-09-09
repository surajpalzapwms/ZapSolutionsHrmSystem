const CACHE_NAME = "zapSolutionz-crm-v2";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json", "/offline.html"];

// Install — cache only the shell, don't fail on missing assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Use addAll but ignore errors for individual files
        Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

// Activate — remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch — network first for API/HTML, cache first for assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests from our origin
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;
  if (
    !url.origin.includes(self.location.origin) &&
    !url.href.startsWith(self.location.origin)
  )
    return;

  // Skip API calls entirely
  if (url.pathname.startsWith("/api/")) return;

  // For HTML navigation requests: network first, fallback to offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh HTML
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return response;
        })
        .catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // For JS/CSS/images: cache first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (
          !response ||
          response.status !== 200 ||
          response.type === "opaque"
        ) {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        return response;
      });
    }),
  );
});
