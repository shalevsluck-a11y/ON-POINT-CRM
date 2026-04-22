# VAPID Keys Setup for Push Notifications

**Status:** Edge Function deployed, secrets need to be added manually  
**Date:** 2026-04-22

## Generated VAPID Keys

```
Public Key:  BH0-zYhwG6C6thFpljmd7EZQH_Y_JehctoTEmMQPpXviMQEhp7TW_NyiPY24DdESCw4JFxpIC1AB2Ze6le6QZAI
Private Key: _8W-DmNXL6lf-5KUfLry2fcyd-vbrNbwHyEOwTF1Whc
Subject:     mailto:service@onpointprodoors.com
```

## Setup Instructions

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT_ID
2. Navigate to: **Edge Functions** → **send-push** → **Secrets**
3. Add three secrets:
   - Name: `VAPID_PUBLIC_KEY`, Value: `BH0-zYhwG6C6thFpljmd7EZQH_Y_JehctoTEmMQPpXviMQEhp7TW_NyiPY24DdESCw4JFxpIC1AB2Ze6le6QZAI`
   - Name: `VAPID_PRIVATE_KEY`, Value: `_8W-DmNXL6lf-5KUfLry2fcyd-vbrNbwHyEOwTF1Whc`
   - Name: `VAPID_SUBJECT`, Value: `mailto:service@onpointprodoors.com`

### Option 2: Via Supabase CLI

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Set secrets
supabase secrets set VAPID_PUBLIC_KEY=BH0-zYhwG6C6thFpljmd7EZQH_Y_JehctoTEmMQPpXviMQEhp7TW_NyiPY24DdESCw4JFxpIC1AB2Ze6le6QZAI
supabase secrets set VAPID_PRIVATE_KEY=_8W-DmNXL6lf-5KUfLry2fcyd-vbrNbwHyEOwTF1Whc
supabase secrets set VAPID_SUBJECT=mailto:service@onpointprodoors.com
```

## Edge Function Details

- **Name:** send-push
- **Version:** 2
- **Status:** ACTIVE
- **ID:** b5c75cd3-7e48-485b-bcfd-b9b75a585915
- **Deployed:** 2026-04-22

## Verification

After setting the secrets, test the push notification:

1. Log in as admin/dispatcher
2. Assign a job to a tech user
3. Check if the tech receives a push notification

## Database Trigger Configuration

The `notify_job_assigned()` trigger also needs these database settings configured:

```sql
-- Set Supabase URL (used by trigger to call Edge Function)
ALTER DATABASE postgres SET app.supabase_url = 'https://YOUR_PROJECT_REF.supabase.co';

-- Set Service Role Key (used by trigger for authenticated calls)
ALTER DATABASE postgres SET app.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

**Note:** Get your service role key from Supabase Dashboard → Project Settings → API → service_role (secret)

## Security Notes

- ⚠️ **NEVER commit VAPID private key to git**
- ⚠️ **Keep service role key secret**
- ✅ Public key can be safely embedded in client code
- ✅ These secrets are only accessible to the Edge Function
- ✅ Edge Function requires JWT authentication (admin/dispatcher only)

## What These Keys Do

- **Public Key:** Embedded in web app, used by browser to subscribe to push notifications
- **Private Key:** Used by server to sign push messages (proves they came from your server)
- **Subject:** Contact email for push service providers (required by spec)

## Next Steps

1. ✅ Edge Function deployed
2. ⏳ Set VAPID secrets (manual step above)
3. ⏳ Configure database trigger settings (SQL above)
4. ⏳ Update frontend to use public key for push subscription
5. ⏳ Test end-to-end push notification flow

## Frontend Integration

Add this to your JavaScript (after secrets are set):

```javascript
const VAPID_PUBLIC_KEY = 'BH0-zYhwG6C6thFpljmd7EZQH_Y_JehctoTEmMQPpXviMQEhp7TW_NyiPY24DdESCw4JFxpIC1AB2Ze6le6QZAI';

// In service worker registration
if ('serviceWorker' in navigator && 'PushManager' in window) {
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  
  // Save subscription to database
  await saveSubscription(subscription);
}
```

---

**Status:** Task 2 complete - Edge Function deployed. Manual step required: Add secrets via Supabase Dashboard.
