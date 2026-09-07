# Manual Actions Required

## ⚡ QUICK FIX - Run This ONE Script

**THE BUG:** Push notification triggers exist but aren't attached to the jobs table.

**THE FIX:** Run the diagnostic + fix script in Supabase SQL Editor.

### Steps (2 minutes):

1. Go to https://supabase.com/dashboard
2. Open your project
3. Click "SQL Editor" in left sidebar
4. Click "New Query"
5. Copy the entire contents of **`supabase/migrations/038_diagnose_and_fix_triggers.sql`**
6. Paste into SQL Editor
7. Click "Run" (or press Ctrl+Enter)
8. Check the output messages:
   - Should show "App config rows: 2"
   - Should show "Supabase URL configured: true"
   - Should show "Service role key configured: true"
   - Should show triggers on_job_added and on_job_closed attached
9. Done!

### What This Script Does:
1. ✅ Checks if app_config has required values
2. ✅ Verifies trigger functions exist
3. ✅ Ensures triggers are attached to jobs table
4. ✅ Adds closed_by column if missing
5. ✅ Configures everything automatically

**After running this script, creating a job will trigger push notifications to all other users.**

---

## Edge Function Deployment Needed

**File:** `supabase/functions/send-push/index.ts`

The send-push Edge Function has been updated to support excluding users from broadcasts.

### How to deploy:

**Option 1: Supabase CLI**
```bash
supabase functions deploy send-push
```

**Option 2: Supabase Dashboard**
1. Go to https://supabase.com/dashboard
2. Navigate to Edge Functions
3. Find `send-push` function
4. Click "Deploy" or upload the updated `supabase/functions/send-push/index.ts`

---

## Status

- ✅ Frontend code deployed to https://crm.onpointprodoors.com
- ✅ PM2 online and serving latest code
- ❌ Database migration NOT YET APPLIED
- ❌ Edge Function NOT YET REDEPLOYED

Until the migration and Edge Function are deployed, the notification exclusion logic will NOT work (everyone will still get notifications for their own actions).

---

## Testing After Deployment

Once both are deployed, test:

1. **User A creates a job**
   - User A should get: NOTHING (no sound, no notification)
   - User B should get: Push notification popup + sound

2. **User A closes a job**
   - User A should get: NOTHING (no sound, no notification)
   - User B should get: Push notification popup + sound

3. **Ringtone picker**
   - Open Settings
   - Click each ringtone preview
   - Should hear real MP3 sounds (tritone, chime, ping, bell)
   - Each sound should be 2-3 seconds long

4. **Console**
   - Should be clean with no errors
