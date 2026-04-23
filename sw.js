// On Point Pro Doors CRM — Service Worker
// CACHE_VERSION is stamped by the deploy script on every push so the
// browser always sees a changed sw.js file and installs the new version.
const CACHE_VERSION = 'v20260423-fix-api-bypass';
const CACHE_NAME = `onpoint-${CACHE_VERSION}`;

// Inline offline HTML — guaranteed fallback even with empty cache
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>On Point Pro Doors CRM</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#0f172a;color:#fff;text-align:center;padding:20px}
    .card{max-width:320px;width:100%}
    .icon{font-size:48px;margin-bottom:16px}
    h2{font-size:22px;font-weight:700;margin-bottom:10px}
    p{color:#94a3b8;font-size:15px;line-height:1.5;margin-bottom:24px}
    button{width:100%;padding:14px;background:#2563eb;color:#fff;border:none;
           border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;
           -webkit-tap-highlight-color:transparent}
    button:active{opacity:.85}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📶</div>
    <h2>You're offline</h2>
    <p>Please check your internet connection and tap Retry to reload On Point Pro Doors CRM.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`;

// ── INSTALL ───────────────────────────────────────────────
// Only cache the offline fallback — no pre-caching of app shell.
// This prevents a single failing asset from breaking the entire install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.put(
        '/offline.html',
        new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      ))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────
// Delete every old cache bucket and claim all clients immediately.
// We do NOT force-reload clients here — JS/CSS are already network-first
// (cache:'no-cache'), so the next navigation automatically gets fresh code.
// Force-reloading mid-auth causes the blue screen to stick.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Pass through: Supabase API / Edge Functions (never intercept auth or DB calls)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io')) return;
  // Pass through: ALL /api/ routes (backend endpoints, never cache these)
  if (url.pathname.startsWith('/api/')) return;
  // Pass through: non-GET (POST, PUT, DELETE)
  if (request.method !== 'GET') return;
  // Pass through: cross-origin requests
  if (url.origin !== self.location.origin) return;

  // ── HTML navigation (PWA launch, bookmarks, SPA routes) ──
  // Always network-first. If offline: serve cached page → offline fallback → inline HTML.
  // NEVER return undefined — a blank page is never acceptable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match('/offline.html'))
            .then(fallback => fallback || new Response(OFFLINE_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  // ── JavaScript and CSS ────────────────────────────────────
  // Network-first, cache: 'no-cache' so the HTTP cache is bypassed and
  // every deploy's new files are picked up immediately.
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' }))
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || new Response('', { status: 503 })))
    );
    return;
  }

  // ── Images and icons ─────────────────────────────────────
  // Cache-first: stable assets, save bandwidth.
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // ── Everything else ───────────────────────────────────────
  // Network-first with cache fallback.
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request).then(c => c || new Response('', { status: 503 })))
  );
});

// ── PUSH NOTIFICATION ─────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW Push] Event received, raw data:', event.data);

  let data = { title: 'On Point CRM', body: 'You have a new notification.' };
  try {
    data = event.data ? event.data.json() : data;
    console.log('[SW Push] Parsed JSON data:', data);
  } catch (_e) {
    console.warn('[SW Push] Failed to parse JSON, using text:', _e.message);
    data.body = event.data ? event.data.text() : data.body;
    console.log('[SW Push] Text data:', data.body);
  }

  console.log('[SW Push] Showing notification with:', { title: data.title, body: data.body, jobId: data.jobId });

  // Notify all clients about the push
  event.waitUntil(
    (async () => {
      try {
        // Show notification
        await self.registration.showNotification(data.title || 'On Point CRM', {
          body:    data.body || '',
          icon:    '/assets/icon.svg',
          badge:   '/assets/icon.svg',
          tag:     data.jobId ? `job-${data.jobId}` : 'onpoint-notif',
          data:    { jobId: data.jobId || null },
          vibrate: [200, 100, 200],
          requireInteraction: false,
          silent: false,
          actions: [],
        });

        console.log('[SW Push] ✅ Notification shown successfully');

        // Notify all clients for debug panel
        const allClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
        console.log('[SW Push] Notifying', allClients.length, 'clients');
        allClients.forEach(client => {
          client.postMessage({
            type: 'PUSH_RECEIVED',
            data: data,
            timestamp: new Date().toISOString()
          });
        });
      } catch (error) {
        console.error('[SW Push] ❌ Failed to show notification:', error);
      }
    })()
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const jobId = event.notification.data?.jobId;
  const targetUrl = jobId ? `/?job=${jobId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (jobId) client.postMessage({ type: 'OPEN_JOB', jobId });
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
