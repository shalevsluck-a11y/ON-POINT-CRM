# On Point Pro Doors CRM — Complete User Guide

---

## Section 1: What Is This App and How Does It Work?

On Point Pro Doors CRM is a job management app built specifically for your garage door service business. It lets you create job tickets, assign technicians, track payments, and send WhatsApp appointment confirmations — all from your phone or computer.

**How it works under the hood:**
- The app lives at a web address (like `https://crm.onpointdoors.com`) and opens in your browser like a website, but it feels and works like a real app
- All job data is stored in Supabase, a secure cloud database — not on your phone or computer. This means every device sees the same jobs in real time
- If you're on Android, you can install it to your home screen and it works like a native app (even offline for viewing)
- There are three roles: **Admin** (full access), **Dispatcher** (create/manage jobs), and **Tech** (view assigned jobs, update status)

---

## Section 2: First Time Setup (Admin Account)

The very first time someone opens the app, a setup screen appears instead of the login screen. This only happens once.

**Steps:**
1. Open the app URL in your browser
2. You'll see "Create Admin Account" — this is the first-time setup screen
3. Enter your full name, email address, and choose a password (minimum 8 characters)
4. Click **Create Admin Account**
5. You're now logged in as the admin

After this, the setup screen never appears again. Anyone who opens the app will see the normal login screen.

**If the setup screen doesn't appear:** An admin account already exists. Ask the admin to invite you instead.

---

## Section 3: Inviting Team Members (Admin Only)

You never create passwords for your team — you invite them and they set their own password.

**How to invite someone:**
1. Log in as admin
2. Tap the bottom nav **Settings** tab
3. Scroll down to the **Users** section
4. Tap **+ Invite User**
5. Enter their full name, email address, and choose their role:
   - **Technician** — can see their assigned jobs, update status, add notes
   - **Dispatcher** — can create jobs, assign techs, send WhatsApp messages
   - **Admin** — full access including financials, Zelle memos, invite/remove users
6. Tap **Send Invite**

The person receives an email with a link. When they click it, they land on a "Set Your Password" screen. They enter a password and they're in.

**Changing someone's role:** In Settings → Users, find the person and change the dropdown next to their name. The change takes effect immediately.

**Removing a user:** Tap the trash icon next to their name. This permanently removes their access. Jobs they created are not deleted.

---

## Section 4: Creating and Managing Jobs

**Creating a new job (Admin or Dispatcher only):**
1. Tap the **+** button in the bottom navigation
2. **Step 1 — Parse Lead:** Paste a raw lead (from a text message or email) into the text box and tap Parse, OR tap **Skip — Blank Form** to fill it out manually
3. **Step 2 — Customer Info:** Fill in name, phone, address, city, state, ZIP
4. **Step 3 — Schedule:** Pick a date, time (optional), and assign a technician. The tech selector auto-suggests based on ZIP code
5. **Step 4 — Financials:** Enter estimated total, parts cost, tech percentage. The payout preview shows what the owner makes and what the tech earns
6. Tap **Save Job**

**Job statuses:**
- **New** — just created, not yet scheduled
- **Scheduled** — has a date/time
- **In Progress** — tech is on site
- **Closed** — work done, not yet paid
- **Paid** — payment collected
- **Follow-Up** — overdue by 24+ hours (auto-flagged)

**Changing status:** Open a job → tap the status button (e.g., "Mark In Progress"). Techs can only update their own jobs.

---

## Section 5: WhatsApp Appointment Confirmations

Every job card has a green WhatsApp button (shown to admins and dispatchers). Tapping it opens WhatsApp on your phone with a pre-written appointment confirmation message already filled in.

**What the message looks like:**
```
Hello John!

This is On Point Pro Doors confirming your appointment:

Service: Garage Door Spring Replacement
Date: Mon, Apr 21, 2025
Time: 10:00 AM
Technician: Mike
Address: 123 Main St, Brooklyn, NY

If you need to reschedule or have any questions,
please call us at (929) 429-2429.

Thank you for choosing On Point Pro Doors!
```

**If information is missing:**
- No date: shows "Date to be confirmed"
- No time: shows "Time to be confirmed"
- No tech assigned: shows "assigned shortly"
- No phone number: shows a warning — you can't send WhatsApp without a phone number

For **paid jobs**, the WhatsApp button in the job detail screen sends a payment receipt instead of an appointment confirmation.

---

## Section 6: Notifications

**In-app notifications:** The bell icon in the top-right corner shows unread notifications. Admins and dispatchers can broadcast messages to all users.

**Push notifications (on installed PWA):** When the app is installed on your phone (see Section 7), you receive push notifications even when the app is closed — just like a real app. You'll get notified when new jobs are created or important updates happen.

**How to enable push notifications:**
1. Install the app to your home screen (see Section 7)
2. When prompted, tap **Allow** for notifications
3. Push notifications now work even with the app closed

---

## Section 7: Installing the App on Your Phone (PWA)

The app works as a Progressive Web App — you can install it to your home screen and it looks and feels like a real installed app.

**On Android (Chrome):**
1. Open the app in Chrome
2. A banner at the bottom will appear saying "Install On Point CRM"
3. Tap **Install**
4. The app icon appears on your home screen
5. It opens full-screen with no browser bar — just like a native app

**On iPhone (Safari):**
1. Open the app in Safari
2. A banner will appear — tap **How to Install**
3. Follow the steps: tap the **Share** button (the box with an arrow pointing up)
4. Scroll down and tap **Add to Home Screen**
5. Tap **Add**
6. The app icon appears on your home screen

**Offline support:** When installed, the app loads instantly and lets you view existing jobs even without internet. New data syncs automatically when you reconnect.

---

## Section 8: Deploying to Hostinger VPS — Complete Beginner Guide

This section walks you through putting the app on a real server so your whole team can access it. You'll use a Hostinger VPS (Virtual Private Server).

### What You Need Before Starting
- A Hostinger account with a VPS plan (KVM 1 or higher recommended)
- A domain name (e.g., `crm.onpointdoors.com`) — you can buy one through Hostinger
- Your Supabase project URL and API keys (from supabase.com)

### Step 1: Point Your Domain to the Server
1. Log into Hostinger
2. Go to **Domains** → your domain → **DNS Zone**
3. Add an **A Record**:
   - Name: `crm` (or `@` for the root domain)
   - Points to: your VPS IP address (found in Hostinger VPS dashboard)
   - TTL: 14400
4. Wait 10–30 minutes for DNS to propagate

### Step 2: Connect to Your Server
1. In Hostinger VPS dashboard, find your server's IP address
2. Open a terminal:
   - **Mac/Linux:** Open Terminal
   - **Windows:** Open PowerShell or download [PuTTY](https://putty.org)
3. Connect via SSH:
   ```
   ssh root@YOUR_SERVER_IP
   ```
4. Enter your server password (shown in Hostinger dashboard or sent by email)

### Step 3: Install Required Software
Paste these commands one at a time, pressing Enter after each:

```bash
sudo apt update && sudo apt upgrade -y
```
*(This updates the server — takes 1–2 minutes)*

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
*(Installs Node.js)*

```bash
sudo npm install -g pm2
```
*(Installs PM2 — keeps the app running 24/7)*

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```
*(Installs Nginx web server and SSL certificate tool)*

### Step 4: Download the App
```bash
cd /var/www
sudo git clone https://github.com/YOUR_GITHUB_USERNAME/ON-POINT-CRM.git onpoint-crm
sudo chown -R $USER:$USER /var/www/onpoint-crm
cd /var/www/onpoint-crm
```
*(Replace YOUR_GITHUB_USERNAME with your GitHub username)*

### Step 5: Configure the App
Edit the Supabase client file with your project details:
```bash
nano js/supabase-client.js
```
Change these two lines to match your Supabase project:
```javascript
const SUPABASE_URL  = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR-ANON-KEY';
```
Press `Ctrl+X`, then `Y`, then `Enter` to save.

### Step 6: Run the Setup Script
```bash
bash setup.sh crm.yourdomain.com
```
*(Replace `crm.yourdomain.com` with your actual domain)*

This automatically:
- Installs Node packages
- Generates app icons
- Configures Nginx
- Requests a free SSL certificate
- Starts the app with PM2

### Step 7: Set Up Supabase
1. Go to [supabase.com](https://supabase.com) → your project
2. Click **SQL Editor** in the left menu
3. Paste and run each migration file in order (001, 002, 003, 004)
4. Go to **Authentication → Settings** → turn OFF "Enable email confirmation"
5. Deploy Edge Functions (see DEPLOY.md for CLI commands)

### Step 8: Open the App
Go to `https://crm.yourdomain.com` in your browser.

You should see the **Create Admin Account** screen. Fill in your details and you're done!

### Useful Commands (for later)
| What you want to do | Command |
|---------------------|---------|
| Check if app is running | `pm2 status` |
| View app errors | `pm2 logs onpoint-crm` |
| Restart after update | `pm2 restart onpoint-crm` |
| Update the app | `cd /var/www/onpoint-crm && git pull && npm install --production && pm2 restart onpoint-crm` |
| Renew SSL | `sudo certbot renew` |

### Troubleshooting
**"502 Bad Gateway" in browser:**
- The Node.js app stopped. Run: `pm2 restart onpoint-crm`

**Can't connect via SSH:**
- Check your server IP in Hostinger dashboard
- Make sure SSH is enabled in Hostinger (Security → SSH Access)

**Domain not loading:**
- DNS may not have propagated yet. Wait 30 minutes and try again
- Check DNS with: `nslookup crm.yourdomain.com` — should show your server IP

**App loads but can't log in:**
- Double-check SUPABASE_URL and SUPABASE_ANON_KEY in `js/supabase-client.js`
- Make sure migrations ran successfully in Supabase SQL Editor
