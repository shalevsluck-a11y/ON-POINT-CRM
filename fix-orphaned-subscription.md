# Fix Orphaned Push Subscription

## Problem
Push subscription exists with user_id `8b2d9042-501e-408d-b260-64e0b08a555f` which:
- Does NOT exist in `auth.users` table
- Does NOT exist in `profiles` table
- Cannot receive job notifications (broadcast to roles filters by profiles table)

## Solution
Delete the orphaned subscription. When the iPhone user next opens the app, it will auto-create a new subscription with their REAL user_id from the current session.

## SQL Commands

```sql
-- 1. Delete the orphaned subscription
DELETE FROM push_subscriptions 
WHERE user_id = '8b2d9042-501e-408d-b260-64e0b08a555f';

-- 2. Verify deletion
SELECT COUNT(*) FROM push_subscriptions;
-- Should return 0

-- 3. Verify which user is actually logged in on iPhone
-- (This needs to be checked from the iPhone app itself)
-- Open iPhone app → Open browser console → Run:
--   console.log('User:', Auth.getUser());
-- This will show the REAL user_id that should be used
```

## Next Steps

1. **Run SQL to delete orphaned subscription**
2. **On iPhone:** 
   - Open the PWA app
   - Open Safari Dev Tools (if available) or check the debug panel
   - Look for the user ID in the console logs
3. **On iPhone:**
   - Click "Enable Notifications" button
   - This will create a NEW subscription with the CORRECT user_id
4. **Verify:**
   - Check `push_subscriptions` table - should have valid user_id
   - Check that user_id exists in `profiles` table with admin/dispatcher role
5. **Test:**
   - Create a job from PC
   - iPhone should receive push notification

## Alternative: Create Missing Profile

If the user_id `8b2d9042...` is actually valid (e.g., from a different Supabase project), create a profile for it:

```sql
INSERT INTO profiles (id, name, role)
VALUES ('8b2d9042-501e-408d-b260-64e0b08a555f', 'iPhone User', 'admin');
```

BUT this is NOT recommended because:
- The user_id doesn't exist in auth.users
- It won't have a valid authentication session
- It's likely a stale/corrupted ID from a previous test

**Recommended: Delete and recreate with correct user_id.**
