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

    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }

    // Generate unique magic token for custom auth
    const magicToken = Math.random().toString(36).substring(2) +
                       Math.random().toString(36).substring(2) +
                       Date.now().toString(36);

    console.log(`[CREATE USER] Creating user: ${name}, email: ${email}, role: ${role}`);
    console.log(`[CREATE USER] Generated magic token: ${magicToken.substring(0, 10)}...`);

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

    // Create profile with magic token
    const { error: createProfileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        name,
        role,
        magic_token: magicToken
      });

    if (createProfileError) {
      console.error(`[CREATE USER] Profile creation failed:`, createProfileError);
      return res.status(400).json({ error: 'Profile creation failed: ' + createProfileError.message });
    }

    console.log(`[CREATE USER] Profile created successfully`);

    // Build magic link using custom token format
    const magicLink = `https://crm.onpointprodoors.com/#token=${magicToken}`;

    console.log(`[CREATE USER] Magic link: ${magicLink.substring(0, 60)}...`);

    res.json({
      success: true,
      userId: newUser.user.id,
      name,
      email,
      magicLink: magicLink
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

// SPA fallback — all routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`On Point CRM running on port ${PORT}`);
});
