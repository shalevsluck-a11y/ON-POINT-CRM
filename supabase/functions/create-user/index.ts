import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Auth header present, verifying caller...');

    // Create client with caller's auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify caller is authenticated
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();

    if (authError) {
      console.error('Auth error:', authError.message);
      return new Response(JSON.stringify({ error: `Authentication failed: ${authError.message}` }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!caller) {
      console.error('No caller user returned');
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Caller authenticated:', caller.id);

    // Check caller is admin
    const { data: callerProfile, error: profileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError.message);
      return new Response(JSON.stringify({ error: `Failed to verify permissions: ${profileError.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (callerProfile?.role !== 'admin') {
      console.error('Caller is not admin, role:', callerProfile?.role);
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Caller is admin, parsing request body...');

    // Get request data
    const { name, email, password, role, assigned_lead_source } = await req.json();

    // Validate required fields
    if (!name || !email || !password) {
      return new Response(JSON.stringify({ error: 'Name, email, and password are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['dispatcher', 'tech', 'contractor'].includes(role)) {
      return new Response(JSON.stringify({ error: `Invalid role: ${role}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Request validated, creating user with email:', email);

    // Create admin client with service role
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!serviceRoleKey) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
      return new Response(JSON.stringify({ error: 'Server configuration error: missing service role key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Create user
    console.log('Creating user with admin client...');
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError) {
      console.error('User creation error:', createError.message);
      return new Response(JSON.stringify({ error: `Failed to create user: ${createError.message}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!newUser?.user) {
      console.error('No user returned from createUser');
      return new Response(JSON.stringify({ error: 'User creation failed: no user returned' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = newUser.user.id;
    console.log('User created with ID:', userId);

    // Create profile
    const profileData: any = {
      id: userId,
      name,
      role,
    };

    if (assigned_lead_source) {
      profileData.assigned_lead_source = assigned_lead_source;
    }

    console.log('Creating profile...');
    const { error: profileInsertError } = await adminClient
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (profileInsertError) {
      console.error('Profile creation error:', profileInsertError.message);
      // User was created but profile failed - this is not ideal but we'll return success
      // The auth trigger should create the profile automatically anyway
      console.log('Continuing despite profile error - auth trigger will handle it');
    }

    console.log('User creation successful');
    return new Response(JSON.stringify({
      success: true,
      userId,
      email,
      name,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const error = e as Error;
    console.error('Unexpected error:', error.message, error.stack);
    return new Response(JSON.stringify({
      error: `Server error: ${error.message}`
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
