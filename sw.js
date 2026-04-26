// On Point Pro Doors CRM — Service Worker
// CACHE_VERSION is stamped by the deploy script on every push so the
// browser always sees a changed sw.js file and installs the new version.
const CACHE_VERSION = 'v20260426-critical-fixes';
const CACHE_NAME = `onpoint-${CACHE_VERSION}`;

// Import remote debug logger
importScripts('/js/remote-debug.js');

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
  RemoteDebug.logServiceWorkerEvent('sw_install', 'Service worker installing', { cacheVersion: CACHE_VERSION });
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.put(
        '/offline.html',
        new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      ))
      .then(() => {
        RemoteDebug.logServiceWorkerEvent('sw_install_complete', 'Service worker installed', { cacheVersion: CACHE_VERSION });
        return self.skipWaiting();
      })
      .catch(error => {
        RemoteDebug.logError('service_worker', 'Install failed', error);
        throw error;
      })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────
// Delete every old cache bucket and claim all clients immediately.
// We do NOT force-reload clients here — JS/CSS are already network-first
// (cache:'no-cache'), so the next navigation automatically gets fresh code.
// Force-reloading mid-auth causes the blue screen to stick.
self.addEventListener('activate', (event) => {
  RemoteDebug.logServiceWorkerEvent('sw_activate', 'Service worker activating', { cacheVersion: CACHE_VERSION });
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => {
        RemoteDebug.logServiceWorkerEvent('sw_activate_complete', 'Service worker activated and claimed clients', { cacheVersion: CACHE_VERSION });
        return self.clients.claim();
      })
      .catch(error => {
        RemoteDebug.logError('service_worker', 'Activate failed', error);
        throw error;
      })
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

// ── DURABLE PUSH EVENT LOGGING (IndexedDB) ────────────────
async function logPushEvent(logEntry) {
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('OnPointCRM_PushLogs', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('push_events')) {
          const store = db.createObjectStore('push_events', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    const tx = db.transaction(['push_events'], 'readwrite');
    const store = tx.objectStore('push_events');
    store.add(logEntry);

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (err) {
    console.error('[SW Push] Failed to persist log to IndexedDB:', err);
  }
}

// ── PUSH NOTIFICATION ─────────────────────────────────────
self.addEventListener('push', (event) => {
  const timestamp = new Date().toISOString();
  console.log('[SW Push] ========== PUSH EVENT RECEIVED ==========');
  console.log('[SW Push] Timestamp:', timestamp);
  console.log('[SW Push] Event:', event);
  console.log('[SW Push] Raw data:', event.data);
  console.log('[SW Push] Has data:', !!event.data);

  // 🔍 REMOTE DEBUG: Push received
  RemoteDebug.logPushEvent('push_received', 'Push event received in service worker', {
    timestamp: timestamp,
    hasData: !!event.data,
    rawData: event.data ? event.data.text() : null
  });

  let data = { title: 'On Point CRM', body: 'You have a new notification.' };
  let parseError = null;

  try {
    if (event.data) {
      data = event.data.json();
      console.log('[SW Push] ✅ Parsed JSON data:', data);
      // 🔍 REMOTE DEBUG: JSON parsed successfully
      RemoteDebug.logPushEvent('push_data_parsed', 'Push data parsed successfully', data);
    } else {
      console.warn('[SW Push] ⚠️ No data in push event, using defaults');
      // 🔍 REMOTE DEBUG: No data
      RemoteDebug.logPushEvent('push_no_data', 'Push event had no data, using defaults', null);
    }
  } catch (_e) {
    parseError = _e.message;
    console.error('[SW Push] ❌ Failed to parse JSON:', _e.message);
    data.body = event.data ? event.data.text() : data.body;
    console.log('[SW Push] Fallback text data:', data.body);
    // 🔍 REMOTE DEBUG: Parse error
    RemoteDebug.logPushEvent('push_parse_error', 'Failed to parse push data as JSON', { fallbackText: data.body }, _e);
  }

  console.log('[SW Push] Final notification data:', { title: data.title, body: data.body, jobId: data.jobId });

  // Notify all clients about the push
  event.waitUntil(
    (async () => {
      const execLog = [];

      try {
        execLog.push({ step: 'START', time: new Date().toISOString() });

        // ✅ DURABLE LOG: Push event received
        await logPushEvent({
          timestamp: timestamp,
          event: 'PUSH_RECEIVED',
          data: data,
          parseError: parseError,
          step: 'START'
        });

        // Show notification
        console.log('[SW Push] Calling showNotification...');
        // 🔍 REMOTE DEBUG: About to show notification
        RemoteDebug.logPushEvent('notification_showing', 'Calling showNotification', { title: data.title, body: data.body, jobId: data.jobId });

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

        execLog.push({ step: 'NOTIFICATION_SHOWN', time: new Date().toISOString() });
        console.log('[SW Push] ✅ showNotification completed successfully');

        // 🔍 REMOTE DEBUG: Notification shown successfully
        RemoteDebug.logPushEvent('notification_shown', '✅ Notification displayed successfully', {
          title: data.title,
          body: data.body,
          jobId: data.jobId,
          tag: data.jobId ? `job-${data.jobId}` : 'onpoint-notif'
        });

        // ✅ DURABLE LOG: Notification shown
        await logPushEvent({
          timestamp: new Date().toISOString(),
          event: 'NOTIFICATION_SHOWN',
          title: data.title,
          body: data.body,
          jobId: data.jobId
        });

        // Notify all clients for debug panel and logging
        const allClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
        execLog.push({ step: 'CLIENTS_FOUND', count: allClients.length, time: new Date().toISOString() });
        console.log('[SW Push] Found', allClients.length, 'clients to notify');

        allClients.forEach(client => {
          client.postMessage({
            type: 'PUSH_RECEIVED',
            data: data,
            timestamp: timestamp,
            parseError: parseError,
            execLog: execLog,
            success: true
          });
        });

        console.log('[SW Push] ========== PUSH EVENT COMPLETE ==========');
      } catch (error) {
        execLog.push({ step: 'ERROR', error: error.message, time: new Date().toISOString() });
        console.error('[SW Push] ❌ Exception in push handler:', error);
        console.error('[SW Push] Error name:', error.name);
        console.error('[SW Push] Error message:', error.message);

        // 🔍 REMOTE DEBUG: Push handler error
        RemoteDebug.logPushEvent('push_error', '❌ Exception in push handler', {
          errorName: error.name,
          errorMessage: error.message,
          data: data,
          execLog: execLog
        }, error);

        // ✅ DURABLE LOG: Error occurred
        await logPushEvent({
          timestamp: new Date().toISOString(),
          event: 'PUSH_ERROR',
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          },
          data: data,
          execLog: execLog
        });
        console.error('[SW Push] Error stack:', error.stack);

        // Try to notify clients about the error
        try {
          const allClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
          allClients.forEach(client => {
            client.postMessage({
              type: 'PUSH_ERROR',
              error: error.message,
              timestamp: timestamp,
              execLog: execLog
            });
          });
        } catch (e) {
          console.error('[SW Push] Failed to notify clients about error:', e);
        }
      }
    })()
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const jobId = event.notification.data?.jobId;
  const targetUrl = jobId ? `/?job=${jobId}` : '/';

  // 🔍 REMOTE DEBUG: Notification clicked
  RemoteDebug.logPushEvent('notification_click', 'User clicked notification', {
    jobId: jobId,
    targetUrl: targetUrl,
    notificationTag: event.notification.tag
  });

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (jobId) client.postMessage({ type: 'OPEN_JOB', jobId });
          RemoteDebug.logPushEvent('notification_click_focused', 'Focused existing window', { jobId, clientUrl: client.url });
          return;
        }
      }
      RemoteDebug.logPushEvent('notification_click_new_window', 'Opening new window', { targetUrl });
      return clients.openWindow(targetUrl);
    })
  );
});
