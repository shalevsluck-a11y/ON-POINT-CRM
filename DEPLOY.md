# On Point Pro Doors CRM — Deployment Guide

## Prerequisites

- Supabase project (free tier works)
- Node.js 18+ (for local dev / VPS)
- Google Apps Script (optional — for Sheets sync)

---

## 1. Supabase Setup

### 1a. Create project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **Anon Key** (Settings → API)

### 1b. Run migrations
In the Supabase SQL Editor, run these files in order:
```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rls_policies.sql
supabase/migrations/003_auth_trigger.sql
```

### 1c. Create first admin user
```sql
-- After running migrations, invite the admin via Supabase Auth → Users → Invite
-- Then update their role:
UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
```

### 1d. Update supabase-client.js
Edit `js/supabase-client.js` with your project URL and anon key:
```javascript
const SUPABASE_URL  = 'https://your-project-ref.supabase.co';
const SUPABASE_ANON = 'your-anon-key';
```

---

## 2. Vercel Deployment (Recommended)

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Repository
3. No build step required — static site
4. Deploy → your app is live at `your-project.vercel.app`

---

## 3. VPS Deployment (PM2)

```bash
# Clone repo on server
git clone https://github.com/your/repo.git onpoint-crm
cd onpoint-crm

# Install serve globally
npm install -g serve pm2

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 process list + set up startup
pm2 save
pm2 startup
```

### Nginx reverse proxy (optional)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 4. Google Sheets Sync (Optional)

1. Open Google Sheets → Extensions → Apps Script
2. Paste contents of `google-sheets/Code.gs`
3. Deploy as Web App → Anyone → Copy the URL
4. In CRM Settings, paste the URL in **Sync URL**

---

## 5. User Management

Users are managed in Settings → Users (admin only):
- Admin can invite users via Supabase Auth → Users → Invite User
- Set roles with `UPDATE profiles SET role = 'admin|dispatcher|tech' WHERE id = 'user-uuid'`

### Role permissions
| Feature | Admin | Dispatcher | Tech |
|---------|-------|-----------|------|
| Create jobs | ✓ | ✓ | — |
| View all jobs | ✓ | ✓ | Own only |
| See financials | ✓ | — | Own payout |
| See Zelle memo | ✓ | — | — |
| Delete jobs | ✓ | — | — |
| Settings | ✓ | ✓ | Read-only |

---

## 6. Environment Variables Reference

See `.env.example` for all required variables.
