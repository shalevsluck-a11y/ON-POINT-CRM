const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Behind nginx, which forwards the real client IP in X-Forwarded-For. Without
// this, req.ip is the proxy address and the per-IP rate limiter can't tell
// clients apart (login brute-force protection was effectively off).
app.set('trust proxy', 1);

// Supabase admin client (custom domain for main operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_DIRECT_URL || 'https://nmmpemjcnncjfpooytpv.supabase.co',
  process.env.SUPABASE_DIRECT_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Direct project URL admin client (bypasses custom domain PostgREST cache)
// Keys MUST come from env. Server fails fast if missing rather than running with no admin access.
if (!process.env.SUPABASE_DIRECT_SERVICE_KEY) {
  console.error('[FATAL] SUPABASE_DIRECT_SERVICE_KEY env var is required');
  process.exit(1);
}
const supabaseDirectAdmin = createClient(
  process.env.SUPABASE_DIRECT_URL || 'https://nmmpemjcnncjfpooytpv.supabase.co',
  process.env.SUPABASE_DIRECT_SERVICE_KEY,
  { auth: { persistSession: false } }
);

app.disable('x-powered-by');
app.use(express.json());

// Simple in-memory rate limiter (no extra dependency).
// Use on write/admin endpoints to slow obvious abuse without affecting normal usage.
const _rlBuckets = new Map();
function rateLimit({ windowMs = 60_000, max = 60, key = req => (req.ip || 'unknown') } = {}) {
  return (req, res, next) => {
    try {
      const k = key(req);
      const now = Date.now();
      let bucket = _rlBuckets.get(k);
      if (!bucket || now - bucket.start > windowMs) {
        bucket = { start: now, count: 0 };
        _rlBuckets.set(k, bucket);
      }
      bucket.count++;
      if (bucket.count > max) {
        return res.status(429).json({ error: 'Too many requests, slow down' });
      }
      // periodic cleanup so the map doesn't grow forever
      if (_rlBuckets.size > 5000) {
        for (const [k2, b2] of _rlBuckets) if (now - b2.start > windowMs) _rlBuckets.delete(k2);
      }
      next();
    } catch (_) { next(); }
  };
}

// Mirror a user's profile from the OLD auth project into the NEW direct project.
// Why: auth lives on the custom-domain project but jobs/notifications live on the direct project.
// Without this, FK violations and missing push recipients break new users silently.
async function ensureDirectProfile(userId) {
  if (!userId) return;
  try {
    const { data: existing } = await supabaseDirectAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existing) return; // already mirrored

    const { data: oldProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, name, phone, role, color, zelle_handle, zip_codes, default_tech_percent, is_owner, assigned_lead_source, allowed_lead_sources, magic_token')
      .eq('id', userId)
      .maybeSingle();
    if (!oldProfile) return;

    const { error: upsertError } = await supabaseDirectAdmin
      .from('profiles')
      .upsert({
        id:                    oldProfile.id,
        name:                  oldProfile.name || 'User',
        phone:                 oldProfile.phone || null,
        role:                  oldProfile.role || 'dispatcher',
        color:                 oldProfile.color || null,
        zelle_handle:          oldProfile.zelle_handle || null,
        zip_codes:             oldProfile.zip_codes || null,
        default_tech_percent:  oldProfile.default_tech_percent || null,
        is_owner:              oldProfile.is_owner || false,
        assigned_lead_source:  oldProfile.assigned_lead_source || null,
        allowed_lead_sources:  oldProfile.allowed_lead_sources || null,
        magic_token:           oldProfile.magic_token || null,
        updated_at:            new Date().toISOString(),
      });
    if (upsertError) {
      console.warn('[ensureDirectProfile] mirror failed:', userId, upsertError.message);
    } else {
      console.log('[ensureDirectProfile] ✅ mirrored profile to direct project:', userId, oldProfile.role);
    }
  } catch (e) {
    console.warn('[ensureDirectProfile] exception:', e.message);
  }
}

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
  next();
});

// Only the files the app actually loads are public. Everything else at the repo
// root (server.js, .git, .secrets, migrations, backups, docs) stays private.
const PUBLIC_ASSET = /^\/(?:index\.html|sw\.js|manifest\.json|offline\.html|clear-cache\.html|apple-touch-icon(?:-precomposed)?\.png|js\/[\w.-]+\.js|css\/[\w.-]+\.css|assets\/[\w.-]+|public\/sounds\/[\w.-]+\.mp3)$/;
const staticHandler = express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    // SW headers are set by nginx, don't duplicate
    if (filePath.endsWith('sw.js')) {
      // nginx handles Service-Worker-Allowed and Cache-Control
      return;
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // Vendor JS (supabase.min.js): immutable, cache 1 year — never changes between deploys
    if (filePath.endsWith('supabase.min.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    // HTML and JS: never cache, always fetch fresh
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    // CSS: 1-day TTL — SW fetches fresh copies on load anyway
    if (filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return;
    }
    // Images and icons: cache for 1 year (stable assets)
    if (filePath.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
  },
});
app.use((req, res, next) => {
  if (req.path === '/' || PUBLIC_ASSET.test(req.path)) return staticHandler(req, res, next);
  if (/\.[A-Za-z0-9]{1,6}$/.test(req.path)) return res.status(404).end(); // file-looking path not on the list
  next();
});

// Admin endpoints
app.post('/admin/create-user', rateLimit({ max: 20, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify magic token against profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('magic_token', token)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { name, role } = req.body;
    if (!name || !role) {
      return res.status(400).json({ error: 'Name and role are required' });
    }

    // Generate simple login code (e.g., ADMIN-A1B2, TECH-X7Y9)
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    const loginCode = `${role.toUpperCase()}-${randomPart}`;

    // Auto-generate email from name
    const emailSafeName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const email = `${emailSafeName}.${randomSuffix}@onpointprodoors.com`;

    console.log(`[CREATE USER] Creating user: ${name}, role: ${role}`);
    console.log(`[CREATE USER] Login code: ${loginCode}`);

    // Generate random temporary password for Supabase auth
    const tempPassword = Math.random().toString(36) + Math.random().toString(36);

    // Create user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name }
    });

    if (createError) {
      console.error(`[CREATE USER] Auth user creation failed:`, createError.message);
      return res.status(400).json({ error: createError.message });
    }

    console.log(`[CREATE USER] Auth user created with ID: ${newUser.user.id}`);

    // Create profile with login code
    const { error: createProfileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        name,
        role,
        magic_token: loginCode
      });

    if (createProfileError) {
      console.error(`[CREATE USER] Profile creation failed:`, createProfileError);
      return res.status(400).json({ error: 'Profile creation failed: ' + createProfileError.message });
    }

    console.log(`[CREATE USER] Profile created successfully`);
    console.log(`[CREATE USER] Login code: ${loginCode}`);

    res.json({
      success: true,
      userId: newUser.user.id,
      name,
      email,
      loginCode: loginCode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/delete-user/:id', rateLimit({ max: 10, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify magic token against profiles table
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('magic_token', token)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    // NULL out jobs.assigned_tech_id
    await supabaseAdmin
      .from('jobs')
      .update({ assigned_tech_id: null })
      .eq('assigned_tech_id', userId);

    // NULL out jobs.created_by
    await supabaseAdmin
      .from('jobs')
      .update({ created_by: null })
      .eq('created_by', userId);

    // Delete notifications
    await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    // Delete push_subscriptions
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    // Delete profile
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    // Delete auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return res.status(400).json({ error: deleteError.message });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Exchange magic token for Supabase session
app.post('/auth/magic-session', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const { magic_token } = req.body;
    if (!magic_token) {
      return res.status(400).json({ error: 'Missing magic_token' });
    }

    console.log(`[MAGIC SESSION] Login attempt: ${magic_token.substring(0, 10)}...`);
    if (String(magic_token).trim().length < 8) {
      return res.status(401).json({ error: 'Invalid login code' });
    }

    let profile, profileError;

    // Look up by the exact secret login code.

    const tokenQuery = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, magic_token, allowed_lead_sources, assigned_lead_source, phone, color, zip_codes, default_tech_percent, zelle_handle, is_owner')
      .eq('magic_token', magic_token)
      .single();

    console.log(`[MAGIC SESSION] Token query returned:`, tokenQuery.data ? `Found: ${tokenQuery.data.name}` : 'Not found');
    console.log(`[MAGIC SESSION] Token query error:`, tokenQuery.error?.message || 'none');
    console.log(`[MAGIC SESSION] Error code:`, tokenQuery.error?.code || 'none');

    // Login requires the actual secret code (magic_token). Matching by name was
    // removed: a name is not a secret (it shows up in dispatch messages, WhatsApp,
    // etc.), so a name match let anyone log in as any user, including the owner.
    if (tokenQuery.data) {
      profile = tokenQuery.data;
    } else {
      profileError = tokenQuery.error;
    }

    if (profileError || !profile) {
      console.error(`[MAGIC SESSION] ❌ Login failed for: ${String(magic_token).slice(0, 4)}…`);
      return res.status(401).json({ error: 'Invalid login code' });
    }

    console.log(`[MAGIC SESSION] Profile found:`, profile.name);

    // Get email from auth.users table
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(profile.id);

    if (authError || !authUser || !authUser.user) {
      console.error(`[MAGIC SESSION] Failed to get auth user:`, authError);
      return res.status(500).json({ error: 'Failed to get user data' });
    }

    const email = authUser.user.email;
    console.log(`[MAGIC SESSION] Auth user email:`, email);

    // Generate a session token for this user using admin API
    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    });

    if (sessionError) {
      console.error(`[MAGIC SESSION] Session generation failed:`, sessionError);
      return res.status(500).json({ error: 'Failed to generate session' });
    }

    console.log(`[MAGIC SESSION] Session created for:`, email);

    // Return the hashed token that client can use with verifyOtp
    res.json({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        role: profile.role,
        allowed_lead_sources: profile.allowed_lead_sources,
        assigned_lead_source: profile.assigned_lead_source,
        phone: profile.phone,
        color: profile.color,
        zip_codes: profile.zip_codes,
        default_tech_percent: profile.default_tech_percent,
        zelle_handle: profile.zelle_handle,
        is_owner: profile.is_owner
      },
      hashed_token: sessionData.properties.hashed_token,
      email: email
    });
  } catch (error) {
    console.error(`[MAGIC SESSION] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Save push subscription - iOS-compatible proxy endpoint
app.post('/api/save-push-subscription', async (req, res) => {
  // Add CORS headers for iOS PWA standalone mode
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  console.log('[PUSH SUB] ========== REQUEST RECEIVED ==========');
  console.log('[PUSH SUB] Method:', req.method);
  console.log('[PUSH SUB] Headers:', JSON.stringify({ ...req.headers, authorization: req.headers.authorization ? 'Bearer [REDACTED]' : undefined }));
  console.log('[PUSH SUB] Body:', JSON.stringify({ ...req.body, user_id: req.body.user_id ? '[IGNORED]' : undefined }));

  try {
    // ✅ SECURITY FIX: Derive user_id from authenticated session ONLY
    // NEVER trust frontend-provided user_id
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.error('[PUSH SUB] ❌ No Authorization header provided');
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    // Extract token and verify with Supabase
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error('[PUSH SUB] ❌ Auth verification failed:', authError?.message);
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // ✅ user_id is now DERIVED from authenticated session, not from frontend
    const user_id = user.id;
    const { endpoint, p256dh, auth_key } = req.body;

    if (!endpoint || !p256dh || !auth_key) {
      console.error('[PUSH SUB] Missing fields:', { endpoint: !!endpoint, p256dh: !!p256dh, auth_key: !!auth_key });
      return res.status(400).json({ error: 'Missing subscription fields' });
    }

    console.log('[PUSH SUB] ✅ Authenticated user:', user_id, user.email);

    // Verify profile exists for this user
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role')
      .eq('id', user_id)
      .single();

    if (profileError || !profile) {
      console.error('[PUSH SUB] ❌ No profile found for user:', user_id);
      return res.status(403).json({ error: 'No profile found - contact admin' });
    }

    console.log('[PUSH SUB] Profile:', profile.name, '-', profile.role);
    console.log('[PUSH SUB] Endpoint preview:', endpoint.substring(0, 50) + '...');

    // Save subscription with auth-derived user_id
    const { data, error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        user_id,  // ✅ From authenticated session, NOT from frontend
        endpoint,
        p256dh,
        auth_key
      }, {
        onConflict: 'user_id,endpoint'
      })
      .select();

    if (error) {
      console.error('[PUSH SUB] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('[PUSH SUB] ✅ Subscription saved for', profile.name);
    console.log('[PUSH SUB] Data:', data);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[PUSH SUB] ❌ Exception caught:', error);
    console.error('[PUSH SUB] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// OPTIONS handler for CORS preflight
app.options('/api/save-push-subscription', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// Save technicians endpoint (bypasses PostgREST schema cache via RPC)
app.post('/api/save-technicians', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Verify admin role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { technicians } = req.body;
    if (!Array.isArray(technicians)) {
      return res.status(400).json({ error: 'technicians must be array' });
    }

    // Use direct project URL client (bypasses custom domain PostgREST cache)
    const { error: updateError } = await supabaseDirectAdmin
      .from('app_settings')
      .update({ technicians })
      .eq('id', 1);

    if (updateError) {
      console.error('[SAVE TECHS] Update error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    console.log('[SAVE TECHS] ✅ Technicians saved:', technicians.length);
    res.json({ success: true });
  } catch (error) {
    console.error('[SAVE TECHS] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save job endpoint (bypasses custom domain routing to correct project)
app.post('/api/save-job', rateLimit({ max: 120, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Get user role from profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, allowed_lead_sources')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Profile not found' });
    }

    // Auto-mirror profile to direct project (idempotent, fast path skips if already there)
    await ensureDirectProfile(user.id);

    const { job } = req.body;
    if (!job || !job.jobId) {
      return res.status(400).json({ error: 'job object with jobId required' });
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(job.jobId))) {
      return res.status(400).json({ error: 'Invalid jobId' });
    }

    const role = profile.role;
    const isTechOrContractor = role === 'tech' || role === 'contractor';

    // Dispatcher writes use supabaseDirectAdmin below (service role - bypasses
    // RLS entirely), so this endpoint is the ONLY thing scoping a dispatcher's
    // write to their allowed_lead_sources. Reject up front, same deny-by-default
    // rule as migration 046 (dispatcher_can_access_job) and /api/load-jobs.
    if (false) { // dispatchers may save any company (operator rule)
      const allowedSources = Array.isArray(profile.allowed_lead_sources) ? profile.allowed_lead_sources : [];
      if (!allowedSources.length || !allowedSources.includes(job.source)) {
        console.warn('[SAVE JOB] Dispatcher blocked - source not allowed:', { userId: user.id, jobSource: job.source, allowedSources });
        return res.status(403).json({ error: 'Not allowed to save a job for this source' });
      }
    }

    // Tech/contractor: partial update only (status field)
    if (isTechOrContractor) {
      const { data: techRows, error: updateError } = await supabaseDirectAdmin
        .from('jobs')
        .update({
          status: job.status,
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', job.jobId)
        .eq('assigned_tech_id', user.id) // a tech may only touch jobs assigned to them
        .select('job_id');

      if (updateError) {
        console.error('[SAVE JOB] Tech update error:', updateError);
        return res.status(500).json({ error: updateError.message });
      }
      if (!techRows || techRows.length === 0) {
        return res.status(403).json({ error: 'Not your job' });
      }

      console.log('[SAVE JOB] ✅ Tech/contractor job updated:', job.jobId);
      return res.json({ success: true });
    }

    // Admin/dispatcher: full upsert
    // TEMPORARY: Set assigned_tech_id to null until we migrate column to TEXT
    const row = {
      job_id:               job.jobId,
      status:               job.status,
      customer_name:        job.customerName || '',
      phone:                job.phone || '',
      address:              job.address || '',
      city:                 job.city || '',
      state:                job.state || '',
      zip:                  job.zip || '',
      scheduled_date:       job.scheduledDate || null,
      scheduled_time:       job.scheduledTime || null,
      description:          job.description || '',
      notes:                job.notes || '',
      source:               job.source || 'my_lead',
      contractor_name:      job.contractorName || '',
      contractor_pct:       parseFloat(job.contractorPct) || 0,
      assigned_tech_id:     job.assignedTechId || null,
      assigned_tech_name:   job.assignedTechName || '',
      is_self_assigned:     job.isSelfAssigned || false,
      tech_percent:         parseFloat(job.techPercent) || 0,
      estimated_total:      parseFloat(job.estimatedTotal) || 0,
      job_total:            parseFloat(job.jobTotal) || 0,
      parts_cost:           parseFloat(job.partsCost) || 0,
      tax_amount:           parseFloat(job.taxAmount) || 0,
      tax_option:           job.taxOption || 'none',
      tech_payout:          parseFloat(job.techPayout) || 0,
      payment_method:       job.paymentMethod || 'cash',
      paid_at:              job.paidAt || null,
      sync_status:          job.syncStatus || 'pending',
      synced_at:            job.syncedAt || null,
      photos:               job.photos || [],
      raw_lead:             job.rawLead || '',
      is_recurring_customer: job.isRecurringCustomer || false,
      overdue_flagged_at:   job.overdueAt || null,
      follow_up_at:         job.followUpAt || null,
      created_by:           job.createdBy || null,
      created_by_name:      job.createdByName || null,
      updated_at:           new Date().toISOString(),
    };

    // Admin-only financial fields
    if (role === 'admin') {
      row.owner_payout   = parseFloat(job.ownerPayout) || 0;
      row.contractor_fee = parseFloat(job.contractorFee) || 0;
    }

    // Use direct project URL client
    const { data, error: upsertError } = await supabaseDirectAdmin
      .from('jobs')
      .upsert(row)
      .select();

    if (upsertError) {
      console.error('[SAVE JOB] Upsert error:', upsertError);
      return res.status(500).json({ error: upsertError.message });
    }

    console.log('[SAVE JOB] ✅ Job saved:', job.jobId);

    // Handle zelle memo for admin
    if (role === 'admin' && job.zelleMemo !== undefined) {
      await supabaseDirectAdmin.from('job_zelle').upsert({
        job_id:     job.jobId,
        zelle_memo: job.zelleMemo || '',
      });
    }

    res.json({ success: true, data: data?.[0] });
  } catch (error) {
    console.error('[SAVE JOB] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete job endpoint (deletes from correct project)
app.delete('/api/delete-job/:jobId', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    const { data: delProfile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!delProfile || delProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const jobId = req.params.jobId;
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID required' });
    }

    // Delete from direct project
    const { error: deleteError } = await supabaseDirectAdmin
      .from('jobs')
      .delete()
      .eq('job_id', jobId);

    if (deleteError) {
      console.error('[DELETE JOB] Error:', deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    console.log('[DELETE JOB] ✅ Deleted:', jobId);
    res.json({ success: true });
  } catch (error) {
    console.error('[DELETE JOB] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load jobs endpoint (reads from correct project)
app.get('/api/load-jobs', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Get user role from profiles (same project as auth)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, assigned_lead_source, allowed_lead_sources')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[LOAD JOBS] Profile lookup error:', profileError);
      console.error('[LOAD JOBS] User ID:', user.id);
      return res.status(401).json({ error: 'Profile not found' });
    }

    console.log('[LOAD JOBS] Auth user id:', user.id);
    console.log('[LOAD JOBS] Profile found:', !!profile);
    console.log('[LOAD JOBS] Profile role:', profile.role);

    // Auto-mirror profile to direct project so jobs/notifications work for any user
    await ensureDirectProfile(user.id);

    const role = profile.role;
    const isTechOrContractor = role === 'tech' || role === 'contractor';

    // Tech/contractor get limited view, admin/dispatcher get full view
    const tableName = isTechOrContractor ? 'jobs_limited' : 'jobs';
    let query = supabaseDirectAdmin.from(tableName).select('*');
    if (role === 'tech') query = query.eq('assigned_tech_id', user.id);

    // Contractor/Dispatcher filtering: only jobs matching their assigned lead source
    if (role === 'contractor') {
      const assignedLeadSource = profile.assigned_lead_source;
      if (assignedLeadSource) {
        query = query.eq('source', assignedLeadSource);
      } else {
        // Contractor with no assigned lead source sees no jobs
        return res.json({ jobs: [], zelleMap: {} });
      }
    } else if (false) { // dispatchers see ALL jobs (operator rule)
      // Dispatcher: scope to allowed_lead_sources (the array field RLS actually
      // enforces - see dispatcher_can_access_job(), migration 046). Previously
      // this branch filtered by the separate, independently-set
      // assigned_lead_source singular field and defaulted to SHOWING ALL JOBS
      // when unset - the same fail-open bug fixed at the database layer in
      // migration 046, duplicated here at the API layer. Fixed: use the real
      // scoping field, and default to zero jobs (not all jobs) when unset.
      const allowedSources = Array.isArray(profile.allowed_lead_sources) ? profile.allowed_lead_sources : [];
      console.log('[LOAD JOBS] Dispatcher allowed_lead_sources:', allowedSources);
      if (allowedSources.length > 0) {
        console.log('[LOAD JOBS] Filtering dispatcher jobs by sources:', allowedSources);
        query = query.in('source', allowedSources);
      } else {
        console.log('[LOAD JOBS] Dispatcher has no allowed_lead_sources - showing zero jobs (fail closed)');
        return res.json({ jobs: [], zelleMap: {}, role });
      }
    }

    const { data: jobs, error: jobsError } = await query.order('created_at', { ascending: false });

    if (jobsError) {
      console.error('[LOAD JOBS] Query error:', jobsError);
      return res.status(500).json({ error: jobsError.message });
    }

    // Fetch zelle memos for admin
    let zelleMap = {};
    if (role === 'admin') {
      const { data: zm } = await supabaseDirectAdmin.from('job_zelle').select('*');
      if (zm) {
        zm.forEach(z => { zelleMap[z.job_id] = z.zelle_memo; });
      }
    }

    console.log('[LOAD JOBS] Jobs client: supabaseDirectAdmin');
    console.log('[LOAD JOBS] Jobs returned:', jobs?.length || 0);
    console.log('[LOAD JOBS] ✅ Success');
    res.json({ jobs: jobs || [], zelleMap, role });
  } catch (error) {
    console.error('[LOAD JOBS] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Load settings endpoint (reads from correct project)
app.get('/api/load-settings', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Get user role (same project as auth)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[LOAD SETTINGS] Profile lookup error:', profileError);
      console.error('[LOAD SETTINGS] User ID:', user.id);
      return res.status(401).json({ error: 'Profile not found' });
    }

    const isAdmin = profile.role === 'admin';

    // Fetch app_settings
    const { data: settings, error: settingsError } = await supabaseDirectAdmin
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (settingsError) {
      console.error('[LOAD SETTINGS] app_settings error:', settingsError);
      return res.status(500).json({ error: settingsError.message });
    }

    // Fetch profiles
    const { data: profiles, error: profilesError } = await supabaseDirectAdmin
      .from('profiles')
      .select('id, name, phone, color, zip_codes, default_tech_percent, zelle_handle, is_owner, role')
      .order('name');

    if (profilesError) {
      console.error('[LOAD SETTINGS] profiles error:', profilesError);
      return res.status(500).json({ error: profilesError.message });
    }

    console.log('[LOAD SETTINGS] ✅ Loaded settings and profiles');
    console.log('[LOAD SETTINGS] Technicians array valid:', Array.isArray(settings.technicians));
    console.log('[LOAD SETTINGS] Lead sources count:', settings.lead_sources?.length || 0);

    res.json({
      settings,
      profiles: profiles || [],
      isAdmin
    });
  } catch (error) {
    console.error('[LOAD SETTINGS] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save settings endpoint
app.post('/api/save-settings', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }

    // Get user role (same project as auth)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[SAVE SETTINGS] Profile lookup error:', profileError);
      return res.status(401).json({ error: 'Profile not found' });
    }

    // Only admin can save settings
    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const updates = req.body;
    console.log('[SAVE SETTINGS] Saving updates:', Object.keys(updates));

    // Update app_settings in NEW project
    const { error: updateError } = await supabaseDirectAdmin
      .from('app_settings')
      .update(updates)
      .eq('id', 1);

    if (updateError) {
      console.error('[SAVE SETTINGS] Update error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    console.log('[SAVE SETTINGS] ✅ Settings saved successfully');
    res.json({ success: true });
  } catch (error) {
    console.error('[SAVE SETTINGS] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test push notification endpoint
app.post('/api/test-push', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized - missing auth token' });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid auth token' });
    }
    console.log('[TEST PUSH] ========== Test push request received ==========');
    console.log('[TEST PUSH] Request body:', req.body);

    const { user_id } = req.body;

    if (!user_id) {
      console.log('[TEST PUSH] ❌ No user_id provided');
      return res.status(400).json({ error: 'user_id required' });
    }

    console.log('[TEST PUSH] Sending test notification to user:', user_id);

    // Call the Supabase Edge Function
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[TEST PUSH] ❌ Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        targetUserId: user_id,
        title: 'Test Notification',
        body: `Test push sent at ${new Date().toLocaleTimeString()}`,
        jobId: null,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('[TEST PUSH] ✅ Success:', result);
      res.json({ success: true, result });
    } else {
      console.error('[TEST PUSH] ❌ Failed:', result);
      res.status(response.status).json({ error: result.error || 'Failed to send test push' });
    }

  } catch (error) {
    console.error('[TEST PUSH] ❌ Exception:', error.message);
    console.error('[TEST PUSH] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

// SPA fallback — all routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── AI add-job: parse a messy pasted lead into a structured job via Haiku ──
// Parse-only: returns fields for the operator to confirm. Never writes to the DB.
// ── AI add-job: parse a messy or labelled lead into a structured job via Haiku ──
// Parse-only: returns fields for the operator to confirm. Never writes to the DB.
app.post('/api/ai-parse-job', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid auth token' });

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'dispatcher')) {
      return res.status(403).json({ error: 'Only admins and dispatchers can add jobs' });
    }

    const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (text.length > 4000) return res.status(400).json({ error: 'Text too long (max 4000 chars)' });

    let apiKey;
    try { apiKey = require('fs').readFileSync(__dirname + '/.secrets/anthropic.key', 'utf8').trim(); }
    catch (e) { return res.status(500).json({ error: 'AI not configured on server' }); }
    if (!apiKey) return res.status(500).json({ error: 'AI not configured on server' });

    const tool = {
      name: 'create_job',
      description: 'Extract a garage-door service job from the pasted lead text.',
      input_schema: {
        type: 'object',
        properties: {
          customerName:  { type: 'string', description: 'Customer full name (the "N:" field)' },
          phone:         { type: 'string', description: 'Phone number, digits only (the "Ph:" field)' },
          address:       { type: 'string', description: 'Street address ONLY - no city/state/zip (from "Addr:")' },
          city:          { type: 'string', description: 'Town/city (from "Addr:")' },
          state:         { type: 'string', description: '2-letter US state code (from "Addr:")' },
          zip:           { type: 'string', description: '5-digit ZIP (from "Addr:")' },
          scheduledDate: { type: 'string', description: 'ISO date YYYY-MM-DD from "Appt:", else empty' },
          scheduledTime: { type: 'string', description: 'Time window as written, e.g. "12:00 PM - 2:00 PM" (from "Appt:"), else empty' },
          description:   { type: 'string', description: 'Short summary of the service, combining "Desc:" and "Occu:"' },
          company:       { type: 'string', description: 'Company / lead source (the "Co:" field), else empty' },
          reference:     { type: 'string', description: 'Lead reference code (the "PDL:" field), else empty' }
        },
        required: ['customerName']
      }
    };

    const today = new Date().toISOString().slice(0, 10);
    const system = [
      'You extract ONE structured garage-door service job from a pasted lead for On Point garage-door CRM.',
      'The lead is either free text (a customer message) OR a labelled block using these labels:',
      '"Co:"=company/lead source, "PDL:"=lead reference code, "N:"=customer name, "Ph:"=phone,',
      '"Addr:"=full address (street, city, state, zip), "Desc:"=service description, "Occu:"=specific item/service,',
      '"Appt:"=appointment date and time window.',
      'Mapping: N->customerName; Ph->phone (digits only); Addr-> split into address (street only), city, state (2-letter), zip;',
      'Desc + Occu -> a short description; Appt-> scheduledDate (ISO YYYY-MM-DD) and scheduledTime (the window as written);',
      'Co->company; PDL->reference.',
      'Today is ' + today + '. Interpret dates like "08/26" as that month/day in the current year.',
      'Call create_job exactly once. NEVER invent data - use an empty string for anything not clearly present.'
    ].join(' ');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'create_job' },
        messages: [{ role: 'user', content: text }]
      })
    });

    if (!anthropicRes.ok) {
      const errTxt = await anthropicRes.text().catch(() => '');
      console.error('[ai-parse-job] Anthropic error', anthropicRes.status, errTxt.slice(0, 300));
      return res.status(502).json({ error: 'AI request failed (' + anthropicRes.status + ')' });
    }
    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (!toolUse) return res.status(502).json({ error: 'AI did not return a job' });

    return res.json({ job: toolUse.input, usage: data.usage || null });
  } catch (e) {
    console.error('[ai-parse-job] error', e);
    return res.status(500).json({ error: e.message || 'AI parse failed' });
  }
});


// ── AI ASSISTANT: understands add / close / lost from natural language ──
// One Haiku call per message. Returns a PROPOSED action for the client to
// confirm — it never writes to the DB itself. Cheap + safe.
// ── AI ASSISTANT (Pointy) — full job control with confirm-before-write ──
app.post('/api/ai-assistant', rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid auth token' });
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single();
    if (!profile || (profile.role !== 'admin' && profile.role !== 'dispatcher')) {
      return res.status(403).json({ error: 'Only admins and dispatchers can use the assistant' });
    }

    const message = (req.body && req.body.message ? String(req.body.message) : '').trim();
    if (!message) return res.status(400).json({ error: 'No message provided' });
    if (message.length > 4000) return res.status(400).json({ error: 'Message too long' });
    const jobs = Array.isArray(req.body.jobs) ? req.body.jobs.slice(0, 150) : [];
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-6) : [];

    let apiKey;
    try { apiKey = require('fs').readFileSync(__dirname + '/.secrets/anthropic.key', 'utf8').trim(); }
    catch (e) { return res.status(500).json({ error: 'AI not configured' }); }
    if (!apiKey) return res.status(500).json({ error: 'AI not configured' });

    const tools = [
      { name: 'add_job', description: 'Create a new job from a pasted lead or description.',
        input_schema: { type:'object', properties:{
          customerName:{type:'string'}, phone:{type:'string',description:'digits only'},
          address:{type:'string',description:'street only'}, city:{type:'string'}, state:{type:'string'}, zip:{type:'string'},
          scheduledDate:{type:'string',description:'ISO YYYY-MM-DD or empty'}, scheduledTime:{type:'string'},
          description:{type:'string'}, company:{type:'string'}, reference:{type:'string'} }, required:['customerName'] } },
      { name: 'close_job', description: 'Close a job and record payment.',
        input_schema: { type:'object', properties:{
          jobId:{type:'string',description:'EXACT jobId from the list; empty if unsure'}, customerName:{type:'string'},
          jobTotal:{type:'number'}, partsCost:{type:'number'}, paymentMethod:{type:'string',enum:['cash','zelle','card','check']} },
          required:['customerName','jobTotal'] } },
      { name: 'mark_lost', description: 'Mark ONE job as lost.',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'}, reason:{type:'string'} }, required:['customerName'] } },
      { name: 'mark_estimate', description: 'Mark ONE job as an Estimate (quoted, awaiting decision — needs follow-up).',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'} }, required:['customerName'] } },
      { name: 'update_job', description: 'Update fields on ONE existing job (schedule, address, description, notes, tech).',
        input_schema: { type:'object', properties:{
          jobId:{type:'string'}, customerName:{type:'string'},
          scheduledDate:{type:'string'}, scheduledTime:{type:'string'}, address:{type:'string'}, city:{type:'string'},
          state:{type:'string'}, zip:{type:'string'}, description:{type:'string'}, notes:{type:'string'}, phone:{type:'string'} },
          required:['customerName'] } },
      { name: 'bulk_action', description: 'Apply an action to MANY jobs at once. Supports excluding specific customers (e.g. "mark all open lost except Natalie and Brett") and explicit lists of jobIds.',
        input_schema: { type:'object', properties:{
          op:{type:'string',enum:['mark_lost','mark_estimate']},
          filter:{type:'string',enum:['open','estimate','new','scheduled','all'],description:'which group of jobs'},
          excludeNames:{type:'array',items:{type:'string'},description:'customer names to LEAVE ALONE'},
          includeJobIds:{type:'array',items:{type:'string'},description:'optional explicit jobIds to act on instead of a filter'} },
          required:['op'] } },
      { name: 'dispatch_job', description: 'Send a job to a tech/sub via WhatsApp. detail 100 = full address+phone; detail 50 = city+ZIP only, no street, no phone.',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'}, detail:{type:'number',enum:[100,50],description:'100 or 50'} }, required:['customerName'] } },
      { name: 'assign_tech', description: 'Assign or change which technician is on a job.',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'}, techName:{type:'string'} }, required:['customerName','techName'] } },
      { name: 'reopen_job', description: 'Reopen a job that was closed or marked lost by mistake (back to Open).',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'} }, required:['customerName'] } },
      { name: 'delete_job', description: 'Permanently delete a job. Use only when clearly asked to delete/remove a job.',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'} }, required:['customerName'] } },
      { name: 'add_note', description: 'Append a note or reminder to a job (e.g. follow up Friday, customer will call back).',
        input_schema: { type:'object', properties:{ jobId:{type:'string'}, customerName:{type:'string'}, note:{type:'string'} }, required:['customerName','note'] } },
      { name: 'add_tech', description: 'Add a technician with a payout percentage.',
        input_schema: { type:'object', properties:{ name:{type:'string'}, percent:{type:'number',description:'payout % 0-100'} }, required:['name'] } },
      { name: 'add_company', description: 'Add a company / lead source with the cut they take.',
        input_schema: { type:'object', properties:{ name:{type:'string'}, contractorPercent:{type:'number'} }, required:['name'] } },
      { name: 'sync_sheets', description: 'Push all jobs to the connected Google Sheet.',
        input_schema: { type:'object', properties:{}, } }
    ];

    // ── ROLE GATE ──────────────────────────────────────────────
    // Owner-only powers. A dispatcher is never offered these tools, so the
    // model cannot propose them and the client can never be handed one.
    const isAdmin = profile.role === 'admin';
    const ADMIN_ONLY_TOOLS = ['add_tech', 'add_company', 'delete_job', 'bulk_action'];
    const allowedTools = isAdmin ? tools : tools.filter(t => !ADMIN_ONLY_TOOLS.includes(t.name));

    // Dispatchers must not see job money either (defence in depth: the client
    // already omits it, but never trust the client with someone else's cut).
    const safeJobs = jobs; // dispatchers may see balances too (operator rule)

    const today = new Date().toISOString().slice(0, 10);
    const jobLines = safeJobs.length
      ? safeJobs.map(j => `- ${j.customerName || '?'} | ${j.status || '?'}${j.tech ? ' | tech:'+j.tech : ''}${j.date ? ' | '+j.date : ''}${(j.total!=null&&j.total!=='') ? ' | $'+j.total : ''} | id:${j.jobId}`).join('\n')
      : '(none)';

    const system = [
      'You are Pointy, the in-app assistant for On Point, a garage-door service company. You help the owner run the whole business by chat.',
      'You can: add jobs, close jobs (record payment), mark lost, mark Estimate, update job details, assign a tech, dispatch a job to a tech (100% full details or 50% city+ZIP only with no phone), add notes/reminders, reopen a job, delete a job, add technicians, add companies, run bulk actions (with exclusions), sync to Google Sheets, and ANSWER QUESTIONS / BUILD REPORTS (totals, per-tech balances, what to follow up).',
      'You CANNOT add or manage dispatchers or users — only the owner can, in Settings.',
      (isAdmin
        ? 'The person you are talking to is the OWNER (admin) and may use every tool you have.'
        : 'The person you are talking to is a DISPATCHER. They may add/update jobs, assign techs, dispatch, add notes, and mark lost/estimate. They MAY close jobs and see balances/reports. They may NOT delete jobs, run bulk actions, add technicians, add companies, or add dispatchers. If they ask for those, say it is owner-only and stop.'),
      'Status buckets: Open (new/scheduled/in_progress), Estimate (follow_up = quoted, awaiting decision), Closed (closed/paid), Lost.',
      'Lead formats often use labels: Co=company, PDL=reference, N=name, Ph=phone, Addr=address, Desc/Occu=service, Appt=date+time. "Pay 250 by zell" = jobTotal 250, paymentMethod zelle.',
      'DEFAULTS when adding: if no company is named it is On Point (their own); if no tech is named it is the owner himself.',
      'CURRENT JOBS (use these exact ids):',
      jobLines,
      'For balance/report questions (what a tech owes, revenue, conversion), compute from the job list: closed/paid jobs have $totals, and each line shows the tech. Show short plain numbers.',
      'RULES: Use exactly one tool when the user wants to CHANGE something. For selective bulk requests like "mark all open lost except Natalie and Brett", call bulk_action with filter and excludeNames — never refuse this, it is supported. For QUESTIONS or REPORTS (totals, counts, per-tech balances, what to follow up), do NOT call a tool: answer directly in short plain sentences using the job list. Money answers: only totals present in the list. Today is ' + today + '. Never invent data. No markdown symbols like ** in replies.'
    ].join('\n\n');

    const msgs = [];
    for (const h of history) {
      if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim()) {
        msgs.push({ role: h.role, content: h.text.slice(0, 1500) });
      }
    }
    msgs.push({ role: 'user', content: message });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system, tools: allowedTools, messages: msgs })
    });
    if (!anthropicRes.ok) {
      const t = await anthropicRes.text().catch(() => '');
      console.error('[ai-assistant] Anthropic', anthropicRes.status, t.slice(0, 300));
      return res.status(502).json({ error: 'AI request failed (' + anthropicRes.status + ')' });
    }
    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!toolUse) {
      return res.json({ action: 'chat', reply: (textBlock && textBlock.text) || 'I can add, close, update, mark lost/estimate, run reports, or sync to Sheets.', usage: data.usage || null });
    }
    if (!isAdmin && ADMIN_ONLY_TOOLS.includes(toolUse.name)) {
      return res.json({ action: 'chat', reply: 'That one is owner-only — ask ' + 'the owner to do it in Settings.', usage: data.usage || null });
    }
    return res.json({ action: toolUse.name, params: toolUse.input, reply: textBlock ? textBlock.text : '', usage: data.usage || null });
  } catch (e) {
    console.error('[ai-assistant] error', e);
    return res.status(500).json({ error: e.message || 'assistant failed' });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`On Point CRM running on port ${PORT}`);
});
