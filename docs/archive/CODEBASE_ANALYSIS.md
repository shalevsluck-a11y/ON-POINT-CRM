# OnPoint Pro Doors CRM — Complete Codebase Analysis

**Date:** 2026-04-20  
**Analyst:** Claude Sonnet 4.6  
**Repository:** https://github.com/shalevsluck-a11y/ON-POINT-CRM

---

## 1. Architecture Overview

**Type:** Single-Page Application (SPA) — Vanilla HTML/CSS/JavaScript, no framework.  
**Server:** Express.js (`server.js`) — static file server only, SPA fallback to `index.html`.  
**Backend:** Supabase (PostgreSQL + Auth + Realtime + Edge Functions).  
**Data Strategy:** Hybrid — localStorage as fast read cache, Supabase as source of truth. On init, DB pulls from Supabase into localStorage, then renders from cache instantly.  
**PWA:** Service worker (`sw.js`), Web App Manifest (`manifest.json`).  
**Hosting:** VPS at 187.77.8.155, managed by PM2, served by Nginx.  
**Google Sheets:** Apps Script backend (`google-apps-script/Code.gs`) — receives POST with job data.

---

## 2. File Structure

```
index.html          — Full SPA shell (42KB) — all screens as hidden divs
sw.js               — Service worker (7.8KB)
manifest.json       — PWA manifest
server.js           — Express static server
package.json        — Just express dependency
ecosystem.config.js — PM2 config
offline.html        — Offline fallback page

css/
  app.css           — Base styles, CSS variables, layout (26KB)
  components.css    — Job cards, modals, forms, kanban (32KB)
  auth.css          — Login/setup screens (11KB)

js/
  supabase-client.js — Supabase client init, URL + anon key
  storage.js         — localStorage layer (10.8KB)
  db.js              — Supabase + localStorage hybrid (19.9KB)
  auth.js            — Auth, roles, user management (11.5KB)
  login.js           — Login/setup/set-password screens (7.3KB)
  parser.js          — Smart lead text parser (20.2KB)
  payout.js          — Payout calculation engine (8.2KB)
  sync.js            — Google Sheets sync manager (8.2KB)
  notifications.js   — Real-time notification bell (7.3KB)
  reminders.js       — Overdue job checker (3.8KB)
  app.js             — Main app (~141KB) — all UI, all handlers

supabase/
  migrations/
    001_initial_schema.sql  — Tables: profiles, jobs, job_zelle, notifications, app_settings
    002_rls_policies.sql    — RLS policies for all tables
    003_auth_trigger.sql    — handle_new_user trigger, overdue job functions
    004_invite_system.sql   — push_subscriptions, setup functions, get_users_for_admin
    005_realtime_and_fixes.sql — REPLICA IDENTITY FULL, idempotent recreations
  functions/
    invite-user/index.ts    — Edge Function: admin-only invite via Supabase Admin API
    remove-user/index.ts    — Edge Function: admin-only user removal
    send-push/              — Edge Function: web push notifications

google-apps-script/
  Code.gs — Google Sheets CRUD via Apps Script Web App
```

---

## 3. Database Schema

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | References auth.users |
| name | TEXT | |
| phone | TEXT | |
| role | TEXT | CHECK: admin, dispatcher, tech (**MISSING: contractor**) |
| color | TEXT | Hex color for avatar |
| zelle_handle | TEXT | |
| zip_codes | TEXT[] | For ZIP-based tech suggestions |
| default_tech_percent | NUMERIC(5,2) | Default payout % |
| is_owner | BOOLEAN | Owner flag (tax logic) |

### `jobs`
| Column | Type | Notes |
|--------|------|-------|
| job_id | TEXT PK | Short alphanumeric ID |
| status | TEXT | new, scheduled, in_progress, closed, paid, follow_up |
| customer_name, phone, address, city, state, zip | TEXT | |
| scheduled_date | DATE | |
| scheduled_time | TIME | |
| description, notes | TEXT | |
| source | TEXT | Lead source |
| contractor_name, contractor_pct | TEXT/NUMERIC | |
| assigned_tech_id | UUID → profiles | |
| assigned_tech_name | TEXT | Denormalized |
| is_self_assigned | BOOLEAN | Owner is the tech |
| tech_percent, estimated_total, job_total | NUMERIC | |
| parts_cost, tax_amount, tax_option | NUMERIC/TEXT | |
| tech_payout, owner_payout, contractor_fee | NUMERIC | **SENSITIVE — see security issues** |
| payment_method | TEXT | cash/zelle/check/card |
| paid_at | TIMESTAMPTZ | |
| photos | JSONB | Array of base64/URLs |
| overdue_flagged_at, follow_up_at | TIMESTAMPTZ | |

### `job_zelle`
| Column | Type | Notes |
|--------|------|-------|
| job_id | TEXT PK → jobs | |
| zelle_memo | TEXT | **Admin-only via RLS** |

### `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID → profiles | NULL = broadcast to all |
| title, body | TEXT | |
| job_id | TEXT → jobs | |
| is_read | BOOLEAN | |

### `app_settings` (single row, id=1)
| Column | Type | Notes |
|--------|------|-------|
| owner_name, owner_phone, owner_zelle | TEXT | |
| tax_rate_ny, tax_rate_nj | NUMERIC | |
| default_state | TEXT | |
| apps_script_url | TEXT | Google Sheets URL |
| lead_sources | JSONB | Array of source objects |

### `push_subscriptions`
| Column | Notes |
|--------|-------|
| user_id, endpoint, p256dh, auth_key | Web Push credentials |

---

## 4. Role System

| Role | Creates Jobs | Sees All Jobs | Sees Revenue | Sees Zelle Memo | Manages Users |
|------|-------------|--------------|-------------|----------------|---------------|
| admin | ✅ | ✅ | ✅ Full | ✅ | ✅ |
| dispatcher | ✅ | ✅ | ❌ | ❌ | ❌ |
| tech | ❌ | ❌ (own only) | ❌ | ❌ | ❌ |
| contractor | ❌ | ❌ (own only) | ❌ | ❌ | ❌ |

---

## 5. JavaScript Module Map

| Module | Responsibility |
|--------|----------------|
| `supabase-client.js` | Creates Supabase client, exports `SupabaseClient` and `SUPABASE_URL` |
| `storage.js` | localStorage CRUD for jobs, settings, draft, sync queue, undo |
| `db.js` | Hybrid: reads from cache, writes to both. Realtime subscriptions. |
| `auth.js` | Login, logout, profile loading, role helpers, invite/remove user |
| `login.js` | LoginScreen, SetupScreen, SetPasswordScreen controllers |
| `parser.js` | Smart lead text parser — extracts name, phone, address, date, time, description from free text with confidence scores |
| `payout.js` | Payout calculation: techPayout, contractorFee, ownerPayout, taxAmount. Generates Zelle memo. Renders HTML breakdown |
| `sync.js` | Google Sheets sync via Apps Script. Syncs paid jobs only. |
| `notifications.js` | Bell icon, badge, dropdown, realtime new notification banner toast |
| `reminders.js` | Background 30min check — flags jobs overdue 24h as follow_up |
| `app.js` | Main app: router, all view renders, all form handlers, all UI logic (~141KB) |

---

## 6. Feature Status

### ✅ WORKING
- Authentication (login, first setup, invited user set-password)
- Role-based access control (RLS enforced at DB level)
- Job creation with smart lead parser (paste any text, auto-parse fields)
- Job status lifecycle (new → scheduled → in_progress → closed → paid → follow_up)
- Payout calculation with tax (NY/NJ/none)
- Google Sheets sync (paid jobs only, via Apps Script)
- Real-time job updates across devices (Supabase realtime)
- Notification bell with realtime badge
- Overdue job detection (flags after 24h)
- User invite (Edge Function sends email, WhatsApp link separately)
- User remove (Edge Function)
- Dark mode toggle
- Pull-to-refresh
- Kanban view
- Calendar view
- PWA install (Android chrome prompt, iOS Safari guide)
- Service worker with offline fallback
- App shell (visible in <300ms)
- Settings: owner info, taxes, techs, lead sources, Google Sheets URL

### ⚠️ PARTIALLY WORKING
- **Financial column masking**: RLS is row-level only. DB returns owner_payout, contractor_fee, job_total to tech users. JS zeroes them out, but the raw Supabase response contains the values. A DB view is needed for complete protection.
- **Realtime for tech**: Realtime events contain full row including financial columns, so a tech receiving a realtime UPDATE event sees the financial data in the payload before JS processes it.
- **Contractor role**: Mentioned in requirements and handled in payout.js but NOT in the DB profiles.role CHECK constraint. Contractors registered as 'tech' which is wrong.
- **Service worker CACHE_VERSION**: Hardcoded as 'v1' — the deploy script was supposed to stamp this but it's not happening. Old SW may not update properly.

### ❌ BROKEN / MISSING
- **Contractor role missing from DB**: `CHECK (role IN ('admin','dispatcher','tech'))` — contractor can't be set.
- **Tech can read financial columns from DB**: No column-level restriction at DB level.
- **No WhatsApp confirmation message on job close**: The flow sends WhatsApp on create but not on close/status update.
- **No Dispatcher-specific dashboard**: Dispatcher sees admin dashboard layout which includes revenue cards they shouldn't see.
- **App.js too large (141KB)**: Single file, hard to maintain, slows initial parse.
- **No 512x512 icon**: Manifest only has SVG + 192px JPEG, PWA install quality lower.
- **Google Sheets sync**: Only syncs 'paid' status jobs — jobs in 'closed' status don't sync until paid.
- **No contractor role UI**: No way to set someone as contractor vs tech in the UI.

---

## 7. RLS Policy Summary

| Table | Admin | Dispatcher | Tech |
|-------|-------|-----------|------|
| profiles | ALL | Own only | Own only |
| jobs | ALL | SELECT + INSERT + UPDATE | Own-assigned only SELECT + UPDATE |
| job_zelle | ALL | NONE | NONE |
| notifications | ALL | INSERT + own SELECT | Own SELECT |
| app_settings | ALL | SELECT only | SELECT only |
| push_subscriptions | Own only | Own only | Own only |

**CRITICAL GAP**: jobs RLS gives tech SELECT on rows where `assigned_tech_id = auth.uid()`. But those rows include columns: `owner_payout`, `contractor_fee`, `job_total`, `parts_cost`, `tax_amount`. These are sensitive. JS zeroes them out but DB sends them. A DB view is needed.

---

## 8. Google Sheets Integration

- **How it works**: On job save/sync, frontend POSTs `{action: 'upsertJob', data: {...}}` to Apps Script Web App URL as `text/plain` (avoids CORS preflight)
- **When it syncs**: Only when `job.status === 'paid'` (sync.js line check)
- **Columns synced**: 33 columns including zelleMemo, ownerPayout (sensitive — only sent from admin session)
- **Sheet structure**: Auto-creates spreadsheet, header row with formatting, alternating row colors by status
- **Summary tab**: Can be created manually via `createSummarySheet()` function

---

## 9. PWA / Service Worker

- **CACHE_VERSION**: `'v1'` — static. Should be stamped on every deploy.
- **Navigation strategy**: Network-first, offline fallback to cached index.html, then offline.html
- **JS/CSS strategy**: Network-first with `cache: 'no-cache'` (bypasses HTTP cache for fresh deploys)
- **Image strategy**: Cache-first (stable assets)
- **Push notifications**: SW handles push events, shows notification with job link
- **PWA install**: Android shows Chrome beforeinstallprompt banner; iOS shows custom instruction alert

---

## 10. Security Findings

### CRITICAL
1. **Financial column leakage**: Tech users can read `owner_payout`, `contractor_fee`, `job_total` from DB at row level. JS masks them but DB sends them. Fix: create `jobs_tech_view` that excludes these columns.
2. **Realtime payload leakage**: Supabase realtime sends full row on UPDATE events including financial columns to any subscriber who has row access.
3. **Contractor role missing**: Can't properly set contractor role — people get set as 'tech' which uses different permission model.

### HIGH  
4. **SUPABASE_URL + ANON key in source code**: This is acceptable for client-side Supabase (anon key is public by design). RLS enforces security. Not a bug.
5. **No rate limiting on login**: Multiple failed login attempts could brute-force accounts. Supabase has built-in rate limiting but it's not explicit.
6. **Tech can UPDATE financial columns**: While RLS WITH CHECK prevents reassigning job to different tech, it doesn't prevent tech from trying to write owner_payout=0 via direct API call. Need column-level privilege or trigger protection.

### MEDIUM
7. **localStorage stores tech payout data**: The JS-zeroed version is stored in localStorage, but the original DB response (with financial data) exists in memory briefly.
8. **Zelle memo not fully isolated**: job_zelle table has admin-only RLS, but the memo is passed through localStorage cache on admin sessions. A device compromise could expose it.

---

## 11. Performance Notes

- **App shell**: Visible immediately (hardcoded in HTML before any JS)
- **Render from cache**: Dashboard and job list render from localStorage before Supabase returns
- **app.js at 141KB**: Unminified, uncompressed. Should be gzipped (Nginx gzip not yet confirmed enabled)
- **Supabase CDN**: Loaded as `defer` script from jsDelivr
- **No code splitting**: Everything loads upfront

---

## 12. Current UI Theme

- iOS-style light theme: white/gray backgrounds (#F2F2F7), black text
- Status colors: blue (new), purple (scheduled), orange (in_progress), green (closed/paid), yellow (follow_up)
- System fonts: -apple-system, SF Pro
- Bottom navigation bar
- Card-based layout

---

## 13. Immediate Priorities

1. **Add `contractor` to profiles.role CHECK constraint** (DB migration)
2. **Create `jobs_tech_view`** that excludes financial columns (DB migration + RLS update)
3. **Stamp service worker CACHE_VERSION** on every deploy
4. **UI redesign**: Dark navy professional theme replacing iOS light theme
5. **Dispatcher dashboard**: Don't show revenue cards to dispatcher role
6. **Fix sync**: Sync on 'closed' status too, not just 'paid'
7. **Contractor role UI**: Let admin set/change contractor vs tech role
8. **WhatsApp confirmation**: Pre-filled messages for job creation and closure
