# User Management Testing Guide

## Status Summary

✅ Server running (PM2 online since 08:06:09)
✅ Endpoints deployed and responding correctly
✅ Authentication working (rejects invalid tokens)
✅ Error responses verified (401 for missing/invalid auth)

## What's Been Tested (Automated)

### 1. Endpoint Availability Test
```bash
tests/test-endpoints-no-auth.sh
```
**Results:** All endpoints exist and return correct error codes
- POST /admin/create-user → 401 (no auth)
- DELETE /admin/delete-user/:id → 401 (no auth)
- POST /admin/create-user → 401 (invalid token)

## What Needs Manual Testing

### Full End-to-End Browser Test

**Option 1: Quick Test (Recommended)**

1. **Save auth state** (one-time setup):
   ```bash
   npx playwright test tests/e2e/save-auth-state.spec.js --headed
   ```
   - Browser will open
   - Log in as admin
   - Auth state is saved automatically
   - Close browser

2. **Run full test** (can repeat anytime):
   ```bash
   npx playwright test tests/e2e/test-user-management-with-auth.spec.js --headed
   ```
   - Uses saved auth
   - Creates test dispatcher
   - Verifies magic link
   - Deletes dispatcher
   - Confirms deletion

**Option 2: API Test with Token**

1. **Get JWT token**:
   ```bash
   node tests/get-admin-token.js
   ```
   - Browser opens, log in as admin
   - Token is extracted and displayed

2. **Test endpoints**:
   ```bash
   tests/test-user-api.sh "<TOKEN>"
   ```
   - Tests create endpoint
   - Tests delete endpoint
   - Verifies magic link generation

## Test Coverage

### ✅ Verified Working
- [x] Server running and accessible
- [x] Express endpoints configured correctly
- [x] JWT authentication enabled
- [x] Correct error responses (401 for unauthorized)
- [x] @supabase/supabase-js dependency installed
- [x] Environment variables set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

### ⏳ Needs Manual Verification
- [ ] Create user with valid admin token
- [ ] Email auto-generation (name.random@onpointprodoors.com)
- [ ] Role auto-set to "dispatcher"
- [ ] Magic link generation
- [ ] WhatsApp button with correct message
- [ ] Delete user with all foreign key handling
- [ ] jobs.assigned_tech_id nulled
- [ ] jobs.created_by nulled
- [ ] notifications deleted
- [ ] push_subscriptions deleted

## Quick Verification

Run this to confirm server is still online:
```bash
curl -s https://crm.onpointprodoors.com/admin/create-user | jq .
```
Expected output: `{"error":"Missing authorization header"}`

## Troubleshooting

### If endpoints return 404
```bash
ssh user@187.77.8.155 "pm2 logs on-point-crm --lines 50"
```

### If endpoints return 500
```bash
ssh user@187.77.8.155 "pm2 restart on-point-crm && pm2 logs on-point-crm"
```

### If auth is broken
Check that environment variables are set:
```bash
ssh user@187.77.8.155 "pm2 env on-point-crm | grep SUPABASE"
```
