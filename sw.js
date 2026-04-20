// On Point Pro Doors CRM — Service Worker
const CACHE_NAME = 'onpoint-v1';
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
    caches.open(CACHE_NAME).then((cache) => {
      // Add individually so one failure doesn't abort the whole install
      return Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for app shell, network-first for API ─
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Always bypass for Supabase API calls — they must hit the network
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.io')) {
    return; // let the browser handle normally
  }

  // Cache-first for same-origin GET requests
  if (request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
    );
  }
});

// ── PUSH: display notification ────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'On Point CRM', body: 'You have a new notification.' };
  try {
    data = event.data ? event.data.json() : data;
  } catch (_e) {
    data.body = event.data ? event.data.text() : data.body;
  }

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

// ── NOTIFICATION CLICK: open/focus the app ────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const jobId = event.notification.data?.jobId;
  const targetUrl = jobId ? `/?job=${jobId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
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
