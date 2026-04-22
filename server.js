const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://api.onpointprodoors.com',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

app.disable('x-powered-by');
app.use(express.json());

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
    // SW and manifest: always revalidate
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
app.post('/admin/create-user', async (req, res) => {
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
app.post('/auth/magic-session', async (req, res) => {
  try {
    const { magic_token } = req.body;
    if (!magic_token) {
      return res.status(400).json({ error: 'Missing magic_token' });
    }

    console.log(`[MAGIC SESSION] Verifying token: ${magic_token.substring(0, 10)}...`);

    // Verify magic token and get profile
    let { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, magic_token')
      .eq('magic_token', magic_token)
      .single();

    if (profileError || !profile) {
      console.error(`[MAGIC SESSION] Invalid token:`, profileError);
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
        role: profile.role
      },
      hashed_token: sessionData.properties.hashed_token,
      email: email
    });
  } catch (error) {
    console.error(`[MAGIC SESSION] Error:`, error);
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

// SPA fallback — all routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`On Point CRM running on port ${PORT}`);
});
