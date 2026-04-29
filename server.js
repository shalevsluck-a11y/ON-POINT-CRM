const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client (custom domain for main operations)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://api.onpointprodoors.com',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Direct project URL admin client (bypasses custom domain PostgREST cache)
// Keys come from env. Fallbacks kept temporarily so deploys don't break — rotate keys on Supabase dashboard then drop fallbacks.
const supabaseDirectAdmin = createClient(
  process.env.SUPABASE_DIRECT_URL || 'https://nmmpemjcnncjfpooytpv.supabase.co',
  process.env.SUPABASE_DIRECT_SERVICE_KEY ||
    '***REDACTED-SUPABASE-SERVICE-KEY***',
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

app.use(express.static(path.join(__dirname), {
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
}));

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

app.delete('/admin/delete-user/:id', async (req, res) => {
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

    // DEBUG: List all magic tokens in database
    const { data: allProfiles } = await supabaseAdmin
      .from('profiles')
      .select('name, magic_token');
    console.log(`[MAGIC SESSION] DEBUG: Found ${allProfiles?.length || 0} profiles in database`);
    if (allProfiles) {
      allProfiles.forEach(p => {
        console.log(`[MAGIC SESSION] - ${p.name}: ${p.magic_token?.substring(0, 10)}...`);
      });
    }

    // ✅ FLEXIBLE LOGIN: Accept EITHER 32-char token OR simple username
    let profile, profileError;

    // Try 1: Lookup by exact magic_token (32-char hash)
    console.log(`[MAGIC SESSION] Querying profiles WHERE magic_token = '${magic_token.substring(0, 10)}...'`);

    const tokenQuery = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, magic_token, allowed_lead_sources, assigned_lead_source, phone, color, zip_codes, default_tech_percent, zelle_handle, is_owner')
      .eq('magic_token', magic_token)
      .single();

    console.log(`[MAGIC SESSION] Token query returned:`, tokenQuery.data ? `Found: ${tokenQuery.data.name}` : 'Not found');
    console.log(`[MAGIC SESSION] Token query error:`, tokenQuery.error?.message || 'none');
    console.log(`[MAGIC SESSION] Error code:`, tokenQuery.error?.code || 'none');

    if (tokenQuery.data) {
      profile = tokenQuery.data;
      console.log(`[MAGIC SESSION] ✅ Matched by token`);
    } else {
      // Try 2: Lookup by name (case-insensitive, simple username)
      console.log(`[MAGIC SESSION] Token not found, trying as username...`);
      console.log(`[MAGIC SESSION] Looking for name: "${magic_token}"`);

      const nameQuery = await supabaseAdmin
        .from('profiles')
        .select('id, name, role, magic_token, allowed_lead_sources, assigned_lead_source, phone, color, zip_codes, default_tech_percent, zelle_handle, is_owner')
        .ilike('name', magic_token)
        .single();

      console.log(`[MAGIC SESSION] Name query result:`, nameQuery.data ? 'Found' : 'Not found');
      console.log(`[MAGIC SESSION] Name query error:`, nameQuery.error?.message || 'none');

      if (nameQuery.data) {
        profile = nameQuery.data;
        console.log(`[MAGIC SESSION] ✅ Matched by username: ${profile.name}`);
      } else {
        profileError = nameQuery.error;
      }
    }

    if (profileError || !profile) {
      console.error(`[MAGIC SESSION] ❌ Login failed for: ${magic_token}`);
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

// Apply migration 027 - fix notification trigger
app.post('/admin/apply-migration-027', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('magic_token', token)
      .single();

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    console.log('[MIGRATION 027] Fixing notification triggers...');

    // Read migration file
    const fs = require('fs');
    const sql = fs.readFileSync('./supabase/migrations/027_fix_notification_trigger_job_id.sql', 'utf8');

    // Execute each function separately
    const functions = sql.split('CREATE OR REPLACE FUNCTION');

    for (let i = 1; i < functions.length; i++) {
      const func = 'CREATE OR REPLACE FUNCTION' + functions[i].split(';')[0] + ';';
      console.log(`[MIGRATION 027] Executing function ${i}...`);

      const { error } = await supabaseAdmin.rpc('exec_sql', { query: func });
      if (error) {
        console.error(`[MIGRATION 027] Error:`, error);
        // Try direct query
        const { error: queryError } = await supabaseAdmin.from('_migrations').insert({ sql: func });
        if (queryError) {
          throw new Error(`Failed to execute function ${i}: ${error.message}`);
        }
      }
    }

    console.log('[MIGRATION 027] Migration applied successfully!');

    res.json({
      success: true,
      message: 'Migration 027 applied - notification triggers fixed'
    });
  } catch (error) {
    console.error('[MIGRATION 027] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fix endpoint: add magic tokens to all users who don't have one
app.post('/admin/fix-magic-tokens', async (req, res) => {
  try {
    console.log('[FIX] Adding magic tokens to users...');

    // Get all profiles
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, name, magic_token');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let updated = 0;
    let skipped = 0;
    const results = [];

    for (const profile of profiles) {
      if (profile.magic_token) {
        skipped++;
        continue;
      }

      // Generate magic token
      const magicToken = Math.random().toString(36).substring(2) +
                        Math.random().toString(36).substring(2) +
                        Date.now().toString(36);

      // Update profile
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ magic_token: magicToken })
        .eq('id', profile.id);

      if (updateError) {
        results.push({ name: profile.name, status: 'failed', error: updateError.message });
      } else {
        results.push({ name: profile.name, status: 'updated', token: magicToken.substring(0, 10) + '...' });
        updated++;
      }
    }

    console.log(`[FIX] Updated: ${updated}, Skipped: ${skipped}`);

    res.json({
      success: true,
      total: profiles.length,
      updated,
      skipped,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint: check for duplicate magic tokens
app.get('/admin/debug-tokens', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('magic_token', token)
      .single();

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    // Get all profiles with their magic tokens
    const { data: allProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, name, email, magic_token')
      .order('created_at', { ascending: false });

    // Find duplicates
    const tokenMap = {};
    const duplicates = [];
    allProfiles.forEach(p => {
      if (p.magic_token) {
        if (tokenMap[p.magic_token]) {
          duplicates.push({
            token: p.magic_token.substring(0, 10) + '...',
            users: [tokenMap[p.magic_token], { id: p.id, name: p.name, email: p.email }]
          });
        } else {
          tokenMap[p.magic_token] = { id: p.id, name: p.name, email: p.email };
        }
      }
    });

    res.json({
      totalProfiles: allProfiles.length,
      profilesWithTokens: allProfiles.filter(p => p.magic_token).length,
      duplicates: duplicates.length > 0 ? duplicates : 'None',
      recentUsers: allProfiles.slice(0, 10).map(p => ({
        name: p.name,
        email: p.email,
        tokenPrefix: p.magic_token ? p.magic_token.substring(0, 10) + '...' : 'null'
      }))
    });
  } catch (error) {
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
      .select('role')
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

    const role = profile.role;
    const isTechOrContractor = role === 'tech' || role === 'contractor';

    // Tech/contractor: partial update only (status field)
    if (isTechOrContractor) {
      const { error: updateError } = await supabaseDirectAdmin
        .from('jobs')
        .update({
          status: job.status,
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', job.jobId);

      if (updateError) {
        console.error('[SAVE JOB] Tech update error:', updateError);
        return res.status(500).json({ error: updateError.message });
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
      scheduled_time:       /^\d{1,2}:\d{2}(:\d{2})?$/.test(job.scheduledTime || '') ? job.scheduledTime : null,
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
app.delete('/api/delete-job/:jobId', async (req, res) => {
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
      .select('role, assigned_lead_source')
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

    // Contractor/Dispatcher filtering: only jobs matching their assigned lead source
    if (role === 'contractor') {
      const assignedLeadSource = profile.assigned_lead_source;
      if (assignedLeadSource) {
        query = query.eq('source', assignedLeadSource);
      } else {
        // Contractor with no assigned lead source sees no jobs
        return res.json({ jobs: [], zelleMap: {} });
      }
    } else if (role === 'dispatcher') {
      // Dispatcher: filter by assigned lead source only if they have one
      const assignedLeadSource = profile.assigned_lead_source;
      console.log('[LOAD JOBS] Dispatcher assigned_lead_source:', assignedLeadSource);
      if (assignedLeadSource) {
        console.log('[LOAD JOBS] Filtering dispatcher jobs by source:', assignedLeadSource);
        query = query.eq('source', assignedLeadSource);
      } else {
        console.log('[LOAD JOBS] Dispatcher has no assigned source - showing all jobs');
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
app.post('/api/save-settings', async (req, res) => {
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

// Diagnostic endpoint to check trigger status
app.get('/api/diagnostic/trigger-status', async (req, res) => {
  console.log('[DIAGNOSTIC] Checking trigger status...');

  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // Check 1: pg_net extension
    const { data: pgNetData, error: pgNetError } = await supabaseAdmin.rpc('pg_extension_check', {});

    if (pgNetError) {
      // Extension check function doesn't exist, create inline SQL check
      const { data: extData, error: extError } = await supabaseAdmin
        .from('pg_extension')
        .select('extname, extversion')
        .eq('extname', 'pg_net')
        .maybeSingle();

      diagnostics.checks.pg_net = {
        exists: !!extData && !extError,
        version: extData?.extversion || null,
        error: extError?.message || null
      };
    } else {
      diagnostics.checks.pg_net = pgNetData;
    }

    // Check 2: Trigger exists (query via raw SQL if possible)
    try {
      const { data: triggerData, error: triggerError } = await supabaseAdmin.rpc('check_trigger_status', {});

      diagnostics.checks.trigger = {
        exists: !!triggerData && !triggerError,
        data: triggerData,
        error: triggerError?.message || null
      };
    } catch (e) {
      diagnostics.checks.trigger = {
        exists: 'unknown',
        error: 'Cannot query system catalogs via RPC - manual SQL needed'
      };
    }

    // Check 3: App config
    const { data: configData, error: configError } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', ['supabase_url', 'service_role_key']);

    diagnostics.checks.app_config = {
      exists: !!configData && !configError,
      supabase_url: configData?.find(c => c.key === 'supabase_url')?.value || null,
      has_service_role_key: !!configData?.find(c => c.key === 'service_role_key')?.value,
      error: configError?.message || null
    };

    // Check 4: Recent test jobs
    const { data: jobsData, error: jobsError } = await supabaseAdmin
      .from('jobs')
      .select('job_id, customer_name, created_by, created_at')
      .or('job_id.like.moc%,job_id.like.DIAGNOSTIC_%')
      .order('created_at', { ascending: false })
      .limit(5);

    diagnostics.checks.test_jobs = {
      count: jobsData?.length || 0,
      jobs: jobsData || [],
      error: jobsError?.message || null
    };

    // Check 5: Test trigger manually
    console.log('[DIAGNOSTIC] Attempting manual trigger test...');
    const testJobId = `DIAGNOSTIC_${Date.now()}`;

    const { data: insertData, error: insertError } = await supabaseAdmin
      .from('jobs')
      .insert({
        job_id: testJobId,
        customer_name: 'Trigger Diagnostic Test',
        created_by: '8b2d9042-501e-408d-b260-64e0b08a555f', // dispatcher "de"
        status: 'new',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    diagnostics.checks.manual_trigger_test = {
      job_created: !!insertData && !insertError,
      job_id: testJobId,
      job_data: insertData,
      error: insertError?.message || null,
      note: 'Check edge function logs for invocation within 5 seconds'
    };

    console.log('[DIAGNOSTIC] ✅ Diagnostics complete:', JSON.stringify(diagnostics, null, 2));
    res.json(diagnostics);

  } catch (error) {
    console.error('[DIAGNOSTIC] ❌ Exception:', error.message);
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// SPA fallback — all routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`On Point CRM running on port ${PORT}`);
});
