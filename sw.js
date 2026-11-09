// Service worker: guarda a "casca" do app para abrir rápido e funcionar como app instalado.
// Dados financeiros NUNCA são guardados aqui; sempre vêm do Supabase.
const VERSAO = 'casca-v4';
const CASCA = ['/', '/index.html', '/style.css', '/app.js', '/config.js', '/manifest.webmanifest', '/icons/boneco.png', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase e esm.sh: sempre pela rede
  // Rede primeiro (pega versões novas); se estiver sem internet, usa a cópia guardada.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
