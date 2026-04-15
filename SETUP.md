# On Point Home Services — Complete Setup Guide

---

## WHAT YOU BUILT

A complete mobile-first business command center for your garage door business.

**Features included:**
- Smart lead parser (paste any raw text → auto-fill all fields)
- ZIP-based technician suggestion
- Automatic payout calculation with tax logic
- Tax only applied when YOU are the assigned technician
- Parts/materials cost deducted before split
- Contractor fee system
- Job photos (before/after)
- Voice-friendly quick notes on every job
- Revenue dashboard (daily, weekly, monthly)
- Technician performance tracker
- One-tap call button on every job
- Job history search (name, phone, address, zip)
- Returning customer detection (same phone = flagged)
- Estimated vs actual payout comparison
- Export to PDF (one tap)
- Color-coded job status system
- Quick-close button → generates Zelle memo instantly
- Calendar view with conflict detection
- Google Sheets sync
- Offline-safe (localStorage first)
- WhatsApp message links
- Full settings management

---

## PART 1 — RUN LOCALLY (ON YOUR COMPUTER)

### Step 1 — Install a local server (one time only)

You need a simple local server because browsers block certain features when you open HTML files directly.

**Option A — Node.js (recommended):**

1. Go to https://nodejs.org and download the LTS version
2. Install it (click Next through all the steps)
3. Open Command Prompt (press Windows key, type "cmd", press Enter)
4. Type this and press Enter:
   ```
   npm install -g serve
   ```
5. Done — you only do this once

**Option B — Python (if you already have Python):**

Open Command Prompt, navigate to your project folder, and run:
```
python -m http.server 3000
```

---

### Step 2 — Open your project

1. Open Command Prompt
2. Navigate to your project folder:
   ```
   cd C:\Users\97252\ON-POINT-CRM
   ```
3. Start the server:
   ```
   serve .
   ```
4. You'll see output like: `Serving! http://localhost:3000`
5. Open your browser and go to: **http://localhost:3000**

The app will open and work fully.

---

### Step 3 — Access from your iPhone (same WiFi network)

1. Keep the server running on your computer
2. Find your computer's IP address:
   - Press Windows key + R, type `cmd`, press Enter
   - Type: `ipconfig`
   - Look for "IPv4 Address" — it looks like `192.168.1.xxx`
3. On your iPhone, open Safari
4. Type: `http://192.168.1.xxx:3000` (replace with your actual IP)
5. The app will load on your iPhone

**To add it to your iPhone home screen:**
1. Open the app in Safari on your iPhone
2. Tap the Share button (the square with an arrow)
3. Tap "Add to Home Screen"
4. Name it "On Point"
5. Tap Add

It will appear as an app icon on your home screen and open full-screen like a native app.

---

### Troubleshooting Local

**App won't open:** Make sure `serve .` is still running in Command Prompt. Don't close that window.

**iPhone can't connect:** Make sure your iPhone and computer are on the same WiFi network. Check your firewall settings — Windows Firewall may be blocking port 3000.

**Data not saving:** This is a browser issue. Make sure you're using Chrome, Safari, or Edge (not Internet Explorer).

---

## PART 2 — SET UP GOOGLE SHEETS BACKEND

This connects your app to Google Sheets so every job is saved in the cloud automatically.

### Step 1 — Open Google Apps Script

1. Go to **https://script.google.com**
2. Sign in with your Google account
3. Click **"New project"**
4. Delete all the default code in the editor

### Step 2 — Paste the backend code

1. Open the file `google-apps-script/Code.gs` from your project folder
2. Copy ALL the code inside it
3. Paste it into the Apps Script editor
4. Click the **Save** button (or press Ctrl+S)
5. Name the project: `On Point Home Services`

### Step 3 — Deploy as Web App

1. Click **"Deploy"** button (top right)
2. Click **"New deployment"**
3. Click the gear icon next to "Type" and select **"Web app"**
4. Fill in the settings:
   - **Description:** On Point CRM Backend
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Click **"Deploy"**
6. If asked to authorize — click "Authorize access", sign in, click "Allow"
7. **COPY the Web App URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

### Step 4 — Add URL to your app

1. Open your app in the browser
2. Tap **Settings** (gear icon on bottom nav)
3. Scroll to **"Google Sheets Sync"**
4. Paste your Apps Script URL into the field
5. Tap **"Test"** — you should see "Connection successful!"
6. Tap **"Save Settings"**

### Step 5 — Verify it works

1. Create a test job in your app
2. Tap the sync button (⟳) in the top right
3. Go to **https://drive.google.com**
4. Look for a file called **"On Point Home Services — Jobs"**
5. Open it — you should see your job as a row in the spreadsheet

---

## PART 3 — DEPLOY ON VERCEL (LIVE ON THE INTERNET)

This makes your app accessible from anywhere — your iPhone, anywhere with internet. No need for your computer to be on.

### Step 1 — Create a GitHub account (if you don't have one)

Go to **https://github.com** and sign up (free).

### Step 2 — Upload your project to GitHub

1. Go to **https://github.com/new**
2. Repository name: `on-point-crm`
3. Set to **Private** (important — this is your business data)
4. Click "Create repository"
5. Follow the instructions to upload your files

**Easy way using GitHub Desktop:**
1. Download GitHub Desktop from **https://desktop.github.com**
2. Sign in with your GitHub account
3. Click "Add" → "Add existing repository"
4. Navigate to `C:\Users\97252\ON-POINT-CRM`
5. Publish the repository to GitHub

### Step 3 — Deploy on Vercel

1. Go to **https://vercel.com** and sign up with your GitHub account
2. Click **"New Project"**
3. Find and select your `on-point-crm` repository
4. Vercel auto-detects the `vercel.json` — click **"Deploy"**
5. Wait 30 seconds
6. You'll get a URL like: `https://on-point-crm.vercel.app`

### Step 4 — Access from iPhone

1. Go to your Vercel URL in Safari
2. Add to Home Screen (same process as local — Share → Add to Home Screen)
3. Now it's a real app on your phone, accessible anywhere

### Step 5 — Update the app after changes

Whenever you make changes to the code:
1. Save the files
2. Commit and push to GitHub (via GitHub Desktop — just click "Commit" then "Push")
3. Vercel automatically redeploys in about 30 seconds

---

## PART 4 — FIRST-TIME SETUP (DO THIS BEFORE USING)

### Step 1 — Configure your info

1. Open the app
2. Tap **Settings** (gear icon)
3. Fill in:
   - **My Name:** Your name
   - **My Phone:** Your phone number
   - **My Zelle Handle:** Your phone or email used for Zelle
   - **Default State:** NY or NJ

### Step 2 — Set tax rates

In Settings → Tax Rates:
- **NY:** 8.875 (default — edit if your county is different)
- **NJ:** 6.625 (default — edit if different)

### Step 3 — Add yourself as a technician

1. Settings → Technicians → tap **+ Add**
2. Enter your name
3. Check **"This is me (owner)"** — this is critical for tax logic
4. Set your default payout % (e.g., 100 if solo)
5. Add your Zelle handle
6. Add your ZIP codes (your service areas)
7. Choose a color (you'll be ★ marked)
8. Save

### Step 4 — Add your other technicians

Repeat for each tech:
- Name, phone, payout %, Zelle handle, ZIP codes, color

### Step 5 — Add lead sources

1. Settings → Lead Sources → tap **+ Add**
2. Add each contractor/platform you use:
   - HomeAdvisor (contractor %)
   - Angi (contractor %)
   - etc.

### Step 6 — Set Apps Script URL

Paste the URL from Part 2 Step 3 above.

---

## PART 5 — DAILY WORKFLOW

### How to add a new job from a lead

1. Tap the **+ button** (center of bottom nav)
2. **Paste the raw lead text** into the textarea
3. Tap **"Parse Lead →"**
4. Review the auto-filled fields — fix anything that's wrong
5. Check the confidence badges (green = auto, yellow = check, red = manual)
6. Tap **Next →**
7. Select the **lead source** (My Lead or a contractor)
8. Tap the **technician** to assign
9. Confirm the payout %
10. Tap **Next →**
11. Enter the **estimated job total** → watch the payout calculate live
12. Enter parts cost if known
13. Select payment method
14. Tap **✓ Save Job**

The job is saved locally instantly. It syncs to Google Sheets in the background.

### How to close a job when payment is received

1. Find the job in **Jobs** list or **Dashboard**
2. Tap the job card
3. Tap the green **"✓ Quick Close & Pay"** button
4. Enter the **final actual total** (what the customer actually paid)
5. Confirm parts cost
6. Watch the final payout calculate
7. Select payment method (Cash / Zelle / Check / Card)
8. Tap **"✓ Mark Paid"**
9. If the tech gets Zelle — a memo is generated automatically
10. Tap **"Generate Zelle Memo"** to copy it and send

### How to use the calendar

1. Tap **Calendar** (bottom nav)
2. Swipe left/right (tap ‹ ›) to change days
3. Jobs are grouped by technician
4. Red warning = time conflict detected
5. Tap any job to open the detail

### How to search for a job

1. Tap **Jobs** (bottom nav)
2. Type in the search bar — name, phone, address, ZIP all work
3. Use the filter chips to narrow by status

### How to add photos to a job

1. Open the job detail
2. Scroll to the **Photos** section
3. Tap the **+ Add** tile
4. Camera opens — take a photo or pick from gallery
5. Photo is compressed and saved automatically

---

## PART 6 — PAYOUT CALCULATION GUIDE

Understanding how the math works:

### When you (owner) are the technician:
```
Job Total:         $500.00
Tax (NY 8.875%):  - $44.38
After Tax:         $455.62
Parts Cost:        - $50.00
After Parts:       $405.62
Contractor Fee:    - $0.00   (My Lead = 0%)
After Contractor:  $405.62
Tech Payout (you):  = $405.62  (100% if solo)
Owner Payout:       = $0.00    (same person)
```

### When another tech is assigned (no tax):
```
Job Total:         $500.00
Tax:               - $0.00    (not owner — no tax)
Parts Cost:        - $50.00
After Parts:       $450.00
Contractor Fee:    - $45.00   (10% contractor)
After Contractor:  $405.00
Tech Payout (60%): = $243.00
Owner Payout:      = $162.00
```

**Key rules:**
- Tax ONLY when you are the assigned tech
- Parts always deducted before split
- Contractor fee comes from remaining after parts
- Tech and Owner split what's left after contractor

---

## PART 7 — FUTURE UPGRADES (WHEN YOU'RE READY)

These are the most valuable upgrades you should add over time:

### Priority 1 — Will save you money immediately

**1. SMS/Text notifications**
- Use Twilio API to auto-text customers when job is scheduled
- "Hi John, your garage door appointment is confirmed for Tuesday at 2pm"
- Cost: ~$0.01 per text

**2. Customer invoice PDF**
- Add a customer-facing PDF (vs the current internal record)
- Sends professional invoice via email or text

**3. Recurring job scheduler**
- Flag returning customers for follow-up reminders
- "John Smith had a spring job 18 months ago — spring check-up time"

### Priority 2 — Better tracking

**4. Google Calendar sync**
- Push scheduled jobs directly to your Google Calendar
- Use Google Apps Script + Calendar API (free)

**5. Revenue charts**
- Line chart of revenue over time
- Bar chart of jobs per tech per week
- Use Chart.js (free, lightweight)

**6. Parts inventory tracking**
- List common parts (springs, cables, openers)
- Track how many you use per job
- Know when to reorder

### Priority 3 — Scale up

**7. Customer portal (basic)**
- A simple link that shows the customer their job status
- No login required — just a secret URL per job
- Saves you "what time is the tech coming?" calls

**8. Online booking**
- A simple public form for customers to request appointments
- Saves you from phone tag

**9. QuickBooks/Wave accounting export**
- Export paid jobs in a format accountants can import
- Tax time made easy

---

## PART 8 — WHAT CAN BREAK (MONITOR THIS)

**1. localStorage getting full**
The app stores photos in localStorage. If you add many photos to many jobs, it may fill up (~5MB limit on most browsers). 
- **Fix:** Export a JSON backup regularly, then export old photos and delete them from the app.
- **Watch for:** Toast error saying "Storage full"

**2. Apps Script quota limits**
Google gives free Apps Script runs up to 6 minutes/day execution time and 20,000 URL Fetch calls/day.
- **Reality:** You won't hit this with normal use (dozens of jobs/day)
- **Watch for:** Sync errors in the app

**3. Apps Script deployment URL changes**
If you re-deploy your Apps Script as a "New Deployment" it creates a NEW URL.
- **Fix:** Always use "Manage Deployments" → update existing deployment, not create new
- **If it breaks:** Go to Settings → paste the new URL

**4. iPhone Safari clearing localStorage**
Safari can clear localStorage if your device is low on storage or after 7 days of not visiting the site.
- **Fix:** Use the Vercel deployment URL and visit it regularly, or sync to Sheets frequently
- **Prevention:** Export JSON backup weekly

**5. Apps Script authorization expires**
Every 90 days, Google may require you to re-authorize the Apps Script.
- **Fix:** Open the Apps Script editor, run any function, re-authorize when prompted
- **Watch for:** Sync suddenly failing with "authorization" error

---

## QUICK REFERENCE — KEYBOARD / GESTURES

| Action | How |
|--------|-----|
| New job | Tap + button (center nav) |
| Search jobs | Jobs tab → type in search bar |
| Filter by status | Jobs tab → tap status chips |
| Close a job | Job detail → green "Quick Close" button |
| Call customer | Any job card → phone icon |
| WhatsApp customer | Job detail → WhatsApp button |
| Sync to Sheets | Top right ⟳ button |
| Export PDF | Job detail → 📄 button |
| Calendar | Calendar tab → swipe days |
| Add photo | Job detail → Photos section → + |

---

## SUPPORT / TROUBLESHOOTING

**App is blank / white screen:**
- Hard refresh: Ctrl+Shift+R (or pull down to refresh on iPhone)
- Check browser console for errors (F12 → Console)

**Data disappeared:**
- Check if you're on the right URL
- Go to Settings → check if Apps Script sync has your data
- Restore from a JSON backup if you have one

**Sync not working:**
- Settings → test connection button
- Make sure the URL ends in `/exec` not `/dev`
- Re-deploy the Apps Script if needed

**Calculations look wrong:**
- Check Settings → Tax Rates are correct
- Check that "This is me (owner)" is only checked for yourself
- Check that contractor % is 0 for My Lead jobs

---

*Built for On Point Home Services — Your personal business command center*
*Version 1.0 — April 2026*
