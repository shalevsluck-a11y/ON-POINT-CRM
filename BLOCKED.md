# Manual Actions Required

## Database Migration Needed

**File:** `supabase/migrations/037_add_closed_by_and_fix_notification_exclusion.sql`

This migration adds critical functionality to exclude the creator/closer from receiving their own notifications.

### What it does:
1. Adds `closed_by` column to `jobs` table
2. Creates trigger to auto-set `closed_by` when status changes to closed
3. Updates `notify_job_added()` to exclude the creator from push notifications
4. Updates `notify_job_closed()` to exclude the closer from push notifications

### How to apply:

**Option 1: Supabase Dashboard (Recommended)**
1. Go to https://supabase.com/dashboard
2. Open your project
3. Navigate to SQL Editor
4. Copy the entire contents of `supabase/migrations/037_add_closed_by_and_fix_notification_exclusion.sql`
5. Paste into SQL Editor
6. Click "Run"

**Option 2: Supabase CLI**
```bash
supabase db push
```

**Option 3: Direct PostgreSQL Connection**
If you have psql or can connect to the database:
```bash
psql "YOUR_DATABASE_CONNECTION_STRING" < supabase/migrations/037_add_closed_by_and_fix_notification_exclusion.sql
```

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
