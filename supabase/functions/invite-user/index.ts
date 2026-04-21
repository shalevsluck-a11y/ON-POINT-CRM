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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { name, role, phone } = await req.json();

    if (!name || !['admin', 'dispatcher', 'tech', 'contractor'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Name and role are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Build a deterministic login email from phone digits, or a timestamped fallback
    const phoneDigits = (phone || '').replace(/\D/g, '');
    const loginEmail = phoneDigits.length >= 7
      ? `u${phoneDigits}@onpointprodoors.com`
      : `staff${Date.now()}@onpointprodoors.com`;

    // Create user — if already registered, look them up and re-issue a link
    let userId: string;
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: loginEmail,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr) {
      if (createErr.message.includes('already') || createErr.message.includes('registered')) {
        // Fetch by email from the paginated user list
        const { data: listData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const existing = (listData?.users || []).find((u: { email?: string }) => u.email === loginEmail);
        if (!existing) {
          return new Response(JSON.stringify({ error: 'User exists but could not be located — try a different phone number' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        userId = existing.id;
      } else {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      userId = newUser.user.id;
    }

    // Upsert profile (name, role, phone)
    const profileData: Record<string, string> = { name, role };
    if (phone) profileData.phone = phone;
    await adminClient.from('profiles').upsert({ id: userId, ...profileData }, { onConflict: 'id' });

    // Generate a password-setup (recovery) link — no email sent
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: loginEmail,
      options: { redirectTo: 'https://crm.onpointprodoors.com' },
    });

    if (linkErr) {
      return new Response(JSON.stringify({ error: linkErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      userId,
      setupLink: linkData.properties?.action_link || '',
      loginEmail,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
