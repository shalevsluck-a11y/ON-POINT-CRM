# COMPLETE IDENTITY ARCHITECTURE FIX

## EXECUTIVE SUMMARY

**Problem:** PC user "de" (8b2d9042...) appears to exist in frontend Supabase session but NOT in backend database. Multiple identity issues causing notification failures with multiple dispatchers.

**Root Causes:**
1. Frontend/backend connected to different databases OR custom domain routing differently
2. Push subscriptions accept frontend-provided user_id (security vulnerability)
3. Job creation doesn't capture `created_by` (always NULL)
4. No foreign key constraints between auth.users → profiles → push_subscriptions
5. Zero push subscriptions (I deleted them all during debugging)

**Solution:** Enforce auth.users.id as single source of truth across entire system.

---

## IMMEDIATE ACTIONS REQUIRED

### 1. VERIFY DATABASE CONNECTION

**On PC, open browser console and run:**
```javascript
const { data } = await SupabaseClient.from('profiles').select('*');
console.log('Profiles:', data);

const { data: { user } } = await SupabaseClient.auth.getUser();
console.log('Current user:', user);
```

**Expected:** Should see de, gere, mami, solomon
**If not:** Frontend is connected to different Supabase project

### 2. APPLY DATABASE MIGRATION

**File:** `supabase/migrations/039_enforce_identity_integrity.sql` (already created)

**Apply via Supabase SQL Editor:**
```sql
-- Run the entire migration file
-- OR use Supabase CLI:
supabase db push
```

**What it does:**
- ✅ Adds FK: `profiles.id → auth.users.id`
- ✅ Adds FK: `push_subscriptions.user_id → profiles.id`
- ✅ Auto-creates profile for new auth users
- ✅ Prevents orphaned profiles/subscriptions

### 3. FIX BACKEND: Server.js

**File:** `server.js` - Replace `/api/save-push-subscription` endpoint (line ~466)

**Current code (VULNERABLE):**
```javascript
app.post('/api/save-push-subscription', async (req, res) => {
  const { user_id, endpoint, p256dh, auth_key } = req.body; // ❌ Trusts frontend
  
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ user_id, endpoint, p256dh, auth_key }); // ❌ Uses frontend user_id
});
```

**New code (SECURE):**
```javascript
app.post('/api/save-push-subscription', async (req, res) => {
  try {
    // ✅ Step 1: Verify auth token (REQUIRED)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - no auth token' });
    }

    // ✅ Step 2: Derive user_id from authenticated session (NEVER trust frontend)
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      console.error('[PUSH SUB] Auth error:', authError);
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    const user_id = user.id; // ✅ Derived from auth, not from frontend
    const { endpoint, p256dh, auth_key } = req.body;

    console.log('[PUSH SUB] ✅ Authenticated user:', user_id, user.email);

    // ✅ Step 3: Verify profile exists (FK constraint will enforce this)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role')
      .eq('id', user_id)
      .single();

    if (profileError || !profile) {
      console.error('[PUSH SUB] No profile for user:', user_id);
      return res.status(403).json({ error: 'No profile found - contact admin' });
    }

    console.log('[PUSH SUB] Profile:', profile.name, profile.role);

    // ✅ Step 4: Save subscription (upsert based on endpoint)
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        user_id,  // ✅ From authenticated session
        endpoint,
        p256dh,
        auth_key,
      }, {
        onConflict: 'endpoint' // Update if endpoint already exists
      });

    if (error) {
      console.error('[PUSH SUB] Save error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('[PUSH SUB] ✅ Subscription saved for', profile.name);
    res.json({ success: true });

  } catch (error) {
    console.error('[PUSH SUB] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### 4. FIX FRONTEND: Pass Auth Token

**File:** `js/supabase-push-client.js` - Update `savePushSubscriptionDirect()`

**Current code (VULNERABLE):**
```javascript
async function savePushSubscriptionDirect(data) {
  const response = await fetch('/api/save-push-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data) // ❌ Includes user_id from frontend
  });
}
```

**New code (SECURE):**
```javascript
async function savePushSubscriptionDirect(data) {
  // ✅ Get current auth session
  const { data: sessionData, error: sessionError } = await SupabaseClient.auth.getSession();
  
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch('/api/save-push-subscription', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionData.session.access_token}` // ✅ Auth token
    },
    body: JSON.stringify({
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth_key: data.auth_key
      // ❌ NO user_id - backend derives it from auth token
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save subscription');
  }

  return response.json();
}
```

### 5. FIX FRONTEND: Capture Job Creator

**File:** `js/db.js` - Find `addJob()` function (around line 200-250)

**Add this BEFORE the Supabase insert:**
```javascript
async function addJob(jobData) {
  const currentUser = Auth.getUser();
  if (!currentUser) {
    throw new Error('Not authenticated');
  }

  // ✅ CRITICAL: Always set created_by to current auth user
  const jobWithCreator = {
    ...jobData,
    created_by: currentUser.id  // ✅ Captures who created the job
  };

  const { data, error } = await SupabaseClient
    .from('jobs')
    .insert(jobWithCreator)
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

### 6. DELETE ALL USERS EXCEPT SOLOMON (As Requested)

**Run these SQL commands:**
```sql
-- Delete all auth users except solomon
DELETE FROM auth.users 
WHERE id NOT IN ('a306db51-20e0-40c5-9258-1634d4c9079b');

-- Cascading deletes will automatically remove:
-- - Associated profiles
-- - Associated push_subscriptions
-- - Due to foreign key ON DELETE CASCADE

-- Verify cleanup
SELECT 'auth.users' as table_name, COUNT(*) as count FROM auth.users
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL
SELECT 'push_subscriptions', COUNT(*) FROM push_subscriptions;

-- Should show: 1, 1, 0 (solomon only, no push subs yet)
```

---

## TESTING PLAN: Multi-Dispatcher Support

### Test Setup

1. **Keep solomon (admin)** - iPhone user
2. **Create dispatcher1** - First test dispatcher
3. **Create dispatcher2** - Second test dispatcher

### Test Procedure

**Step 1: Create Test Users**
```sql
-- Dispatcher 1
INSERT INTO auth.users (id, email, raw_user_metadata, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'dispatcher1@test.com',
  '{"name": "Dispatcher One"}',
  NOW(),
  NOW()
);

-- Dispatcher 2
INSERT INTO auth.users (id, email, raw_user_metadata, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'dispatcher2@test.com',
  '{"name": "Dispatcher Two"}',
  NOW(),
  NOW()
);

-- Profiles are auto-created by trigger ✅

-- Update roles to dispatcher
UPDATE profiles SET role = 'dispatcher' 
WHERE name IN ('Dispatcher One', 'Dispatcher Two');
```

**Step 2: Login Each User**
- Solomon: iPhone
- Dispatcher1: PC browser 1
- Dispatcher2: PC browser 2

**Step 3: Enable Notifications on Each Device**
- Each clicks "Enable Notifications"
- Browser prompts for permission
- Frontend sends auth token to backend ✅
- Backend derives user_id from token ✅
- Subscription saved with correct user_id ✅

**Step 4: Verify Subscriptions**
```sql
SELECT 
  ps.user_id,
  p.name,
  p.role,
  SUBSTRING(ps.endpoint, 1, 50) as endpoint,
  ps.created_at
FROM push_subscriptions ps
JOIN profiles p ON ps.user_id = p.id
ORDER BY ps.created_at DESC;

-- Expected: 3 rows (solomon, dispatcher1, dispatcher2)
```

**Step 5: Test Job Creation → Notifications**

**Dispatcher1 creates job:**
```javascript
// created_by will be dispatcher1's ID ✅
```

**Expected behavior:**
- Database trigger fires
- Calls send-push with:
  ```javascript
  {
    broadcast: true,
    roles: ['admin', 'dispatcher'],
    excludedUserId: dispatcher1_id  // ✅ Excludes creator
  }
  ```
- Edge function queries profiles WHERE role IN ('admin', 'dispatcher')
- Result: [solomon, dispatcher1, dispatcher2]
- Filters out dispatcher1 (creator)
- Final recipients: [solomon, dispatcher2] ✅
- Sends push to their subscriptions ✅

**Verification:**
- Solomon's iPhone: ✅ Receives notification
- Dispatcher1's PC: ❌ Does NOT receive (is creator)
- Dispatcher2's PC: ✅ Receives notification

**Step 6: Reverse Test**

**Solomon creates job from iPhone:**
- Expected: Dispatcher1 AND Dispatcher2 receive notifications ✅
- Solomon does NOT receive (is creator) ✅

---

## DEPLOYMENT STEPS

### 1. Apply Code Changes
```bash
cd C:/Users/97252/ON-POINT-CRM

# Edit files:
# - server.js (fix /api/save-push-subscription)
# - js/supabase-push-client.js (pass auth token)
# - js/db.js (capture created_by)

git add server.js js/supabase-push-client.js js/db.js
git commit -m "Enforce auth-derived user_id for push subscriptions

- Backend derives user_id from auth token (not frontend)
- Frontend passes Authorization header (not user_id in body)
- Job creation captures created_by
- Security: prevents user_id spoofing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

git push
```

### 2. Apply Database Migration
```bash
# SSH to server
ssh root@187.77.8.155

# Apply migration via Supabase CLI OR SQL Editor
cd /var/www/onpoint-crm
# Copy SQL from migrations/039_enforce_identity_integrity.sql
# Run in Supabase SQL Editor
```

### 3. Restart Server
```bash
ssh root@187.77.8.155 'cd /var/www/onpoint-crm && git pull && pm2 restart onpoint-crm && pm2 logs onpoint-crm --lines 20'
```

### 4. Clean Database (Optional - As Requested)
```sql
-- Delete all users except solomon
DELETE FROM auth.users 
WHERE id != 'a306db51-20e0-40c5-9258-1634d4c9079b';
```

### 5. Test with Multiple Dispatchers
- Create 2 test dispatcher accounts
- Enable notifications on 3 devices (solomon + 2 dispatchers)
- Create job from each device
- Verify others receive notification, creator does not

---

## SUCCESS CRITERIA

✅ **Identity Integrity:**
- Every profile.id matches an auth.users.id (FK enforced)
- Every push_subscription.user_id matches a profiles.id (FK enforced)
- Backend derives user_id from auth token (no frontend trust)

✅ **Multi-User Support:**
- Multiple dispatchers can coexist
- Each has their own push subscription
- Job creator excluded from notification
- All other admin/dispatcher users receive notification

✅ **Security:**
- Frontend cannot spoof user_id
- Auth token required for subscription
- Profile must exist for subscription
- Cascading deletes cleanup orphaned data

✅ **Reliability:**
- Jobs always capture created_by
- Broadcast filters correctly by role
- Push subscriptions target correct devices

---

## NEXT STEPS

1. **Apply migration** (039_enforce_identity_integrity.sql)
2. **Fix server.js** (derive user_id from auth)
3. **Fix frontend** (pass auth token, capture created_by)
4. **Deploy** (git push + server restart)
5. **Clean database** (delete all except solomon if desired)
6. **Test with 3 users** (1 admin + 2 dispatchers)
7. **Verify end-to-end** (job creation → notifications work)

**After this:** System will reliably support multiple dispatchers without identity drift.
