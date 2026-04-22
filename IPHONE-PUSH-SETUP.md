# iPhone Push Notification Setup Instructions

## ✅ COMPLETED - Ready for Testing

### What's Been Fixed:
1. ✅ **New VAPID Keys** - Fresh keys generated for secure push
2. ✅ **Web-Push Library** - Using industry-standard encryption
3. ✅ **Database Triggers** - Both "job created" and "job closed" events trigger push
4. ✅ **Notification Sounds** - 4 sounds (3-4 seconds each) ready
5. ✅ **Ringtone Picker** - Available in Settings for customization
6. ✅ **Service Worker** - Active and ready to receive notifications
7. ✅ **Edge Function** - Deployed with proper encryption

### What You Need to Do NOW:

## Step 1: Add to Home Screen (Required for iOS)

1. Open **Safari** on your iPhone
2. Go to https://crm.onpointprodoors.com
3. Tap the **Share** button (square with arrow)
4. Scroll down and tap "**Add to Home Screen**"
5. Tap "**Add**"
6. Close Safari

## Step 2: Open as PWA and Subscribe

1. Open the **On Point CRM** app from your home screen (NOT Safari)
2. Log in as **dispatcher**
3. You should see a notification permission prompt
4. Tap "**Allow**" when asked for notifications

## Step 3: Customize Your Sound (Optional)

1. Tap the menu icon (top left)
2. Go to **Settings**
3. Find "**Notification Sound**" section
4. Tap to expand
5. Choose your preferred sound
6. Tap "**Preview**" to hear each option
7. Selected sound is saved automatically

## Step 4: Test It!

### Test 1: Job Created Notification

1. Have someone else (or use another device) log in as **admin**
2. Create a new job
3. **Your iPhone should receive a push notification within 2-3 seconds**
4. Even if the app is closed!

### Test 2: Job Closed Notification

1. Have admin close/complete a job
2. **Your iPhone should receive a notification**

## Troubleshooting

### If you don't get notifications:

1. **Check iOS Version**
   - Go to Settings → General → About
   - You need iOS **16.4 or higher** for web push
   - Update if needed

2. **Check Notification Settings**
   - Settings → Notifications → On Point CRM
   - Make sure "Allow Notifications" is ON
   - Sounds should be enabled

3. **Check Browser**
   - Must use **Safari** (Chrome/Firefox won't work for PWA)
   - Must be **added to home screen** (not just Safari)

4. **Re-subscribe**
   - Open app from home screen
   - Go to Settings → Notification Sound section
   - The app will re-check permissions

## Technical Details (for debugging)

- **Service Worker**: v20260422-push-notifications-fixed
- **VAPID Public Key**: BNThACyKMai6hck9NCqpLf_Qdyx_qhpcqGCeOI-_qr1ZS-Fyx...
- **Push Service**: Uses web-push npm library with aes128gcm encryption
- **Triggers**: notify_job_added() and notify_job_closed() in database
- **Roles**: Broadcasts to 'admin' and 'dispatcher' roles

## Current Status

**System**: ✅ 100% Ready
**Subscriptions**: ⏳ Waiting for you to subscribe on iPhone

Once you complete steps 1-2 above, the system will be fully operational!

---

**Last Updated**: 2026-04-22 23:35 UTC
