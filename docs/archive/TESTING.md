# Automated Testing Guide

## 🎯 Three Ways to Test

### Option 1: Quick In-Browser Test (RECOMMENDED FOR NOW)

**No Playwright needed - runs directly in browser console**

1. Login to https://crm.onpointprodoors.com as **dispatcher** or **admin**
2. Open browser console (F12)
3. Copy and paste this:
```javascript
// Load and run the test script
fetch('/test-in-browser.js')
  .then(r => r.text())
  .then(code => eval(code));
```

4. Wait 3 seconds - results will appear in console
5. Copy the JSON output and send it to me

### Option 2: Playwright with Manual Login

**Requires: Playwright installed**

1. Run: `node run-tests-manual-login.js`
2. Two browser windows will open
3. Window 1: Login as DISPATCHER
4. Window 2: Login as ADMIN
5. Tests run automatically after login
6. Results print to terminal

### Option 3: Fully Automated (Requires Magic Tokens)

**Need to provide valid magic tokens**

1. Edit `tests/multi-user-sync.spec.ts`
2. Update `ADMIN_TOKEN` and `DISPATCHER_TOKEN` constants
3. Run: `npm test`

## 📊 What Tests Check

### Dispatcher Tests:
- ✅ Can only see assigned lead source (SONART CONSTRUCTION)
- ✅ Dropdown is disabled (can't change source)
- ✅ "My Lead" option is NOT visible
- ✅ Only 1 option shown

### Admin Tests:
- ✅ Can see ALL lead sources
- ✅ Dropdown is enabled (can select)
- ✅ "My Lead" AND "SONART CONSTRUCTION" both visible
- ✅ Multiple options shown

## 🐛 Expected Issues (Being Fixed)

If tests fail, check console for:
- `[NEW JOB] Force syncing settings...` - Should appear
- `[NEW JOB] ✓ Settings sync complete` - Should appear
- `[SOURCE DROPDOWN] Sources count: 1` - Should NOT be 0
- `NO LEAD SOURCES IN SETTINGS` - Should NOT appear

## 📝 Send Me These Logs

If any test fails, send me:
1. Full console output
2. Screenshots from `test-results/` folder
3. JSON output from in-browser test

This helps me fix the exact issue!
