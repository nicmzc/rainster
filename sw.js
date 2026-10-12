const CACHE = "rainster-v9";
const ARCHIVOS = [
    "/",
    "/rainster.html",
    "/juego.js",
    "/estaciones.js",
    "/manifest.webmanifest",
    "/icono.rainster.png",
    "/icono.rainster2.png"
];

// Al instalar: guarda los archivos del juego
self.addEventListener("install", function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); })
    );
    self.skipWaiting();
});

// Al activar: borra cachés viejas
self.addEventListener("activate", function (e) {
    e.waitUntil(
        caches.keys().then(function (nombres) {
            return Promise.all(
                nombres
                    .filter(function (n) { return n !== CACHE; })
                    .map(function (n) { return caches.delete(n); })
            );
        })
    );
    self.clients.claim();
});

// Primero intenta la red; si falla, usa la caché
self.addEventListener("fetch", function (e) {
    if (e.request.method !== "GET") return;
  if (new URL(e.request.url).pathname.startsWith("/api/")) return;
    if (!e.request.url.startsWith(self.location.origin)) return;

    e.respondWith(
        fetch(e.request)
            .then(function (res) {
                if (res.ok) {
                    const copia = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
                }
                return res;
            })
            .catch(function () { return caches.match(e.request); })
    );
});