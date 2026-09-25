const CACHE = "sap-embodied-ai-v8";
const SHELL = ["/", "/styles.css", "/workspace.css", "/editor-ui.css", "/app.js?v=0.9.6-joule-planner", "/editor-core.js", "/robot-models.js", "/mesh-assets.js", "/webgl-world.js", "/manifest.webmanifest"];
self.addEventListener("install", event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate", event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("sap-embodied-ai-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request)));
});
