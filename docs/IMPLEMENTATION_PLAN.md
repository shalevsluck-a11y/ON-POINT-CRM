# Implementation Plan: Session Persistence, Realtime & Push Notifications

## Overview

This plan implements proven patterns from production CRMs (Twenty, Frappe, Supabase examples) to fix session persistence, enable realtime updates, and add push notifications to On Point CRM.

---

## Phase 1: Session Persistence Fix (CRITICAL - 30 min)

### Problem
- Sessions lost on browser refresh/restart
- Playwright tests failing: `dashVisible=false loginStillVisible=true`
- Auth callback not firing for existing sessions

### Root Cause Analysis
From Twenty CRM (`useAuth.ts`):
```typescript
clearSession() {
  sessionStorage.clear()
  clearSessionLocalStorageKeys()  // Critical cleanup
  store.set(tokenPairState.atom, null)
  await client.clearStore()  // Apollo cache clear
}
```

From Supachat (`browser.ts`):
```typescript
// Singleton pattern prevents multiple clients
let client: TypedSupabaseClient | undefined

export function getSupabaseBrowserClient() {
  if (client) return client
  client = createBrowserClient<Database>(url, key)
  return client
}
```

**Current CRM Bug**: Auth.init loads session but never calls `_onAuthChange` callback.

### Implementation

**File: `js/supabase-client.js`**
```javascript
// PATTERN 1: PWA-safe storage with context detection
const isPWA = window.navigator.standalone === true ||
              window.matchMedia('(display-mode: standalone)').matches

const storageKey = isPWA ? 'onpoint-pwa-auth' : 'onpoint-web-auth'

const customStorage = {
  getItem: (key) => window.localStorage.getItem(`${storageKey}-${key}`),
  setItem: (key, value) => window.localStorage.setItem(`${storageKey}-${key}`, value),
  removeItem: (key) => window.localStorage.removeItem(`${storageKey}-${key}`)
}

const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,     // CRITICAL FIX
    persistSession: true,        // CRITICAL FIX
    detectSessionInUrl: true,
    storage: customStorage,
    storageKey: storageKey,
  }
})
```

**File: `js/auth.js`**
```javascript
async function init(onAuthChange) {
  _onAuthChange = onAuthChange

  // Listen for auth state changes
  SupabaseClient.auth.onAuthStateChange(async (event, session) => {
    try {
      if (session?.user) {
        await _loadProfile(session.user)
        _consecutiveRefreshFailures = 0
      } else {
        _currentUser = null
      }
    } catch (e) {
      console.error('Auth state change error:', e)
      _currentUser = null
    }
    if (_onAuthChange) _onAuthChange(_currentUser)
  })

  // Check for existing session
  try {
    const { data: { session } } = await SupabaseClient.auth.getSession()
    if (session?.user) {
      await _loadProfile(session.user)
      _startSessionHealthCheck()
      // CRITICAL FIX: Call callback for existing session
      if (_onAuthChange) _onAuthChange(_currentUser)
    }
  } catch (e) {
    console.error('Session load failed:', e)
  }
  return _currentUser
}
```

### Testing
```javascript
// tests/e2e/session-verification.spec.js
test('Session persists after browser restart', async ({ browser }) => {
  const context1 = await browser.newContext()
  const page1 = await context1.newPage()
  
  await page1.goto('http://localhost:3000')
  await page1.fill('#login-email', 'test@example.com')
  await page1.fill('#login-password', 'password')
  await page1.click('#login-submit')
  
  await page1.waitForSelector('#dashboard', { timeout: 5000 })
  
  // Save storage state
  const storageState = await context1.storageState()
  await context1.close()
  
  // Create new context with saved state
  const context2 = await browser.newContext({ storageState })
  const page2 = await context2.newPage()
  
  await page2.goto('http://localhost:3000')
  
  // Dashboard should appear without login
  await page2.waitForSelector('#dashboard', { timeout: 3000 })
  const loginVisible = await page2.isVisible('#login-form')
  
  expect(loginVisible).toBe(false)
  await context2.close()
})
```

---

## Phase 2: Realtime Job Assignment (45 min)

### Problem
- Jobs assigned to tech don't appear on tech's screen
- Need real-time updates within 2 seconds
- Connection status not visible

### Pattern from Supachat MessageList.tsx

```typescript
useEffect(() => {
  const channel = supabase
    .channel('messages')  // Unique channel name
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
    }, (payload) => {
      setMessages((prev) => [domainObject].concat(prev))
      if (payload.new.user_id === currentUserId) {
        document.documentElement.scrollTop = scrollHeight
      }
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel)  // CRITICAL cleanup
  }
}, [supabase, setMessages])
```

### Implementation

**File: `js/db.js`**
```javascript
function subscribeToJobs(onInsert, onUpdate, onDelete, onStatusChange) {
  const user = Auth.getUser()
  if (!user) return null

  const channel = supa.channel('public:jobs')

  if (Auth.isAdminOrDisp()) {
    // Admin/dispatcher see all jobs
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, 
        payload => {
          const job = _dbRowToJob(payload.new, {}, true, false)
          Storage.saveJob(job)
          if (onInsert) onInsert(job)
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' },
        payload => {
          const job = _dbRowToJob(payload.new, {}, true, false)
          Storage.saveJob(job)
          if (onUpdate) onUpdate(job)
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'jobs' },
        payload => {
          const jobId = payload.old.id
          Storage.deleteJob(jobId)
          if (onDelete) onDelete(jobId)
        })
  } else if (Auth.isTech() || Auth.isContractor()) {
    // Tech/contractor only see assigned jobs
    channel
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'jobs',
        filter: `assigned_tech_id=eq.${user.id}`
      }, payload => {
        const job = _dbRowToJob(payload.new, {}, true, false)
        Storage.saveJob(job)
        if (onInsert) onInsert(job)
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'jobs',
        filter: `assigned_tech_id=eq.${user.id}`
      }, payload => {
        const job = _dbRowToJob(payload.new, {}, true, false)
        Storage.saveJob(job)
        if (onUpdate) onUpdate(job)
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'jobs',
        filter: `assigned_tech_id=eq.${user.id}`
      }, payload => {
        const jobId = payload.old.id
        Storage.deleteJob(jobId)
        if (onDelete) onDelete(jobId)
      })
    
    // Contractor also listens to lead source jobs
    if (Auth.isContractor() && user.assignedLeadSource) {
      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `source=eq.${user.assignedLeadSource}`
      }, payload => {
        // Handle contractor lead source jobs
      })
    }
  }

  return channel.subscribe((status) => {
    console.log('Jobs channel status:', status)
    if (onStatusChange) onStatusChange(status)
  })
}
```

**File: `js/app.js`**
```javascript
function _updateRealtimeStatus(status) {
  const indicator = document.getElementById('realtime-status')
  if (!indicator) return

  if (status === 'SUBSCRIBED') {
    indicator.style.background = '#10b981'  // Green
    indicator.title = 'Live updates active'
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    indicator.style.background = '#f59e0b'  // Orange
    indicator.title = 'Reconnecting...'
  } else if (status === 'CLOSED') {
    indicator.style.background = '#ef4444'  // Red
    indicator.title = 'Disconnected'
  }
}

function _playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.value = 523.25  // C5 note
    oscillator.type = 'sine'

    const now = audioContext.currentTime
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3)

    oscillator.start(now)
    oscillator.stop(now + 0.3)
  } catch (e) {
    console.warn('Notification sound failed:', e)
  }
}
```

**Database Migration:**
```sql
-- Enable REPLICA IDENTITY for DELETE operations
ALTER TABLE jobs REPLICA IDENTITY FULL;
ALTER TABLE profiles REPLICA IDENTITY FULL;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
```

---

## Phase 3: Web Push Notifications (2 hours)

### Architecture
1. Generate VAPID keys (one-time)
2. Service worker registers for push
3. Store subscription in `push_subscriptions` table
4. Edge Function sends push via Web Push API
5. Service worker shows notification
6. Click handler navigates to job

### Implementation

**VAPID Key Generation (run once):**
```bash
npx web-push generate-vapid-keys
```

Store in `.env`:
```
VAPID_PUBLIC_KEY=BN...
VAPID_PRIVATE_KEY=...
```

**File: `public/sw.js`**
```javascript
self.addEventListener('push', (event) => {
  const data = event.data.json()
  
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.tag || 'default',
    data: {
      url: data.url || '/',
      jobId: data.jobId,
      timestamp: Date.now()
    }
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  )
})
```

**File: `js/push-manager.js`**
```javascript
async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported')
    return null
  }

  const registration = await navigator.serviceWorker.register('/sw.js')
  const permission = await Notification.requestPermission()
  
  if (permission !== 'granted') {
    console.warn('Push permission denied')
    return null
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  })

  // Save to database
  const { endpoint, keys } = subscription.toJSON()
  await SupabaseClient.from('push_subscriptions').upsert({
    user_id: Auth.getUser().id,
    endpoint: endpoint,
    p256dh: keys.p256dh,
    auth_key: keys.auth,
    user_agent: navigator.userAgent
  }, { onConflict: 'user_id,endpoint' })

  return subscription
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/')
  
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
```

**Edge Function: `supabase/functions/send-push/index.ts`**
```typescript
import webpush from 'npm:web-push@3'
import { createClient } from 'jsr:@supabase/supabase-js@2'

webpush.setVapidDetails(
  'mailto:admin@onpointprodoors.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const payload = await req.json()
  
  // Get user's push subscriptions
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', payload.user_id)

  if (!subscriptions?.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Send to all user devices
  const promises = subscriptions.map(({ endpoint, p256dh, auth_key }) =>
    webpush.sendNotification(
      { endpoint, keys: { p256dh, auth: auth_key } },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
        jobId: payload.jobId
      })
    ).catch(err => {
      console.error('Push failed:', err)
      // Remove invalid subscription
      if (err.statusCode === 410) {
        supabase.from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint)
      }
    })
  )

  const results = await Promise.allSettled(promises)
  const sent = results.filter(r => r.status === 'fulfilled').length

  return new Response(JSON.stringify({ sent }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

**Database Trigger:**
```sql
CREATE TABLE push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_tech_id IS NOT NULL AND 
     (OLD.assigned_tech_id IS NULL OR OLD.assigned_tech_id != NEW.assigned_tech_id) THEN
    
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'user_id', NEW.assigned_tech_id,
        'title', 'New Job Assigned',
        'body', 'Job #' || NEW.job_id || ' - ' || NEW.customer_name,
        'url', '/jobs/' || NEW.id,
        'tag', 'job-' || NEW.id,
        'jobId', NEW.id
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_job_assigned
  AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_assigned();
```

---

## Phase 4: Testing & Validation (1 hour)

### Playwright Tests

**Session Persistence:**
- ✅ Login → refresh → still logged in
- ✅ Login → close browser → open → still logged in
- ✅ Token refresh before expiry
- ✅ Logout clears all storage

**Realtime:**
- ✅ Admin assigns job → Tech sees in <2s
- ✅ Job update → All viewers see update
- ✅ Job delete → Removed from all screens
- ✅ Connection status indicator updates

**Push Notifications:**
- ✅ Permission request flow
- ✅ Notification appears on assignment
- ✅ Click navigates to job
- ✅ Multiple devices receive push

---

## Phase 5: Deployment Checklist

1. ✅ Generate VAPID keys, store in Vercel/production env
2. ✅ Run database migrations (REPLICA IDENTITY, triggers)
3. ✅ Deploy Edge Function (`send-push`)
4. ✅ Update service worker cache version
5. ✅ Test on actual mobile device
6. ✅ Monitor Supabase realtime dashboard
7. ✅ Set up error logging for push failures

---

## Success Metrics

- **Session Persistence**: 100% of Playwright tests pass
- **Realtime**: Jobs appear in <2 seconds (measured)
- **Push**: >90% delivery rate
- **Performance**: No memory leaks after 1 hour continuous use
- **Stability**: Zero crashes in 24-hour stress test

---

## Rollback Plan

If issues occur:
1. Disable push trigger: `ALTER TABLE jobs DISABLE TRIGGER on_job_assigned`
2. Disable realtime: Comment out `DB.subscribeToJobs()` calls
3. Force session refresh on every page load
4. Deploy previous service worker version
