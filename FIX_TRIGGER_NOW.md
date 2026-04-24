# FIX PUSH NOTIFICATIONS - RUN THIS NOW

## The Problem
Database trigger `on_job_added` is NOT firing when jobs are inserted into production database.

**Evidence:**
- Created test job: `DIAGNOSTIC_1777012890287`
- Edge function logs: **ZERO invocations** 
- Trigger should call edge function but doesn't

## Fix Steps

### 1. Open Supabase Dashboard
Go to: https://supabase.com/dashboard

**Find your production project** (the one at `api.onpointprodoors.com`)

### 2. Open SQL Editor
Click: **SQL Editor** in left sidebar

### 3. Run Diagnostic SQL
Copy/paste ALL of this SQL and click **RUN**:

```sql
-- Check if pg_net extension exists
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
    THEN '✅ pg_net IS installed'
    ELSE '❌ pg_net NOT installed - TRIGGERS CANNOT WORK'
  END AS status;

-- Check if trigger exists
SELECT
  t.tgname AS trigger_name,
  CASE t.tgenabled
    WHEN 'O' THEN '✅ ENABLED'
    WHEN 'D' THEN '❌ DISABLED'
    ELSE 'UNKNOWN'
  END AS status
FROM pg_trigger t
WHERE t.tgrelid = 'jobs'::regclass
  AND t.tgname = 'on_job_added';
```

### 4. Read the Results

**If you see: "❌ pg_net NOT installed"**
→ Run this SQL:
```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
```

**If you see: "❌ DISABLED" or no trigger found**
→ Copy the ENTIRE contents of this file:
`C:\Users\97252\ON-POINT-CRM\supabase\migrations\037_add_closed_by_and_fix_notification_exclusion.sql`

→ Paste it into SQL Editor
→ Click RUN

### 5. Test the Trigger
After applying the fix, run this SQL:

```sql
-- Insert a test job to trigger notification
INSERT INTO jobs (
  job_id,
  customer_name,
  created_by,
  status,
  created_at,
  updated_at
) VALUES (
  'TEST_TRIGGER_' || floor(random() * 10000)::text,
  'Trigger Test',
  '8b2d9042-501e-408d-b260-64e0b08a555f',
  'new',
  NOW(),
  NOW()
);
```

### 6. Check Edge Function Logs
After running the test INSERT:

1. Go to **Edge Functions** in Supabase Dashboard
2. Click on `send-push` function
3. Click **Logs** tab
4. Look for invocation within last 10 seconds

**If you see logs:** ✅ Trigger is working!
**If NO logs:** Trigger still broken - send me the diagnostic SQL results

### 7. Test on iPhone
Once trigger is working:
- PC creates a real job
- iPhone should receive notification within 2 seconds
- Check Settings → "Push Event History (Durable)" for PUSH_RECEIVED event

## What This Fixes

The trigger `on_job_added` should automatically call the edge function `/functions/v1/send-push` whenever a job is inserted. This edge function then:
1. Selects all admin/dispatcher users
2. Excludes the creator
3. Sends push notification to their devices

Right now the trigger is either:
- Missing (not applied to production)
- Disabled  
- Failing silently due to missing pg_net extension

Run the diagnostic SQL above to find out which one.
