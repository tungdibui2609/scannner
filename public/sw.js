const CACHE_NAME = "scanner-cache-v8";

self.addEventListener("install", (event) => {
    // Force this SW to become the active one immediately
    self.skipWaiting();
    // Just open cache to ensure it exists
    event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener("activate", (event) => {
    // Take control of all pages immediately
    event.waitUntil(clients.claim());

    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Only handle requests from our own origin
    if (url.origin !== location.origin) return;

    // Ignore API calls
    if (url.pathname.startsWith("/api/")) return;

    // Ignore Next.js HMR and hot-updates
    if (url.pathname.includes("webpack-hmr") || url.pathname.includes("hot-update")) {
        return;
    }

    // Strategy: Network First for HTML (navigation)
    // This ensures the user always gets the latest version of the page
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    return caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                })
                .catch(() => {
                    // If offline, fallback to cache
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Strategy: Cache First for static assets (JS, CSS, Images)
    // Next.js hashes filenames, so if the file changes, the URL changes, bypassing the cache.
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Return cached response if found
            if (cachedResponse) {
                return cachedResponse;
            }

            // If not in cache, fetch from network
            return fetch(event.request).then((networkResponse) => {
                // Cache successful GET requests
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic' && event.request.method === 'GET') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});
