# Push Subscription Test Plan

## ⚠️ CRITICAL: Test with MULTIPLE devices/browsers

This test requires at least 2 separate devices or browsers.

---

## STEP 1: Clear everything

```sql
-- Run in Supabase SQL Editor:
DELETE FROM push_subscriptions;
```

Verify: `SELECT COUNT(*) FROM push_subscriptions;` should return `0`

---

## STEP 2: Test Device A (Computer - Chrome/Edge)

1. Open https://crm.onpointprodoors.com in Chrome
2. Open DevTools (F12) → Console tab
3. Login as admin
4. **EXPECTED:**
   - Within 1 second, a modal appears with "🔔 Job Notifications Required"
   - Cannot dismiss the modal without clicking "Enable Notifications"
5. Click "Enable Notifications"
6. **EXPECTED:**
   - Browser shows permission dialog
7. Click "Allow"
8. **EXPECTED:**
   - Modal disappears
   - Console shows:
     ```
     [Push Enforcer] ✅ New subscription created and saved
     ```
9. Check database:
   ```sql
   SELECT user_id, endpoint, created_at FROM push_subscriptions;
   ```
   **EXPECTED:** 1 row with endpoint starting with `https://fcm.googleapis.com/...`

---

## STEP 3: Test Device B (iPhone Safari - if available, or different browser)

1. Open https://crm.onpointprodoors.com in Safari on iPhone (or Firefox on computer)
2. Login as dispatcher (or any other user)
3. **EXPECTED:**
   - Modal appears immediately
4. Click "Enable Notifications"
5. Click "Allow" in browser permission dialog
6. **EXPECTED:**
   - Modal disappears
   - Console shows subscription saved
7. Check database:
   ```sql
   SELECT COUNT(*) FROM push_subscriptions;
   ```
   **EXPECTED:** 2 rows (one per device)

---

## STEP 4: Test push notification delivery

1. On Device A (admin): Create a new job
2. **EXPECTED on Device B:**
   - Push notification popup appears within 5 seconds
   - Title: "New Job Added"
   - Body: "Job #XXXXX - [source] - [customer]"
   - Sound plays (tritone/chime/ping/bell)

3. **EXPECTED on Device A (creator):**
   - NO notification
   - NO sound
   - Job appears in UI immediately

4. On Device A (admin): Close a job (change status to Closed)
5. **EXPECTED on Device B:**
   - Push notification popup
   - Title: "Job Closed"
   - Sound plays

6. **EXPECTED on Device A (closer):**
   - NO notification
   - NO sound

---

## STEP 5: Test permission denied flow

1. Open in Incognito/Private window
2. Login
3. Modal appears
4. Click "Enable Notifications"
5. In browser permission dialog, click "Block" or "Don't Allow"
6. **EXPECTED:**
   - Red banner appears at top of screen
   - Banner says: "⚠️ Notifications Blocked" with instructions
   - Banner persists across page navigations
   - On iPhone, shows iPhone-specific instructions

---

## STEP 6: Test re-subscription on page reload (iOS killer test)

1. On Device B (iPhone if possible):
2. Close the browser tab completely
3. Wait 30 seconds
4. Reopen https://crm.onpointprodoors.com
5. Login again
6. **EXPECTED:**
   - NO modal (permission already granted)
   - Console shows:
     ```
     [Push Enforcer] Existing subscription found
     [Push Enforcer] ✅ Subscription verified and saved
     ```
7. Create job on Device A
8. **EXPECTED:**
   - Device B still receives push notification

---

## STEP 7: Test visibility change enforcement

1. On Device B:
2. Switch to another tab for 1 minute
3. Switch back to the CRM tab
4. **EXPECTED:**
   - Console shows:
     ```
     [Push Enforcer] Page visible, re-enforcing...
     [Push Enforcer] Existing subscription found
     ```
5. Create job on Device A
6. **EXPECTED:**
   - Device B receives push notification

---

## STEP 8: Test multiple subscriptions per user

1. Login as admin on Device A (Chrome)
2. Login as admin on Device B (Firefox on same computer)
3. Check database:
   ```sql
   SELECT user_id, endpoint FROM push_subscriptions
   WHERE user_id = (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1);
   ```
   **EXPECTED:** 2 rows with DIFFERENT endpoints (one per browser)
4. Create job on Device C (or as different user)
5. **EXPECTED:**
   - Both Device A and Device B receive push notifications

---

## ✅ PASS CONDITIONS

- ✅ Every device shows permission modal on first login
- ✅ Cannot dismiss modal without choosing
- ✅ Denied permission shows persistent red banner
- ✅ Each device creates 1 subscription row in database
- ✅ NO duplicate subscriptions (unique constraint works)
- ✅ Job created → all OTHER devices get push popup
- ✅ Job creator gets NO notification
- ✅ Page reload/focus re-verifies subscription (iOS safety)
- ✅ Multiple browsers for same user = multiple subscriptions
- ✅ Console clean, no errors

---

## ❌ FAIL CONDITIONS (requires fix)

- Modal doesn't appear → Check console for errors
- Can dismiss modal without choosing → Fix modal z-index/blocking
- Denied banner doesn't show → Check showDeniedBanner() logic
- Duplicate subscriptions for same device → Check unique constraint
- Push doesn't arrive → Check:
  1. Database triggers attached (run 038_diagnose_and_fix_triggers.sql)
  2. send-push Edge Function deployed
  3. Browser console for subscription errors
  4. Network tab for failed API calls
- Creator receives own notification → Check excludedUserId logic in triggers

---

## 🔍 DEBUGGING

If push doesn't arrive:

1. **Check subscription exists:**
   ```sql
   SELECT * FROM push_subscriptions;
   ```

2. **Check triggers attached:**
   ```sql
   SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'jobs';
   ```
   Should show: `on_job_added`, `on_job_closed`

3. **Test send-push directly:**
   ```javascript
   // In browser console:
   const sub = await navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription());
   console.log('Subscription:', sub.toJSON());
   ```

4. **Check app_config:**
   ```sql
   SELECT * FROM app_config WHERE key IN ('supabase_url', 'service_role_key');
   ```
   Should have both rows with non-empty values.

5. **Check browser console:**
   Look for errors mentioning "Push Enforcer", "subscription", "VAPID"
