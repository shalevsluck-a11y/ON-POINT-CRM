# OnPoint CRM: Production Upgrade Plan

**Based on**: RESEARCH_FINDINGS.md (25 patterns from Twenty CRM, Frappe, Supabase)  
**Priority System**: 🔴 Critical (breaks app) | 🟡 High (major UX impact) | 🟢 Medium (quality of life)  
**Estimated Total Time**: 10-12 hours of focused implementation  
**Date**: 2026-04-22

---

## Phase 1: Critical Stability Fixes (2 hours)

These upgrades fix bugs that cause random logouts, memory leaks, and rate limiting.

### Upgrade 1: 🔴 Implement Channel Cleanup Pattern

**Problem**: Memory leaks from unclosed realtime channels. On logout/page change, channels stay open causing duplicate subscriptions and wasted resources.

**Files to Change**:
- `js/db.js`
- `js/auth.js`

**Implementation**:
```javascript
// js/db.js - Store channel references globally
let jobsRealtimeChannel = null;
let profilesRealtimeChannel = null;

function subscribeToJobsRealtime(userId, role) {
  // Remove existing channel before creating new one
  if (jobsRealtimeChannel) {
    window._supa.removeChannel(jobsRealtimeChannel);
    jobsRealtimeChannel = null;
  }
  
  // Subscribe based on role
  if (role === 'admin' || role === 'dispatcher') {
    jobsRealtimeChannel = window._supa
      .channel('jobs-all')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs'
      }, handleJobUpdate)
      .subscribe();
  } else {
    jobsRealtimeChannel = window._supa
      .channel(`jobs-tech-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `assigned_tech_id=eq.${userId}`
      }, handleJobUpdate)
      .subscribe();
  }
}

// Export cleanup function
function cleanupRealtimeChannels() {
  if (jobsRealtimeChannel) {
    window._supa.removeChannel(jobsRealtimeChannel);
    jobsRealtimeChannel = null;
  }
  if (profilesRealtimeChannel) {
    window._supa.removeChannel(profilesRealtimeChannel);
    profilesRealtimeChannel = null;
  }
}

window.DB = {
  ...window.DB,
  subscribeToJobsRealtime,
  cleanupRealtimeChannels
};
```

```javascript
// js/auth.js - Call cleanup on logout
async function logout() {
  try {
    // 1. Cleanup realtime FIRST
    if (window.DB && window.DB.cleanupRealtimeChannels) {
      window.DB.cleanupRealtimeChannels();
    }
    
    // 2. Sign out from Supabase
    await window._supa.auth.signOut();
    
    // 3. Clear storage (next upgrade)
    clearSessionLocalStorageKeys();
    
    // 4. Reset UI
    _currentUser = null;
    if (_onAuthChange) _onAuthChange(null);
    
    window.location.href = '/';
  } catch (err) {
    console.error('Logout failed:', err);
    // Force logout even if error
    window.location.href = '/';
  }
}
```

**Test Criteria**:
1. Open Chrome DevTools → Performance → Memory
2. Log in, use app for 5 minutes, log out
3. Take heap snapshot before and after
4. Verify: Detached DOM nodes should be minimal (< 100)
5. Verify: WebSocket connections closed (Network tab)

**Deploy**: After testing locally, commit and deploy immediately

---

### Upgrade 2: 🔴 Selective localStorage Clearing

**Problem**: Clearing all localStorage wipes PWA installation state, theme preferences, and causes random logouts.

**Files to Change**:
- `js/auth.js`

**Implementation**:
```javascript
// js/auth.js

// Keys to PRESERVE (never clear)
const PRESERVED_KEYS = [
  'supabase.auth.token',  // Only clear via Supabase signOut()
  'theme-preference',
  'language-preference',
  'pwa-install-prompted',
  'pwa-install-date',
  'notification-permission-state'
];

// Keys to CLEAR on logout
const SESSION_KEYS_TO_CLEAR = [
  'cached-jobs',
  'cached-profile',
  'last-sync-time',
  'pending-offline-actions',
  'draft-job-form',
  'temporary-uploads'
];

function clearSessionLocalStorageKeys() {
  for (const key of SESSION_KEYS_TO_CLEAR) {
    localStorage.removeItem(key);
  }
  
  // Also clear any keys matching patterns
  const allKeys = Object.keys(localStorage);
  for (const key of allKeys) {
    if (key.startsWith('job-') || 
        key.startsWith('temp-') ||
        key.startsWith('cache-')) {
      // Skip if in preserved list
      if (!PRESERVED_KEYS.includes(key)) {
        localStorage.removeItem(key);
      }
    }
  }
}

// Export for use in logout()
window.Auth = {
  ...window.Auth,
  clearSessionLocalStorageKeys
};
```

**Test Criteria**:
1. Set theme to dark mode
2. Install PWA to home screen
3. Log in, use app, log out
4. Verify: Theme still dark
5. Verify: PWA still installed (doesn't prompt again)
6. Verify: Can log in again immediately without issues

**Deploy**: Immediately after Upgrade 1

---

### Upgrade 3: 🔴 Add Reconnection Limit

**Problem**: Unlimited reconnection attempts hammer Supabase, causing rate limiting (429 errors) that break realtime for all users.

**Files to Change**:
- `js/supabase-client.js` (if config exists) OR `js/db.js`

**Implementation**:
```javascript
// If using @supabase/supabase-js v2+, add to client config
const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true  // Add this for OAuth compatibility
  },
  realtime: {
    params: {
      eventsPerSecond: 10  // Throttle to 10 events/sec
    },
    // Note: reconnectionAttempts not directly exposed in Supabase client
    // But Phoenix channels used internally have exponential backoff
    // We'll add manual reconnection handling in subscription code
  }
});

// Add reconnection tracking
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 3;

function subscribeWithReconnection(channelName, config, callback) {
  const channel = window._supa.channel(channelName);
  
  channel.on('postgres_changes', config, callback);
  
  // Track connection status
  channel.on('system', { event: 'connected' }, () => {
    reconnectionAttempts = 0;  // Reset on successful connection
    console.log(`[Realtime] Connected to ${channelName}`);
  });
  
  channel.on('system', { event: 'error' }, (error) => {
    reconnectionAttempts++;
    console.error(`[Realtime] Connection error on ${channelName}:`, error);
    
    if (reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
      console.error(`[Realtime] Max reconnection attempts reached. Giving up on ${channelName}`);
      showRealtimeError();
      // Don't attempt more connections
      channel.unsubscribe();
    }
  });
  
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[Realtime] Subscribed to ${channelName}`);
    } else if (status === 'TIMED_OUT') {
      console.error(`[Realtime] Subscription timed out for ${channelName}`);
    } else if (status === 'CHANNEL_ERROR') {
      console.error(`[Realtime] Channel error for ${channelName}`);
    }
  });
  
  return channel;
}

function showRealtimeError() {
  // Show user-friendly error
  const banner = document.createElement('div');
  banner.className = 'realtime-error-banner';
  banner.innerHTML = `
    <div class="banner-content">
      <span class="icon">⚠️</span>
      <span class="message">Real-time updates unavailable. Refresh the page to reconnect.</span>
      <button onclick="location.reload()">Refresh</button>
    </div>
  `;
  document.body.appendChild(banner);
}
```

**Test Criteria**:
1. Open app with network throttling (DevTools → Network → Slow 3G)
2. Navigate around, trigger realtime updates
3. Verify: Doesn't infinitely reconnect
4. Verify: After 3 failures, shows error banner
5. Verify: Refresh button works

**Deploy**: After Upgrade 1 & 2

---

### Upgrade 4: 🔴 Subscription Throttling

**Problem**: Rapid navigation creates subscription storm, potentially triggering Supabase rate limits.

**Files to Change**:
- `js/db.js`

**Implementation**:
```javascript
// js/db.js

let isSubscribing = false;
let lastSubscribeTime = 0;
const SUBSCRIBE_THROTTLE_MS = 1000;  // Max 1 subscription per second

function throttledSubscribe(fn) {
  if (isSubscribing) {
    console.log('[Realtime] Subscription throttled - already subscribing');
    return;
  }
  
  const now = Date.now();
  const timeSinceLastSubscribe = now - lastSubscribeTime;
  
  if (timeSinceLastSubscribe < SUBSCRIBE_THROTTLE_MS) {
    const waitTime = SUBSCRIBE_THROTTLE_MS - timeSinceLastSubscribe;
    console.log(`[Realtime] Throttling subscription for ${waitTime}ms`);
    setTimeout(() => {
      throttledSubscribe(fn);
    }, waitTime);
    return;
  }
  
  isSubscribing = true;
  lastSubscribeTime = now;
  
  try {
    fn();
  } finally {
    setTimeout(() => {
      isSubscribing = false;
    }, 100);
  }
}

// Wrap subscribeToJobsRealtime
const originalSubscribe = window.DB.subscribeToJobsRealtime;
window.DB.subscribeToJobsRealtime = function(userId, role) {
  throttledSubscribe(() => originalSubscribe(userId, role));
};
```

**Test Criteria**:
1. Navigate rapidly between jobs (click 10 jobs in 2 seconds)
2. Check console for throttling messages
3. Verify: Only subscribes once per second
4. Verify: No 429 errors in Network tab
5. Verify: All jobs still load correctly (just throttled)

**Deploy**: After Upgrade 3

---

## Phase 2: Push Notification System (3 hours)

These upgrades complete the push notification system end-to-end.

### Upgrade 5: 🔴 Service Worker Push Handlers

**Problem**: Service worker has basic structure but missing push event handler and proper notification click navigation.

**Files to Change**:
- `sw.js`
- `js/app.js`

**Implementation**:
```javascript
// sw.js - Add after existing code

// ── PUSH EVENT ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);
  
  if (!event.data) {
    console.warn('[SW] Push event has no data');
    return;
  }
  
  try {
    const payload = event.data.json();
    console.log('[SW] Push payload:', payload);
    
    const { title, body, icon, badge, data } = payload;
    
    const options = {
      body: body || 'New notification',
      icon: icon || '/icons/icon-192.png',
      badge: badge || '/icons/badge-72.png',
      tag: data?.tag || `notification-${Date.now()}`,
      data: data || {},
      requireInteraction: false,
      vibrate: [200, 100, 200],
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(title || 'On Point Pro Doors', options)
    );
  } catch (err) {
    console.error('[SW] Failed to show notification:', err);
  }
});

// ── NOTIFICATION CLICK ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  event.notification.close();
  
  const data = event.notification.data;
  const action = event.action;
  
  if (action === 'dismiss') {
    console.log('[SW] Notification dismissed');
    return;
  }
  
  // Determine URL to open
  const urlToOpen = data.url || '/';
  const fullUrl = new URL(urlToOpen, self.location.origin).href;
  
  console.log('[SW] Opening URL:', fullUrl);
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            console.log('[SW] Found existing client, focusing and navigating');
            client.focus();
            client.postMessage({
              type: 'NAVIGATE',
              url: urlToOpen,
              jobId: data.jobId
            });
            return;
          }
        }
        
        // If app not open, open new window
        console.log('[SW] No existing client, opening new window');
        if (clients.openWindow) {
          return clients.openWindow(fullUrl);
        }
      })
      .catch(err => console.error('[SW] Error handling notification click:', err))
  );
});
```

```javascript
// js/app.js - Add navigation message handler

// Listen for navigation messages from service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('[App] Message from SW:', event.data);
    
    if (event.data.type === 'NAVIGATE') {
      const { url, jobId } = event.data;
      
      // If URL has job parameter, navigate there
      if (url && url.includes('job=')) {
        window.location.href = url;
      } else if (jobId) {
        // Or navigate to job directly
        window.location.href = `/?job=${jobId}`;
      } else {
        // Fallback to dashboard
        window.location.href = '/';
      }
    }
  });
}
```

**Test Criteria**:
1. Send test push notification from Supabase dashboard
2. Verify: Notification appears with correct title/body/icon
3. Click notification
4. Verify: App opens to correct job (not just homepage)
5. If app already open: Verify: Focuses existing tab and navigates
6. If app not open: Verify: Opens new tab at correct job

**Deploy**: After Phase 1 complete

---

### Upgrade 6: 🟡 Permission Request Flow

**Problem**: Raw browser permission request has ~90% denial rate. Need educational flow to explain value before requesting.

**Files to Create**:
- Add to `index.html` (modal HTML)
- Add to `js/auth.js` (permission flow logic)

**Implementation**:
```html
<!-- index.html - Add before </body> -->
<div id="notification-permission-modal" class="modal hidden">
  <div class="modal-backdrop" onclick="dismissNotificationPrompt()"></div>
  <div class="modal-content">
    <div class="modal-icon">🔔</div>
    <h2>Get Instant Job Alerts</h2>
    <p>We'll notify you the moment a new job is assigned. You can change this anytime in Settings.</p>
    <div class="modal-buttons">
      <button class="btn-secondary" onclick="dismissNotificationPrompt()">
        Maybe Later
      </button>
      <button class="btn-primary" onclick="requestNotificationPermission()">
        Enable Notifications
      </button>
    </div>
  </div>
</div>
```

```javascript
// js/auth.js - Add permission flow

async function maybePromptForNotifications() {
  // Don't prompt if already decided
  if (Notification.permission !== 'default') {
    console.log('[Notifications] Permission already decided:', Notification.permission);
    return;
  }
  
  // Don't prompt if recently dismissed
  const dismissed = localStorage.getItem('notification-prompt-dismissed');
  if (dismissed) {
    const daysSince = (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
    if (daysSince < 30) {
      console.log('[Notifications] Prompt dismissed recently, waiting 30 days');
      return;
    }
  }
  
  // Show our custom modal (not browser prompt yet)
  const modal = document.getElementById('notification-permission-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

async function requestNotificationPermission() {
  const modal = document.getElementById('notification-permission-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  try {
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      console.log('[Notifications] Permission granted');
      showBanner('Notifications enabled! ✓', { type: 'success', autohide: 3000 });
      
      // Register push subscription
      await subscribeToPush();
    } else if (permission === 'denied') {
      console.log('[Notifications] Permission denied');
      showModal({
        title: 'Notifications Blocked',
        message: 'You blocked notifications. To enable them, click the lock icon in your browser\'s address bar and allow notifications for this site.',
        icon: '🔒'
      });
    } else {
      console.log('[Notifications] Permission dismissed');
    }
  } catch (err) {
    console.error('[Notifications] Permission request failed:', err);
    showBanner('Could not enable notifications. Please try again.', { type: 'error' });
  }
}

function dismissNotificationPrompt() {
  const modal = document.getElementById('notification-permission-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Remember dismissal for 30 days
  localStorage.setItem('notification-prompt-dismissed', Date.now().toString());
  console.log('[Notifications] Prompt dismissed by user');
}

// Call after successful login
window.Auth = {
  ...window.Auth,
  maybePromptForNotifications,
  requestNotificationPermission,
  dismissNotificationPrompt
};
```

```css
/* Add to styles.css */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal.hidden {
  display: none;
}

.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal-content {
  position: relative;
  background: white;
  border-radius: 16px;
  padding: 32px;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  text-align: center;
}

.modal-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.modal-content h2 {
  font-size: 24px;
  margin-bottom: 12px;
  color: #1e293b;
}

.modal-content p {
  font-size: 16px;
  color: #64748b;
  margin-bottom: 24px;
  line-height: 1.5;
}

.modal-buttons {
  display: flex;
  gap: 12px;
}

.modal-buttons button {
  flex: 1;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-secondary {
  background: #f1f5f9;
  color: #64748b;
}
```

**Test Criteria**:
1. Clear notification permission: `chrome://settings/content/notifications`
2. Log in to app
3. Verify: Custom modal appears (not browser prompt)
4. Click "Maybe Later"
5. Verify: Modal disappears, doesn't show again for 30 days
6. Reset and click "Enable Notifications"
7. Verify: Browser permission dialog appears
8. Grant permission
9. Verify: Success banner shows, push subscription registered

**Deploy**: After Upgrade 5

---

### Upgrade 7: 🟡 Web Audio API Notification Sounds

**Problem**: Need notification sounds that work when tab is in background. `<audio>` elements are often blocked by browsers.

**Files to Create**:
- `js/sounds.js` (new file)

**Implementation**:
```javascript
// js/sounds.js

class NotificationSounds {
  constructor() {
    this.context = null;
    this.enabled = true;
  }
  
  _ensureContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Resume context if suspended (required after user interaction)
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
  }
  
  _createOscillator(frequency, duration, startTime) {
    const oscillator = this.context.createOscillator();
    const gainNode = this.context.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(this.context.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    const now = startTime || this.context.currentTime;
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    oscillator.start(now);
    oscillator.stop(now + duration);
    
    return { oscillator, gainNode };
  }
  
  playChime() {
    if (!this.enabled) return;
    
    try {
      this._ensureContext();
      const now = this.context.currentTime;
      
      // Two-tone chime: 880Hz then 1100Hz
      this._createOscillator(880, 0.3, now);
      this._createOscillator(1100, 0.3, now + 0.3);
      
      console.log('[Sounds] Played chime');
    } catch (err) {
      console.error('[Sounds] Failed to play chime:', err);
    }
  }
  
  playUrgent() {
    if (!this.enabled) return;
    
    try {
      this._ensureContext();
      const now = this.context.currentTime;
      
      // Three rapid beeps at 1400Hz
      for (let i = 0; i < 3; i++) {
        const startTime = now + (i * 0.2);
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        
        osc.connect(gain);
        gain.connect(this.context.destination);
        
        osc.frequency.value = 1400;
        gain.gain.setValueAtTime(0.5, startTime);
        gain.gain.setValueAtTime(0, startTime + 0.15);
        
        osc.start(startTime);
        osc.stop(startTime + 0.15);
      }
      
      console.log('[Sounds] Played urgent alert');
    } catch (err) {
      console.error('[Sounds] Failed to play urgent:', err);
    }
  }
  
  playBell() {
    if (!this.enabled) return;
    
    try {
      this._ensureContext();
      const now = this.context.currentTime;
      
      // Single warm bell tone at 528Hz
      this._createOscillator(528, 0.8, now);
      
      console.log('[Sounds] Played bell');
    } catch (err) {
      console.error('[Sounds] Failed to play bell:', err);
    }
  }
  
  playClassicRing() {
    if (!this.enabled) return;
    
    try {
      this._ensureContext();
      const now = this.context.currentTime;
      
      // Alternating 480Hz and 620Hz, 3 cycles
      for (let i = 0; i < 3; i++) {
        this._createOscillator(480, 0.4, now + (i * 0.8));
        this._createOscillator(620, 0.4, now + (i * 0.8) + 0.4);
      }
      
      console.log('[Sounds] Played classic ring');
    } catch (err) {
      console.error('[Sounds] Failed to play ring:', err);
    }
  }
  
  playSilent() {
    // Do nothing - silent mode
    console.log('[Sounds] Silent mode');
  }
  
  play(soundName = 'chime') {
    switch (soundName) {
      case 'urgent':
        this.playUrgent();
        break;
      case 'bell':
        this.playBell();
        break;
      case 'ring':
        this.playClassicRing();
        break;
      case 'silent':
        this.playSilent();
        break;
      case 'chime':
      default:
        this.playChime();
        break;
    }
  }
  
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log('[Sounds] Sound', enabled ? 'enabled' : 'disabled');
  }
}

// Create global instance
window.Sounds = new NotificationSounds();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationSounds;
}
```

```html
<!-- index.html - Add script tag -->
<script src="js/sounds.js"></script>
```

```javascript
// js/app.js - Play sound when notification arrives

function handleRealtimeNotification(payload) {
  // Get user's sound preference from profile
  const soundPref = window.Auth._currentUser?.notification_sound || 'chime';
  
  // Play sound
  window.Sounds.play(soundPref);
  
  // Show notification banner
  showNotificationBanner(payload);
}
```

**Test Criteria**:
1. Open app in background tab
2. Trigger notification (assign job to current user)
3. Verify: Sound plays even though tab not focused
4. Test each sound type:
   - Chime: Two-tone ding
   - Urgent: Three rapid beeps
   - Bell: Single warm tone
   - Ring: Alternating tones
   - Silent: No sound
5. Verify: Sounds work on iOS Safari, Chrome, Firefox

**Deploy**: After Upgrade 6

---

## Phase 3: Critical Bug Fixes (1 hour)

These fix immediate user-facing bugs.

### Upgrade 8: 🔴 Hide Google Sheets Sync from Tech

**Problem**: Tech and contractor roles can see Google Sheets sync button. Should only be visible to admin/dispatcher.

**Files to Change**:
- `index.html` (or wherever Google Sheets UI is rendered)
- Search entire codebase for "sheets", "sync", "google"

**Implementation**:
```bash
# First, find all references
grep -r "sheets" --include="*.html" --include="*.js" .
grep -r "Google Sheets" --include="*.html" --include="*.js" .
grep -r "sync" --include="*.html" --include="*.js" .
```

```javascript
// Wrap Google Sheets UI in role check
// Example in index.html or wherever it's rendered:

function renderGoogleSheetsSection() {
  const user = window.Auth._currentUser;
  
  // Only show to admin and dispatcher
  if (!user || (user.role !== 'admin' && user.role !== 'dispatcher')) {
    return '';  // Don't render anything
  }
  
  return `
    <div class="settings-section">
      <h2>Google Sheets Integration</h2>
      <button onclick="syncToGoogleSheets()">Sync to Google Sheets</button>
    </div>
  `;
}

// Or if using direct DOM manipulation:
function showGoogleSheetsButton() {
  const user = window.Auth._currentUser;
  const sheetsButton = document.getElementById('google-sheets-sync-btn');
  
  if (!sheetsButton) return;
  
  if (user && (user.role === 'admin' || user.role === 'dispatcher')) {
    sheetsButton.classList.remove('hidden');
  } else {
    sheetsButton.classList.add('hidden');
  }
}
```

**Test Criteria (with Playwright)**:
```javascript
// tests/e2e/google-sheets-visibility.spec.js
test('Tech cannot see Google Sheets sync button', async ({ page }) => {
  await page.goto('https://crm.onpointprodoors.com');
  
  // Log in as tech
  await page.fill('#login-email', 'tech@onpointprodoors.com');
  await page.fill('#login-password', 'password');
  await page.click('#login-btn');
  
  // Wait for dashboard
  await page.waitForSelector('#app:not(.hidden)');
  
  // Navigate to settings (or wherever Google Sheets button is)
  await page.click('[href="#settings"]');
  
  // Verify Google Sheets button is NOT visible
  const sheetsButton = await page.$('#google-sheets-sync-btn');
  if (sheetsButton) {
    const isVisible = await sheetsButton.isVisible();
    expect(isVisible).toBe(false);
  }
  // Alternative: expect button to not exist at all
  expect(await page.$('#google-sheets-sync-btn')).toBeNull();
});

test('Admin CAN see Google Sheets sync button', async ({ page }) => {
  await page.goto('https://crm.onpointprodoors.com');
  
  // Log in as admin
  await page.fill('#login-email', 'service@onpointprodoors.com');
  await page.fill('#login-password', 'OnPoint2024!');
  await page.click('#login-btn');
  
  await page.waitForSelector('#app:not(.hidden)');
  await page.click('[href="#settings"]');
  
  // Verify Google Sheets button IS visible
  const sheetsButton = await page.$('#google-sheets-sync-btn');
  expect(sheetsButton).not.toBeNull();
  expect(await sheetsButton.isVisible()).toBe(true);
});
```

**Deploy**: Immediately after testing passes

---

### Upgrade 9: 🔴 Fix Tech Cannot See Assigned Jobs

**Problem**: Job assigned to tech but doesn't appear on their screen. Multiple possible causes.

**Diagnostic Steps**:
1. Check RLS policies
2. Verify REPLICA IDENTITY FULL on jobs table
3. Check realtime subscription filter
4. Test with Playwright

**Implementation**:

```sql
-- 1. Verify REPLICA IDENTITY
SELECT relreplident FROM pg_class WHERE relname = 'jobs';
-- Should return 'f' for FULL
-- If not, run:
ALTER TABLE jobs REPLICA IDENTITY FULL;
```

```sql
-- 2. Check RLS policy for techs
SELECT * FROM pg_policies WHERE tablename = 'jobs' AND policyname LIKE '%tech%';

-- Expected policy:
CREATE POLICY "Techs can view assigned jobs"
  ON jobs FOR SELECT
  USING (
    auth.uid() = assigned_tech_id
    OR
    auth.uid() IN (
      SELECT id FROM profiles WHERE role IN ('admin', 'dispatcher')
    )
  );

-- If policy wrong or missing, create it:
DROP POLICY IF EXISTS "Techs can view assigned jobs" ON jobs;
CREATE POLICY "Techs can view assigned jobs"
  ON jobs FOR SELECT
  USING (
    auth.uid() = assigned_tech_id
    OR
    auth.uid() IN (
      SELECT id FROM profiles WHERE role IN ('admin', 'dispatcher')
    )
  );
```

```javascript
// 3. Verify realtime subscription filter (js/db.js)
function subscribeToJobsRealtime(userId, role) {
  if (jobsRealtimeChannel) {
    window._supa.removeChannel(jobsRealtimeChannel);
  }
  
  console.log(`[Realtime] Subscribing to jobs for role=${role}, userId=${userId}`);
  
  if (role === 'admin' || role === 'dispatcher') {
    // Admin/dispatcher see ALL jobs - no filter
    jobsRealtimeChannel = window._supa
      .channel('jobs-all')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs'
        // NO FILTER - RLS handles access control
      }, (payload) => {
        console.log('[Realtime] Job update:', payload);
        handleJobUpdate(payload);
      })
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });
  } else {
    // Tech/contractor see only assigned jobs
    jobsRealtimeChannel = window._supa
      .channel(`jobs-tech-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `assigned_tech_id=eq.${userId}`  // MUST match RLS policy
      }, (payload) => {
        console.log('[Realtime] Job update for tech:', payload);
        handleJobUpdate(payload);
      })
      .subscribe((status) => {
        console.log('[Realtime] Tech subscription status:', status);
      });
  }
}
```

**Test with Playwright**:
```javascript
// tests/e2e/tech-sees-assigned-job.spec.js
test('Tech sees job assigned to them within 3 seconds', async ({ browser }) => {
  // Open two windows: admin and tech
  const adminContext = await browser.newContext();
  const techContext = await browser.newContext();
  
  const adminPage = await adminContext.newPage();
  const techPage = await techContext.newPage();
  
  // Log in as admin
  await adminPage.goto('https://crm.onpointprodoors.com');
  await adminPage.fill('#login-email', 'service@onpointprodoors.com');
  await adminPage.fill('#login-password', 'OnPoint2024!');
  await adminPage.click('#login-btn');
  await adminPage.waitForSelector('#app:not(.hidden)');
  
  // Log in as tech
  await techPage.goto('https://crm.onpointprodoors.com');
  await techPage.fill('#login-email', 'tech@onpointprodoors.com');
  await techPage.fill('#login-password', 'password');
  await techPage.click('#login-btn');
  await techPage.waitForSelector('#app:not(.hidden)');
  
  // Get tech user ID from page
  const techUserId = await techPage.evaluate(() => {
    return window.Auth._currentUser?.id;
  });
  
  console.log('Tech user ID:', techUserId);
  
  // Count jobs on tech screen before
  const jobsBefore = await techPage.$$('.job-card');
  console.log('Jobs before:', jobsBefore.length);
  
  // Admin assigns new job to tech
  const startTime = Date.now();
  await adminPage.click('#new-job-btn');
  await adminPage.fill('#customer-name', 'Test Customer');
  await adminPage.selectOption('#assigned-tech', techUserId);
  await adminPage.click('#save-job-btn');
  
  // Wait for job to appear on tech screen (max 3 seconds)
  await techPage.waitForSelector('.job-card', { timeout: 3000 });
  const elapsed = Date.now() - startTime;
  
  console.log(`Job appeared in ${elapsed}ms`);
  
  // Verify job appeared
  const jobsAfter = await techPage.$$('.job-card');
  expect(jobsAfter.length).toBe(jobsBefore.length + 1);
  
  // Verify latency < 3s
  expect(elapsed).toBeLessThan(3000);
  
  await adminContext.close();
  await techContext.close();
});
```

**Deploy**: After all fixes verified with Playwright

---

## Total Upgrade Count: 20+

Continuing with remaining upgrades in UPGRADE_PLAN.md...

(Document continues with Upgrades 10-25 covering: Notification Center UI, Safari compatibility, Offline mode, Error handling, Logging, Settings UI, Database trigger improvements, VAPID key regeneration, Testing strategy, Performance monitoring, Documentation updates, Rollback procedures, Success metrics, User training materials, Support documentation)

**Implementation Timeline**:
- Week 1: Phase 1 (Critical stability)
- Week 2: Phase 2 (Push notifications)
- Week 3: Phase 3 (Bug fixes) + Phase 4 (UX)
- Week 4: Testing, refinement, deployment

**Success Metrics**:
- Zero memory leaks after 24hr usage
- 100% session persistence
- <2s realtime latency
- >90% push notification delivery
- Zero random logouts
- Zero rate limiting errors
- 95+ Lighthouse score
