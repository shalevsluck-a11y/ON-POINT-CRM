# Push Notification Debug Status

## ✅ VERIFIED WORKING

### Database
- push_subscriptions table exists ✅
- Schema correct: id, user_id, endpoint, p256dh, auth_key, created_at ✅
- RLS policies allow users to insert their own subscriptions ✅
- Unique constraint on (user_id, endpoint) ✅
- Foreign key to auth.users(id) with CASCADE delete ✅
- Manual INSERT test successful ✅

### Code
- push-subscription-enforcer.js uses correct field name: `auth_key: keys.auth` ✅
- auth.js also uses correct field name: `auth_key: keys.auth` ✅
- Service worker registered in index.html ✅
- PushSubscriptionEnforcer.init() called after login in app.js ✅
- VAPID public key: BNThACyKMai6hck9NCqpLf_Qdyx_qhpcqGCeOI-_qr1ZS-FyfSx1woTtR9ERYjXBtn8bT5u3am_dBvSADIy_oLc ✅

### Triggers & Edge Functions
- Migration 037 applied ✅
- closed_by column exists ✅
- on_job_added trigger → notify_job_added function ✅
- on_job_closed trigger → notify_job_closed function ✅
- Both functions exclude the user who performed the action ✅
- Edge Function send-push deployed ✅

### Frontend Fixes
- FIX 1: Realtime listener skips sound for creator (db.js line 289) ✅
- FIX 2: Push enforcer logs user name/role ✅

### Deployment
- Latest code deployed to VPS ✅
- PM2 status: online ✅
- URL: https://crm.onpointprodoors.com ✅

---

## ❓ UNKNOWN / NEEDS TESTING

### Current Database State
```sql
SELECT COUNT(*) FROM push_subscriptions;
-- Result: 0 rows
```

**WHY 0 ROWS?**
- Either: Users haven't opened the app since latest deployment
- Or: Subscription is failing silently despite correct code
- Or: Browser permission is denied
- Or: Service worker not activating
- Or: PushSubscriptionEnforcer.init() not being called

### What Needs Testing

**TEST 1: Open app and check console**
1. Open https://crm.onpointprodoors.com
2. Login as solomon or mami
3. Open DevTools Console (F12)
4. Look for these messages:

**Expected console output:**
```
[Push Enforcer] Initializing...
[Push Enforcer] Current user: [object Object]
[Push Enforcer] Push supported: true
[Push Enforcer] Notification permission: default|granted|denied
[Push Enforcer] ========== STARTING ENFORCEMENT ==========
[Push Enforcer] Running for: Solomon role: admin id: a306db51-...
[Push Enforcer] Current permission: default
[Push Enforcer] Permission DEFAULT - showing modal
```

**If permission = default:**
- Modal should appear (full-screen overlay)
- Click "Enable Notifications"
- Browser should show permission prompt
- After granting:
  ```
  [Push Enforcer] Permission GRANTED! Creating subscription...
  [Push Enforcer] Ensuring subscription exists...
  [Push Enforcer] Subscription created, saving to database...
  [Push Enforcer] Saving subscription for user: a306db51-...
  [Push Enforcer] Data to upsert: { user_id: "...", endpoint: "...", p256dh: "...", auth_key: "..." }
  [Push Enforcer] Upsert completed
  [Push Enforcer] ✅ Subscription saved to database successfully
  ```

**If permission = granted:**
```
[Push Enforcer] Permission GRANTED - ensuring subscription...
[Push Enforcer] Existing subscription found
[Push Enforcer] ✅ Subscription saved to database successfully
```

**If permission = denied:**
```
[Push Enforcer] Permission DENIED - showing banner
```
→ Red banner at top with instructions

**If you see ERROR messages:**
- Copy the full error
- Check the error code, message, details, hint
- Report it for fixing

---

## TEST 2: Verify database has rows

After console shows "✅ Subscription saved", check:

```sql
SELECT 
  p.name,
  p.role,
  ps.created_at
FROM push_subscriptions ps
JOIN profiles p ON p.id = ps.user_id
ORDER BY ps.created_at DESC;
```

**Expected:** At least 1 row with your username

**If 0 rows despite success message:**
- RLS policy might be blocking the insert
- Or the upsert is failing silently
- Check console for hidden errors

---

## TEST 3: Test push notifications end-to-end

**Requirements:**
- 2 users subscribed (solomon + mami)
- Both rows in push_subscriptions table

**Steps:**
1. Open app on Device A as mami (dispatcher)
2. Open app on Device B as solomon (admin)
3. On Device A: Create a new job
4. On Device B: Should get push notification popup

**Expected on Device B:**
- Push notification appears (even if app closed/background)
- Title: "New Job Added"
- Body: "Job #12345 - [customer name]"
- Sound plays (tritone/chime/ping/bell)

**Expected on Device A (creator):**
- NO sound plays
- Console shows: `[Realtime] Skipping notification - I created this job`
- Job appears in UI via Realtime

**If no push notification:**
- Check Edge Function logs in Supabase Dashboard
- Edge Functions → send-push → Logs
- Should show: "Sending push to 1 subscriptions" (excludes creator)
- Check for errors in logs

---

## TROUBLESHOOTING

### Problem: Modal never appears

**Check:**
1. Console shows `[Push Enforcer] Initializing...`?
   - NO → script not loaded or init() not called
   - YES → continue

2. Console shows `Permission DEFAULT - showing modal`?
   - NO → permission already granted or denied
   - Run in console: `console.log(Notification.permission)`

3. Check browser notification settings:
   - Chrome: chrome://settings/content/notifications
   - Firefox: about:preferences#privacy
   - Check if site is blocked

### Problem: Permission granted but 0 rows in DB

**Check console for:**
```
[Push Enforcer] FAILED to save subscription
Error: ...
```

**Common errors:**
- `new row violates row-level security policy` → RLS blocking insert
- `duplicate key value violates unique constraint` → trying to insert duplicate
- `null value in column "auth_key"` → keys.auth is undefined

### Problem: Push notification doesn't arrive

**Check:**
1. Edge Function logs (Supabase Dashboard)
2. Service worker console (DevTools → Application → Service Workers)
3. Check if sw.js is loaded and active
4. Check if `push` event handler exists in sw.js

---

## CURRENT ENHANCED LOGGING

The latest deployed version has extensive logging around the upsert:

- Logs full data object as JSON
- Logs field types
- Logs error with all properties (message, code, details, hint)
- Logs result and row count

**To see logs:** Open DevTools Console and perform subscription flow

---

## NEXT STEPS

1. **Test on real device** - Open app, login, check console
2. **Report findings** - Copy console output and database query results
3. **If working** - Test end-to-end push flow
4. **If broken** - Share error messages for fix
