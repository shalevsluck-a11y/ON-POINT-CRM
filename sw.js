// On Point Pro Doors CRM — Service Worker
// CACHE_VERSION is stamped by the deploy script on every push so all
// clients always receive fresh files after an update.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `onpoint-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/css/components.css',
  '/css/auth.css',
  '/js/storage.js',
  '/js/parser.js',
  '/js/payout.js',
  '/js/sync.js',
  '/js/supabase-client.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/notifications.js',
  '/js/reminders.js',
  '/js/login.js',
  '/js/app.js',
  '/assets/logo.jpg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.json',
];

// ── INSTALL: pre-cache app shell ──────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map(url => cache.add(url)))
    ).then(() => self.skipWaiting()) // take over immediately, don't wait for old SW to die
  );
});

// ── ACTIVATE: wipe all old caches, claim all clients ──────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell every open tab to reload so they get the fresh version
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
      })
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Supabase API or Edge Function calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io')) return;
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // HTML navigation: network-first so updates are always seen immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // JS and CSS: network-first (must be fresh after every deploy)
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else (images, manifest, icons): cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── PUSH: display notification ────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'On Point CRM', body: 'You have a new notification.' };
  try { data = event.data ? event.data.json() : data; }
  catch (_e) { data.body = event.data ? event.data.text() : data.body; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'On Point CRM', {
      body:    data.body || '',
      icon:    '/assets/icon-192.png',
      badge:   '/assets/icon-192.png',
      tag:     data.jobId ? `job-${data.jobId}` : 'onpoint-notif',
      data:    { jobId: data.jobId || null },
      vibrate: [100, 50, 100],
    })
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
