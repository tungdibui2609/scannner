const CACHE_NAME = "scanner-cache-v9";

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
                .catch(async () => {
                    // If offline, fallback to cache
                    const cachedResponse = await caches.match(event.request);
                    if (cachedResponse) return cachedResponse;

                    // Final fallback to avoid white screen
                    return new Response(
                        '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mất kết nối</title><style>body{font-family:-apple-system, system-ui, sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f5;color:#18181b;}h1{font-size:1.5rem;margin-bottom:0.5rem;}p{color:#71717a;}</style></head><body><h1>Không có kết nối mạng</h1><p>Vui lòng kiểm tra đường truyền và thử lại.</p><button onclick="window.location.reload()" style="margin-top:1.5rem;padding:0.75rem 1.5rem;background:#10b981;color:white;border:none;border-radius:0.5rem;font-weight:bold;cursor:pointer;">Thử lại</button></body></html>',
                        {
                            status: 200,
                            headers: { 'Content-Type': 'text/html; charset=utf-8' }
                        }
                    );
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
