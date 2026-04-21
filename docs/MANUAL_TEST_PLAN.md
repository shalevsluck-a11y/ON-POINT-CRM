# Manual Testing Plan

## Session Persistence Tests

### Test 1: Login and Refresh
**Objective:** Verify session persists after page refresh

**Steps:**
1. Open browser (Chrome/Firefox/Safari)
2. Navigate to https://crm.onpointprodoors.com
3. Login with credentials
4. Wait for dashboard to load
5. Press F5 or click refresh button
6. Wait for page to reload

**Expected Result:**
- Dashboard appears immediately without login screen
- No re-authentication required
- Page loads in < 3 seconds

**Pass/Fail:** ___________

---

### Test 2: Close Browser and Reopen
**Objective:** Verify session persists after browser restart

**Steps:**
1. Login to CRM
2. Wait for dashboard to appear
3. Close browser completely (not just tab)
4. Wait 10 seconds
5. Reopen browser
6. Navigate to https://crm.onpointprodoors.com

**Expected Result:**
- Dashboard appears without login prompt
- User data is still loaded
- No session timeout error

**Pass/Fail:** ___________

---

### Test 3: PWA vs Browser Storage
**Objective:** Verify separate storage contexts for PWA and browser

**Steps:**
1. Login in regular browser window
2. Note: Session is active
3. Install PWA (Add to Home Screen on mobile, or "Install" in desktop Chrome)
4. Open PWA
5. Check if login is required in PWA

**Expected Result:**
- PWA and browser maintain separate sessions
- Storage keys use different prefixes (onpoint-pwa-auth vs onpoint-web-auth)

**Pass/Fail:** ___________

---

### Test 4: Token Refresh
**Objective:** Verify session refreshes automatically before expiry

**Steps:**
1. Login to CRM
2. Open browser DevTools → Console
3. Monitor for "Session health check" or "Token refresh" messages
4. Wait 5 minutes (session health check runs every 4 minutes)
5. Perform an action (create job, navigate)

**Expected Result:**
- Console shows successful session health checks
- No logout or session expired errors
- Actions complete successfully

**Pass/Fail:** ___________

---

## Realtime Tests

### Test 5: Admin Assigns Job → Tech Sees Update
**Objective:** Verify realtime job assignment notification

**Prerequisites:**
- Admin account logged in on Computer A
- Tech account logged in on Computer B (or different browser)

**Steps:**
1. Admin: Navigate to Jobs section
2. Admin: Create a new job
3. Admin: Assign job to tech user
4. Tech: Watch job list (do NOT refresh)
5. Start timer when admin clicks "Assign"

**Expected Result:**
- Tech sees assigned job appear in list within 2 seconds
- Job has correct details (customer name, address, etc.)
- Visual/audio notification appears (if implemented)

**Time Measured:** __________ ms

**Pass/Fail:** ___________

---

### Test 6: Job Update Propagates
**Objective:** Verify job updates appear on all screens

**Prerequisites:**
- Two browser windows, both logged in as admin

**Steps:**
1. Window 1: Open specific job
2. Window 2: Open job list
3. Window 1: Update job status (e.g., "In Progress" → "Complete")
4. Window 1: Save changes
5. Window 2: Watch for update (do NOT refresh)

**Expected Result:**
- Window 2 shows updated status within 2 seconds
- No page refresh required
- All job details match

**Pass/Fail:** ___________

---

### Test 7: Connection Status Indicator
**Objective:** Verify realtime connection status is visible

**Steps:**
1. Login to CRM
2. Look for connection status indicator (likely in header/navbar)
3. Note indicator color/state
4. Disable network (airplane mode or DevTools → Network → Offline)
5. Wait 5 seconds
6. Note indicator change
7. Re-enable network
8. Wait 10 seconds

**Expected Result:**
- Indicator shows "Connected" (green) when online
- Indicator shows "Reconnecting" (orange) or "Disconnected" (red) when offline
- Indicator returns to "Connected" when network restored

**Pass/Fail:** ___________

---

### Test 8: Channel Cleanup on Logout
**Objective:** Verify realtime channels are properly closed

**Steps:**
1. Login to CRM
2. Open DevTools → Console
3. Look for "Realtime jobs channel status: SUBSCRIBED" or similar
4. Logout
5. Check console for channel cleanup messages

**Expected Result:**
- Console shows channel subscription on login
- Console shows channel removal/cleanup on logout
- No memory leaks or hanging connections

**Pass/Fail:** ___________

---

## Push Notification Tests

### Test 9: Permission Request Flow
**Objective:** Verify push notification permission is requested

**Steps:**
1. Open CRM in new browser profile (fresh permissions)
2. Login
3. Look for permission request prompt
4. Click "Allow" on permission prompt
5. Check browser settings → Site permissions → Notifications

**Expected Result:**
- Permission prompt appears after login or when needed
- Permission is saved correctly
- Notifications are enabled in browser settings

**Pass/Fail:** ___________

---

### Test 10: Notification Appears on Assignment
**Objective:** Verify push notification displays when job assigned

**Prerequisites:**
- Notifications enabled
- Tech account with push subscription

**Steps:**
1. Tech: Login and ensure notifications are enabled
2. Tech: Minimize or switch to different tab
3. Admin: Assign job to tech user
4. Tech: Watch for notification to appear

**Expected Result:**
- Notification appears within 3 seconds
- Notification shows job details (job #, customer name)
- Notification has CRM icon/badge

**Pass/Fail:** ___________

---

### Test 11: Notification Click Navigation
**Objective:** Verify clicking notification opens correct page

**Steps:**
1. Wait for notification from Test 10 (or trigger new one)
2. Click on the notification
3. Observe browser behavior

**Expected Result:**
- CRM tab opens or comes to foreground
- Page navigates to assigned job details
- Job ID in URL matches notification

**Pass/Fail:** ___________

---

### Test 12: Multiple Device Push
**Objective:** Verify push works on multiple devices

**Prerequisites:**
- Same tech account logged in on:
  - Desktop browser
  - Mobile browser
  - PWA (if installed)

**Steps:**
1. Login on all devices
2. Enable notifications on all devices
3. Admin: Assign job to tech
4. Observe all devices

**Expected Result:**
- Notification appears on all logged-in devices
- Each notification is independent (closing one doesn't close others)

**Pass/Fail:** ___________

---

## Mobile Device Tests

### Test 13: Mobile Session Persistence
**Objective:** Verify session works on mobile

**Steps:**
1. Open CRM on mobile browser (iPhone Safari or Android Chrome)
2. Login
3. Close tab
4. Open new tab and navigate to CRM

**Expected Result:**
- Dashboard appears without re-login
- Mobile UI is responsive and functional

**Pass/Fail:** ___________

---

### Test 14: Mobile Realtime Updates
**Objective:** Verify realtime works on mobile

**Steps:**
1. Admin: Login on desktop
2. Tech: Login on mobile device
3. Admin: Assign job to tech
4. Tech: Watch mobile screen

**Expected Result:**
- Mobile receives update within 2 seconds
- UI updates smoothly without glitches
- No need to manually refresh

**Pass/Fail:** ___________

---

### Test 15: Mobile Push Notifications
**Objective:** Verify push works on mobile

**Steps:**
1. Tech: Login on mobile device
2. Tech: Allow notifications when prompted
3. Tech: Lock device or switch to another app
4. Admin: Assign job to tech
5. Tech: Watch for notification on lock screen

**Expected Result:**
- Notification appears on lock screen
- Tapping notification opens CRM to correct job
- Notification persists until dismissed

**Pass/Fail:** ___________

---

## Performance & Stability Tests

### Test 16: 1-Hour Continuous Use
**Objective:** Verify no memory leaks or performance degradation

**Steps:**
1. Login to CRM
2. Open DevTools → Performance Monitor (Chrome) or Task Manager
3. Note initial memory usage: __________ MB
4. Leave tab open and active for 1 hour
5. Perform normal actions periodically (view jobs, create job, etc.)
6. After 1 hour, note memory usage: __________ MB

**Expected Result:**
- Memory usage increases < 50MB over 1 hour
- No browser freezes or slowdowns
- Realtime connection remains active

**Memory Growth:** __________ MB

**Pass/Fail:** ___________

---

### Test 17: Console Error Check
**Objective:** Verify no JavaScript errors during normal use

**Steps:**
1. Open DevTools → Console
2. Clear console
3. Login
4. Perform all major actions:
   - Create job
   - Update job
   - Assign tech
   - Change status
   - Logout
5. Review console for errors

**Expected Result:**
- No red errors in console
- Warnings (if any) are informational only
- No "undefined" or "null" reference errors

**Errors Found:** ___________

**Pass/Fail:** ___________

---

### Test 18: Channel Cleanup Verification
**Objective:** Verify realtime channels are cleaned up properly

**Steps:**
1. Login
2. Open DevTools → Application → Service Workers (Chrome)
3. Note active connections
4. Navigate between pages (Jobs → Settings → Dashboard)
5. Logout
6. Check for remaining connections

**Expected Result:**
- Channels are created when needed
- Channels are removed on page navigation
- All channels cleaned up on logout
- No orphaned subscriptions

**Pass/Fail:** ___________

---

## Browser Compatibility Tests

### Test 19: Cross-Browser Session
**Objective:** Verify session works in all major browsers

**Browsers to Test:**
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (macOS/iOS)

**For each browser:**
1. Login
2. Refresh page
3. Close and reopen browser
4. Verify dashboard appears

**Results:**
- Chrome: ___________
- Firefox: ___________
- Safari: ___________

---

### Test 20: Cross-Browser Realtime
**Objective:** Verify realtime works in all major browsers

**For each browser:**
1. Login
2. Have admin assign job from different browser
3. Measure time to appear

**Results:**
- Chrome: __________ ms
- Firefox: __________ ms
- Safari: __________ ms

---

## Summary

**Total Tests:** 20
**Tests Passed:** ___________
**Tests Failed:** ___________
**Pass Rate:** ___________%

**Critical Issues Found:**
1. ___________________________________________
2. ___________________________________________
3. ___________________________________________

**Ready for Production:** YES / NO

**Tester Name:** ___________________________
**Test Date:** ___________________________
**CRM Version:** ___________________________
