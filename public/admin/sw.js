const SHELL = ["/admin/", "/admin/index.html", "/admin/login.html", "/admin/admin.js", "/admin/admin.css", "/admin/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("storeforall-admin-v1").then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
