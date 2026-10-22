// Service Worker para Clínica Dental PWA
const CACHE_NAME = "clinica-dental-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/src/main.jsx",
  "/src/App.jsx"
];

// Instalar y cachear recursos estáticos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Si falla el cache de algún asset, continúa de todos modos
      });
    })
  );
  self.skipWaiting();
});

// Activar y limpiar caches viejos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Estrategia: Network First para el API de Sheets, Cache First para assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Solicitudes al Apps Script / Google Sheets: siempre red
  if (url.hostname.includes("script.google.com") || url.hostname.includes("googleapis.com")) {
    event.respondWith(fetch(event.request).catch(() => new Response("offline", { status: 503 })));
    return;
  }

  // Assets estáticos: Cache First, luego red
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Sólo cachear respuestas exitosas y no de terceros problemáticos
        if (response.ok && !url.hostname.includes("vercel")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Sin red y sin cache: devolver página principal cacheada
        return caches.match("/") || new Response("Sin conexión", { status: 503 });
      });
    })
  );
});
