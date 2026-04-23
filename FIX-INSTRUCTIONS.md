# EXACT ROOT CAUSE & FIX

## Root Cause Found

Your iPhone created a push subscription with user_id `8b2d9042-501e-408d-b260-64e0b08a555f` which:
- ❌ Does NOT exist in `auth.users` table
- ❌ Does NOT exist in `profiles` table  
- ❌ Has NO role assigned

**Why manual test worked but real job didn't:**

| Path | User ID Lookup | Result |
|------|----------------|--------|
| **Manual test push** | `targetUserId: '8b2d9042...'` directly | Found subscription → sent push ✅ |
| **Real job push** | Filters by `role IN ('admin', 'dispatcher')` in profiles table | User `8b2d9042...` not in profiles → not selected → NO PUSH ❌ |

The manual test bypassed the role filter by using your exact user_id. But real job creation filters by role in the profiles table first, and your orphaned user_id doesn't exist there.

## What I've Done

✅ Deleted the orphaned subscription from database  
✅ Identified the exact code difference between working and failing paths  
✅ Confirmed all 3 valid users in database: gere (tech), mami (dispatcher), solomon (admin)

## What You Need To Do

### Step 1: Fix iPhone Session

Your iPhone session has a stale/corrupted user ID. Fix it:

1. **On iPhone PWA:**
   - Open the app
   - Tap the menu → **Log Out**
   - Close the app completely (swipe up from app switcher)

2. **Log back in:**
   - Open iPhone PWA
   - Enter your magic link email (which user are you: solomon, mami, or gere?)
   - Check email on iPhone and tap the magic link
   - App should reload with fresh session

3. **Verify correct user ID:**
   - Open debug panel (bottom of screen)
   - Look for logs showing your user info
   - OR check browser console if accessible
   - Confirm user_id matches one of:
     - `a306db51-20e0-40c5-9258-1634d4c9079b` (solomon - admin)
     - `83cd5cbb-b983-449a-af54-a69cf516db55` (mami - dispatcher)
     - `a4418815-3887-40b6-9bbe-a1365d9a4312` (gere - tech)

### Step 2: Recreate Push Subscription

1. **With fresh session, enable notifications:**
   - Tap "Enable Notifications" button
   - Grant permission when iOS prompts
   - Wait for success message in debug panel

2. **This will create NEW subscription with CORRECT user_id**

### Step 3: Verify Fix

1. **I'll check database:**
   ```sql
   SELECT ps.user_id, p.name, p.role 
   FROM push_subscriptions ps
   JOIN profiles p ON ps.user_id = p.id;
   ```
   - Should show YOUR name and role
   - Role should be 'admin' or 'dispatcher' (NOT 'tech' - gere won't get job notifications)

2. **Test end-to-end:**
   - Create a job from PC
   - iPhone should receive:
     - ✅ Foreground toast notification (if app open)
     - ✅ Background system push (if app closed/locked)

## Why This Happened

Your iPhone session got corrupted with a user_id (`8b2d9042...`) that doesn't match your actual Supabase auth user. This likely happened from:
- Previous testing with a different Supabase project
- Stale localStorage data from earlier development
- Session created before profile migration was applied

Logging out and back in will get a fresh session from Supabase with your REAL user_id that matches the profiles table.

## Question

**Which user should you be logged in as on iPhone?**
- solomon (admin) - service@onpointprodoors.com
- mami (dispatcher) - mami@gmail.com  
- gere (tech) - g@gmail.com

If you're supposed to be solomon or mami, you'll get job notifications after this fix.  
If you're gere (tech role), you won't get job notifications (only admins/dispatchers do).
