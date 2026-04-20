# On Point Pro Doors CRM — Production Deployment Guide

## Prerequisites
- Supabase project (free tier works)
- Node.js 20 on VPS (or Hostinger VPS Ubuntu 22.04)
- Domain name pointed to your server

---

## Part 1: Supabase Setup

### Step 1 — Run Database Migrations
In Supabase Dashboard → SQL Editor, run these files in order:
```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rls_policies.sql
supabase/migrations/003_auth_trigger.sql
supabase/migrations/004_invite_system.sql
```

### Step 2 — Disable Email Confirmation
Supabase Dashboard → Authentication → Settings → **Disable email confirmation** (required so invited users can log in immediately).

### Step 3 — Deploy Edge Functions
```bash
supabase functions deploy invite-user
supabase functions deploy remove-user
supabase functions deploy send-push
```

### Step 4 — Set Edge Function Secrets
Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Set secrets on Supabase:
```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  VAPID_PUBLIC_KEY=your_vapid_public_key \
  VAPID_PRIVATE_KEY=your_vapid_private_key \
  VAPID_SUBJECT=mailto:admin@onpointdoors.com
```

### Step 5 — Update supabase-client.js
Edit `js/supabase-client.js` with your project URL and anon key:
```javascript
const SUPABASE_URL  = 'https://your-project-ref.supabase.co';
const SUPABASE_ANON = 'your-anon-key';
```

---

## Part 2: VPS Deployment (Hostinger Ubuntu 22.04)

### Step 6 — Server Prerequisites
SSH into your VPS:
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### Step 7 — Clone and Install
```bash
cd /var/www
sudo git clone https://github.com/YOUR_USERNAME/ON-POINT-CRM.git onpoint-crm
sudo chown -R $USER:$USER /var/www/onpoint-crm
cd /var/www/onpoint-crm
npm install --production
npm install sharp
node scripts/generate-icons.js
mkdir -p logs
```

### Step 8 — Nginx Configuration
Create `/etc/nginx/sites-available/onpoint-crm`:
```nginx
server {
    listen 80;
    server_name crm.yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/onpoint-crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 9 — SSL with Let's Encrypt
```bash
sudo certbot --nginx -d crm.yourdomain.com
sudo certbot renew --dry-run   # verify auto-renew works
```

### Step 10 — Start with PM2
```bash
cd /var/www/onpoint-crm
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the printed command to enable boot auto-start
```

---

## Automated Setup
Run `bash setup.sh` on the VPS after cloning. It handles Steps 7–10 automatically.

---

## Part 3: First Launch

1. Open `https://crm.yourdomain.com`
2. The **Create Admin Account** screen appears (only shown when no admins exist)
3. Enter name, email, password → **Create Admin Account**
4. You're logged in as admin

**Invite team members:** Settings → Users → **+ Invite User** → enter name, email, role → Send Invite. They receive an email link to set their password.

---

## Updating the App
```bash
cd /var/www/onpoint-crm
git pull
npm install --production
pm2 restart onpoint-crm
```

---

## Role Permissions
| Feature | Admin | Dispatcher | Tech |
|---------|-------|-----------|------|
| Create jobs | ✓ | ✓ | — |
| View all jobs | ✓ | ✓ | Own only |
| See financials | ✓ | — | Own payout |
| See Zelle memo | ✓ | — | — |
| Delete jobs | ✓ | — | — |
| Invite/remove users | ✓ | — | — |
| WhatsApp customer | ✓ | ✓ | — |
| Settings | ✓ | ✓ | Read-only |

---

## Google Sheets Sync (Optional)
1. Google Sheets → Extensions → Apps Script → paste `google-sheets/Code.gs`
2. Deploy as Web App → Anyone → copy URL
3. In CRM Settings → Sync URL → paste the URL

---

## Troubleshooting
| Issue | Fix |
|-------|-----|
| App not loading | `pm2 logs onpoint-crm` |
| Nginx 502 | `pm2 status` — restart if stopped |
| SSL expired | `sudo certbot renew` |
| Edge Function error | `supabase functions logs invite-user` |
| Icons missing | `node scripts/generate-icons.js` |

---

## Environment Variables Reference
See `.env.example` for all variables including VAPID keys and service role key.
