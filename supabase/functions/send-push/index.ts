import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

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

    // Check if this is a service role key (from database trigger) or user JWT
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRole = authHeader.replace('Bearer ', '') === serviceRoleKey;

    // If not service role, verify it's an admin/dispatcher user
    if (!isServiceRole) {
      const callerClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user } } = await callerClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: profile } = await callerClient.from('profiles').select('role').eq('id', user.id).single();
      if (!['admin', 'dispatcher'].includes(profile?.role)) {
        return new Response(JSON.stringify({ error: 'Admin/dispatcher only' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { title, body, jobId, targetUserId, broadcast, roles } = await req.json();

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch subscriptions
    let query = adminClient.from('push_subscriptions').select('*');

    if (targetUserId) {
      // Send to specific user
      query = query.eq('user_id', targetUserId);
    } else if (broadcast && roles && roles.length > 0) {
      // Broadcast to specific roles - join with profiles to filter by role
      const { data: profiles } = await adminClient.from('profiles').select('id').in('role', roles);
      const userIds = profiles?.map(p => p.id) || [];
      if (userIds.length === 0) {
        return new Response(JSON.stringify({ success: true, sent: 0 }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      query = query.in('user_id', userIds);
    }

    const { data: subs } = await query;

    if (!subs || subs.length === 0) {
      console.log('No push subscriptions found');
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Sending push to ${subs.length} subscriptions`);

    // VAPID keys
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY') || 'BNThACyKMai6hck9NCqpLf_Qdyx_qhpcqGCeOI-_qr1ZS-FyfSx1woTtR9ERYjXBtn8bT5u3am_dBvSADIy_oLc';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') || 'LWMG5pY6Qza8obqQDisiBKrwHk7RX4E0sfuBh0j3BfU';
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:service@onpointprodoors.com';

    // Configure web-push with VAPID details
    webpush.setVapidDetails(
      vapidSubject,
      vapidPublic,
      vapidPrivate
    );

    const payload = JSON.stringify({ title, body, jobId });

    let sent = 0;
    const staleIds: string[] = [];

    for (const sub of subs) {
      try {
        // Create push subscription object
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth_key
          }
        };

        const result = await webpush.sendNotification(pushSubscription, payload);
        console.log(`Push sent to ${sub.user_id}: ${result.statusCode}`);

        if (result.statusCode === 410 || result.statusCode === 404) {
          staleIds.push(sub.id);
        } else if (result.statusCode === 201) {
          sent++;
        }
      } catch (e) {
        console.error(`Failed to send push to ${sub.user_id}:`, e.message);
        // If subscription is invalid/expired
        if (e.statusCode === 410 || e.statusCode === 404) {
          staleIds.push(sub.id);
        }
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await adminClient.from('push_subscriptions').delete().in('id', staleIds);
      console.log(`Cleaned up ${staleIds.length} stale subscriptions`);
    }

    console.log(`Successfully sent ${sent} push notifications`);

    return new Response(JSON.stringify({ success: true, sent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('Send push error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
