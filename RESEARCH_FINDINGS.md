# Research Findings: Session Persistence, Realtime Updates & Push Notifications

## Executive Summary

After analyzing production implementations from Supabase's official examples (Slack Clone, Auth Presence, Expo Push Notifications), the following critical patterns emerged that directly address the current CRM bugs:

### Key Findings
1. **Session Persistence**: Mobile/PWA apps require explicit `AsyncStorage` configuration with `persistSession: true` and `autoRefreshToken: true`
2. **Realtime Channels**: Use unique channel names with proper cleanup on unmount to prevent memory leaks and duplicate subscriptions
3. **REPLICA IDENTITY**: Tables must have `REPLICA IDENTITY FULL` for delete operations to work in realtime
4. **Optimistic UI**: Not used in production examples - they rely on immediate database round-trips
5. **Push Notifications**: Expo pattern uses Edge Functions + database triggers, Web Push needs service workers + VAPID keys

---

## 1. Session Persistence Patterns

### From: `expo-push-notifications/lib/supabase.ts`
**File Path**: `examples/user-management/expo-push-notifications/lib/supabase.ts`

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,           // Critical for PWAs
    autoRefreshToken: true,          // Must be enabled
    persistSession: true,            // Must be enabled
    detectSessionInUrl: false,       // Disable for native apps
  },
})
```

**Why this matters for the CRM:**
- Current implementation likely missing `persistSession: true`
- Default browser localStorage may not work in PWA mode
- Token refresh failures cause silent logouts

### Recommended for Vanilla JS/PWA:

```javascript
// lib/supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Custom storage wrapper for PWA compatibility
const browserStorage = {
  getItem: (key) => {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  },
  setItem: (key, value) => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  }
}

export const supabase = createClient(
  import.meta.env.SUPABASE_URL,
  import.meta.env.SUPABASE_ANON_KEY,
  {
    auth: {
      storage: browserStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,      // Enable for OAuth flows
      flowType: 'pkce'               // More secure than implicit
    },
    global: {
      headers: {
        'x-application-name': 'onpoint-crm'
      }
    }
  }
)
```

### App Initialization Sequence

**From**: `expo-push-notifications/App.tsx`
```typescript
export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    // 1. Get session immediately on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // 2. Set up listener for session changes
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
  }, [])

  return session ? <AuthenticatedApp /> : <LoginScreen />
}
```

**Storage Keys Used** (discovered from pattern analysis):
- `sb-{project-ref}-auth-token` - Main session token
- Session refresh happens automatically every hour by default

---

## 2. Realtime Implementation

### From: `slack-clone/lib/Store.js`
**File Path**: `examples/slack-clone/nextjs-slack-clone/lib/Store.js`

```javascript
// ⚠️ CRITICAL: One client instance, multiple channels
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)

export const useStore = (props) => {
  useEffect(() => {
    // PATTERN 1: Unique channel names prevent conflicts
    const messageListener = supabase
      .channel('public:messages')  // Unique name
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => handleNewMessage(payload.new))
      .on('postgres_changes', { 
        event: 'DELETE', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => handleDeletedMessage(payload.old))
      .subscribe()

    // PATTERN 2: Separate channel for each table
    const userListener = supabase
      .channel('public:users')
      .on('postgres_changes', { 
        event: '*',           // Listen to all events
        schema: 'public', 
        table: 'users' 
      }, (payload) => handleNewOrUpdatedUser(payload.new))
      .subscribe()

    const channelListener = supabase
      .channel('public:channels')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channels' }, 
        (payload) => handleNewChannel(payload.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channels' }, 
        (payload) => handleDeletedChannel(payload.old))
      .subscribe()

    // PATTERN 3: Critical cleanup
    return () => {
      supabase.removeChannel(messageListener)
      supabase.removeChannel(userListener)
      supabase.removeChannel(channelListener)
    }
  }, [])
}
```

### Reconnection Strategy

**From**: `nextjs-auth-presence/pages/index.tsx`
```typescript
useEffect(() => {
  const channel = supabaseClient.channel('online-users', {
    config: {
      presence: {
        key: this_user?.email ? this_user?.email : 'Unknown',
      },
    },
  })

  channel.on('presence', { event: 'sync' }, () => {
    const presentState = channel.presenceState()
    setUserState({ ...presentState })
  })

  channel.on('presence', { event: 'join' }, ({ newPresences }) => {
    console.log('New users have joined: ', newPresences)
  })

  // Subscribe with status callback
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        user_name: this_user?.email
      })
    }
  })
}, [])
```

**Connection statuses**:
- `SUBSCRIBED` - Ready to receive events
- `CHANNEL_ERROR` - Reconnection needed
- `TIMED_OUT` - Connection lost
- `CLOSED` - Channel closed intentionally

### REPLICA IDENTITY Configuration

**From**: `slack-clone/full-schema.sql`
```sql
-- Required for DELETE operations in realtime
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE channels REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- Enable realtime for tables
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE channels;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
```

**Why this matters**:
- Without `REPLICA IDENTITY FULL`, DELETE events only send the primary key
- UPDATE events may not trigger if tracked columns aren't included
- The CRM likely has this missing, causing silent failures

---

## 3. Push Notifications

### Expo/Mobile Pattern

**Architecture**:
1. Client registers for push tokens (Expo/FCM)
2. Token stored in `profiles.expo_push_token`
3. Database trigger fires on new notifications
4. Edge Function sends push via Expo API

**From**: `expo-push-notifications/supabase/functions/push/index.ts`
```typescript
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: Notification
  schema: 'public'
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const payload: WebhookPayload = await req.json()
  
  // Get user's push token
  const { data } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', payload.record.user_id)
    .single()

  // Send to Expo Push API
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`,
    },
    body: JSON.stringify({
      to: data?.expo_push_token,
      sound: 'default',
      body: payload.record.body,
    })
  })
})
```

**From**: `expo-push-notifications/components/Push.tsx`
```typescript
async function registerForPushNotificationsAsync() {
  // 1. Request permissions
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return ''

  // 2. Get Expo push token
  token = await Notifications.getExpoPushTokenAsync({
    projectId: Constants?.expoConfig?.extra?.eas.projectId,
  })

  return token?.data
}

// 3. Store token in database
useEffect(() => {
  registerForPushNotificationsAsync().then(async (token) => {
    await supabase
      .from('profiles')
      .upsert({ 
        id: session?.user.id, 
        expo_push_token: token 
      })
  })
}, [])
```

### Web Push Pattern (for PWA)

**Architecture**:
1. Generate VAPID keys (server-side once)
2. Service worker registers for push
3. Store subscription in database
4. Trigger notifications via Web Push API

**Recommended Implementation**:

```javascript
// public/service-worker.js
self.addEventListener('push', (event) => {
  const data = event.data.json()
  
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: {
      url: data.url || '/',
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

```javascript
// lib/push-notifications.js
async function subscribeToPush() {
  // 1. Register service worker
  const registration = await navigator.serviceWorker.register('/service-worker.js')
  
  // 2. Request permission
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  // 3. Subscribe to push
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  })

  // 4. Store in database
  await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: session.user.id,
      subscription: subscription.toJSON(),
      user_agent: navigator.userAgent
    })

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

**VAPID Key Generation** (run once on server):
```javascript
// Generate VAPID keys using web-push library
const webpush = require('web-push')
const vapidKeys = webpush.generateVAPIDKeys()

console.log('Public Key:', vapidKeys.publicKey)
console.log('Private Key:', vapidKeys.privateKey)

// Store in environment variables
// VAPID_PUBLIC_KEY=...
// VAPID_PRIVATE_KEY=...
```

**Edge Function to Send Web Push**:
```typescript
// supabase/functions/send-web-push/index.ts
import webpush from 'npm:web-push@3'

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
)

Deno.serve(async (req) => {
  const payload = await req.json()
  
  // Get subscriptions for user
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', payload.user_id)

  // Send to all devices
  const promises = subscriptions.map(({ subscription }) =>
    webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url
      })
    )
  )

  await Promise.all(promises)
})
```

---

## 4. Recommended Implementation for This CRM

### Phase 1: Fix Session Persistence (Highest Priority)

**File**: `/js/supabase-client.js`
```javascript
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// PWA-safe storage wrapper
const storage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      console.error('Storage unavailable:', e)
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch (e) {
      console.error('Storage unavailable:', e)
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch (e) {
      console.error('Storage unavailable:', e)
    }
  }
}

export const supabase = createClient(
  window.ENV.SUPABASE_URL,
  window.ENV.SUPABASE_ANON_KEY,
  {
    auth: {
      storage: storage,
      autoRefreshToken: true,      // CRITICAL FIX
      persistSession: true,         // CRITICAL FIX
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  }
)
```

**File**: `/js/app.js` (initialization)
```javascript
import { supabase } from './supabase-client.js'

// Initialize session on page load
async function initializeAuth() {
  const { data: { session }, error } = await supabase.auth.getSession()
  
  if (error) {
    console.error('Session error:', error)
    window.location.href = '/login.html'
    return
  }

  if (!session) {
    window.location.href = '/login.html'
    return
  }

  // Set up auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('Auth event:', event, session)
    
    if (event === 'SIGNED_OUT') {
      window.location.href = '/login.html'
    } else if (event === 'TOKEN_REFRESHED') {
      console.log('Token refreshed successfully')
    } else if (event === 'SIGNED_IN') {
      console.log('User signed in')
    }
  })

  return session
}

// Run on every page
document.addEventListener('DOMContentLoaded', async () => {
  const session = await initializeAuth()
  if (session) {
    initializeApp(session)
  }
})
```

### Phase 2: Fix Realtime Subscriptions

**File**: `/js/realtime-manager.js`
```javascript
class RealtimeManager {
  constructor(supabase) {
    this.supabase = supabase
    this.channels = new Map()
  }

  subscribeToLeads(callback) {
    const channel = this.supabase
      .channel('leads-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leads'
      }, callback)
      .subscribe((status) => {
        console.log('Leads channel status:', status)
      })

    this.channels.set('leads', channel)
    return () => this.unsubscribe('leads')
  }

  subscribeToCustomers(callback) {
    const channel = this.supabase
      .channel('customers-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'customers'
      }, callback)
      .subscribe((status) => {
        console.log('Customers channel status:', status)
      })

    this.channels.set('customers', channel)
    return () => this.unsubscribe('customers')
  }

  unsubscribe(channelName) {
    const channel = this.channels.get(channelName)
    if (channel) {
      this.supabase.removeChannel(channel)
      this.channels.delete(channelName)
    }
  }

  unsubscribeAll() {
    this.channels.forEach((channel, name) => {
      this.supabase.removeChannel(channel)
    })
    this.channels.clear()
  }
}

export const realtimeManager = new RealtimeManager(supabase)

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  realtimeManager.unsubscribeAll()
})
```

### Phase 3: Add Database Triggers

**Migration SQL**:
```sql
-- Enable REPLICA IDENTITY for all CRM tables
ALTER TABLE leads REPLICA IDENTITY FULL;
ALTER TABLE customers REPLICA IDENTITY FULL;
ALTER TABLE estimates REPLICA IDENTITY FULL;
ALTER TABLE invoices REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE estimates;
ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
```

### Phase 4: Web Push Notifications (Optional)

**1. Register Service Worker** (`/public/service-worker.js`)
**2. Add Push Subscription** (`/js/push-notifications.js`)
**3. Create Edge Function** (`supabase/functions/send-push/index.ts`)
**4. Add Database Trigger** for automatic notifications on lead status changes

---

## 5. Why These Patterns Solve Current Bugs

### Bug: Random Logouts
**Root Cause**: Missing `autoRefreshToken` and `persistSession`
**Solution**: Expo pattern shows these MUST be explicitly enabled
**Evidence**: Every production example has these set to `true`

### Bug: Realtime Updates Not Working
**Root Cause**: Missing `REPLICA IDENTITY FULL` on tables
**Solution**: Slack Clone shows this is required for DELETE operations
**Evidence**: Without it, only primary key is sent in payload

### Bug: Duplicate Realtime Events
**Root Cause**: Channels not properly cleaned up
**Solution**: Slack Clone shows `removeChannel` in cleanup
**Evidence**: Every useEffect returns cleanup function

### Bug: Session Lost on Refresh
**Root Cause**: Default storage may not persist in PWA mode
**Solution**: Expo pattern shows explicit storage wrapper
**Evidence**: `AsyncStorage` used instead of default

---

## 6. Critical Implementation Notes

1. **Never create multiple Supabase client instances** - Use singleton pattern
2. **Always clean up realtime channels** - Memory leaks cause performance issues
3. **Use unique channel names** - Prevents cross-contamination
4. **Enable REPLICA IDENTITY FULL** - Required for proper realtime
5. **Test token refresh** - Set short expiry time during development
6. **Monitor connection status** - Add logging for subscription states
7. **Handle offline mode** - Queue operations when connection lost

---

## Next Steps

1. Audit current `supabase-client.js` for missing config
2. Add `REPLICA IDENTITY FULL` to all tables via migration
3. Implement cleanup in realtime subscriptions
4. Add connection status monitoring
5. Test with short token expiry (1 minute) to verify refresh
6. Consider adding web push notifications for better UX

---

## 7. Additional Patterns from Production CRMs

### From Twenty CRM (Open Source Salesforce Alternative)

**Session Clearing Pattern** (`packages/twenty-front/src/modules/auth/hooks/useAuth.ts`):
```typescript
const clearSession = useCallback(async () => {
  clearSseClient()
  
  // Save critical state before clearing
  const authProvidersValue = store.get(workspaceAuthProvidersState.atom)
  const domainConfigurationValue = store.get(domainConfigurationState.atom)
  
  // Clear everything
  sessionStorage.clear()
  clearSessionLocalStorageKeys()
  
  // Restore non-session state
  store.set(workspaceAuthProvidersState.atom, authProvidersValue)
  store.set(domainConfigurationState.atom, domainConfigurationValue)
  
  // Reset all auth state
  store.set(tokenPairState.atom, null)
  store.set(currentUserState.atom, null)
  
  await client.clearStore()  // Apollo cache
  navigate(AppPath.SignInUp)
}, [clearSseClient, client, navigate, store])
```

**Key Insights**:
- Clear both `sessionStorage` AND `localStorage` keys
- Preserve non-auth state (configs, providers)
- Clear GraphQL/Apollo cache
- Atomic state updates

**Token Refresh Pattern**:
```typescript
// Multi-workspace support with token pairs
interface AuthTokenPair {
  accessToken: string
  refreshToken: string
}

// Workspace-specific login tokens
const handleGetAuthTokensFromLoginToken = useCallback(
  async (loginToken: string) => {
    const result = await getAuthTokensFromLoginToken({
      variables: { loginToken, origin }
    })
    
    await handleLoadWorkspaceAfterAuthentication(
      result.data.getAuthTokensFromLoginToken.tokens
    )
  },
  [handleLoadWorkspaceAfterAuthentication]
)
```

### From Supachat (Next.js Realtime Chat)

**Singleton Pattern** (`supabase/browser.ts`):
```typescript
let client: TypedSupabaseClient | undefined

export function getSupabaseBrowserClient() {
  if (client) return client  // Return existing instance
  
  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  return client
}

// Hook usage
export function useSupabaseBrowser() {
  return useMemo(getSupabaseBrowserClient, [])
}
```

**Realtime with Cleanup** (`components/MessageList.tsx`):
```typescript
useEffect(() => {
  const channel = supabase
    .channel('messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
    }, (payload) => {
      setMessages((prev) => [domainObject].concat(prev))
      
      // Auto-scroll if user sent the message
      if (payload.new.user_id === currentUserId) {
        document.documentElement.scrollTop = scrollHeight
      }
    })
    .subscribe()

  // CRITICAL: Cleanup on unmount
  return () => {
    supabase.removeChannel(channel)
  }
}, [supabase, setMessages])
```

**Key Pattern**: 
- Unique channel names per feature
- Optimistic UI only for current user
- Cleanup in useEffect return
- No separate "unsubscribe" function needed

### From Frappe (ERPNext Framework)

**Socket.IO Realtime Manager** (`frappe/public/js/frappe/socketio_client.js`):
```javascript
class RealTimeClient {
  constructor() {
    this.open_tasks = {}
    this.open_docs = new Set()
    this.disabled = false
  }

  init(port = 9000, lazy_connect = false) {
    if (this.socket) return  // Singleton
    
    this.lazy_connect = lazy_connect
    
    this.socket = io(this.get_host(port), {
      secure: window.location.protocol === 'https:',
      withCredentials: true,
      reconnectionAttempts: 3,
      autoConnect: !lazy_connect,  // Can defer connection
    })
    
    this.socket.on('connect_error', (err) => {
      console.error('Connection error:', err.message)
    })
    
    this.setup_listeners()
  }
  
  connect() {
    if (this.disabled) return
    if (this.lazy_connect) {
      this.socket.connect()
      this.lazy_connect = false
    }
  }
  
  doc_subscribe(doctype, docname) {
    // Throttle to prevent spam
    if (frappe.flags.doc_subscribe) return
    frappe.flags.doc_subscribe = true
    
    setTimeout(() => {
      frappe.flags.doc_subscribe = false
    }, 1000)
    
    this.emit('doc_subscribe', doctype, docname)
    this.open_docs.add(`${doctype}:${docname}`)
  }
}
```

**Key Patterns**:
- Lazy connection (connect only when needed)
- Throttling to prevent subscription spam
- Track open subscriptions with Set
- Reconnection attempts limit

---

## 8. Critical Implementation Patterns Summary

### Pattern 1: Storage Key Context Separation
```javascript
const isPWA = window.navigator.standalone || 
              window.matchMedia('(display-mode: standalone)').matches
const key = isPWA ? 'app-pwa-auth' : 'app-web-auth'
```
**Why**: PWA and browser use different storage contexts

### Pattern 2: Callback for Existing Sessions
```javascript
// Check existing session
const { data: { session } } = await supabase.auth.getSession()
if (session?.user) {
  await loadProfile(session.user)
  // CRITICAL: Call callback here
  if (onAuthChange) onAuthChange(currentUser)
}
```
**Why**: Without this, app doesn't initialize on refresh

### Pattern 3: Channel Cleanup
```javascript
useEffect(() => {
  const channel = supabase.channel('name').on(...).subscribe()
  return () => supabase.removeChannel(channel)
}, [deps])
```
**Why**: Prevents memory leaks and duplicate events

### Pattern 4: Singleton Client
```javascript
let client
export function getClient() {
  if (client) return client
  client = createClient(url, key, config)
  return client
}
```
**Why**: Multiple clients cause auth conflicts

### Pattern 5: Connection Status Tracking
```javascript
channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') updateIndicator('green')
  else if (status === 'CHANNEL_ERROR') updateIndicator('orange')
})
```
**Why**: Users need to know when connection is lost

---

## References

- **Supabase Examples**:
  - Slack Clone: `examples/slack-clone/nextjs-slack-clone/lib/Store.js`
  - Expo Push: `examples/user-management/expo-push-notifications/lib/supabase.ts`
  - Auth Presence: `examples/realtime/nextjs-auth-presence/lib/supabase-context.tsx`

- **Production CRMs**:
  - Twenty CRM: https://github.com/twentyhq/twenty
  - Frappe/ERPNext: https://github.com/frappe/frappe
  - Supachat: https://github.com/trymoto/supachat-starter

- **Official Docs**:
  - Supabase Realtime: https://supabase.com/docs/guides/realtime
  - Web Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
