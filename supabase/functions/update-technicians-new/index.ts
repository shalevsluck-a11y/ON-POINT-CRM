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
    // Parse request body first to check if this is a database trigger call
    const { title, body, jobId, targetUserId, broadcast, roles, excludedUserId } = await req.json();

    const requestBody = { title, body, jobId, targetUserId, broadcast, roles, excludedUserId };
    console.log('[Send Push] ========== INCOMING REQUEST ==========');
    console.log('[Send Push] Request body:', requestBody);

    // Database triggers use broadcast + roles pattern - these are trusted internal calls
    const isDatabaseTrigger = broadcast === true && Array.isArray(roles) && roles.length > 0;

    if (!isDatabaseTrigger) {
      // For non-trigger calls, require authentication
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Missing authorization' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if this is a service role key or user JWT
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const providedKey = authHeader.replace('Bearer ', '');
      const isServiceRole = providedKey === serviceRoleKey;

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
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch subscriptions
    console.log('[Send Push] Fetching subscriptions...');
    let query = adminClient.from('push_subscriptions').select('*');

    if (targetUserId) {
      // Send to specific user
      console.log('[Send Push] Target user ID:', targetUserId);
      query = query.eq('user_id', targetUserId);
    } else if (broadcast && roles && roles.length > 0) {
      // Broadcast to specific roles - join with profiles to filter by role
      console.log('[Send Push] Broadcasting to roles:', roles);
      const { data: profiles, error: profileError } = await adminClient.from('profiles').select('id, role, name').in('role', roles);

      if (profileError) {
        console.error('[Send Push] Error fetching profiles:', profileError);
      }

      console.log('[Send Push] Found', profiles?.length || 0, 'users with matching roles');
      if (profiles && profiles.length > 0) {
        console.log('[Send Push] Profiles:', profiles.map(p => ({ id: p.id, role: p.role, name: p.name })));
      }

      let userIds = profiles?.map(p => p.id) || [];

      // Exclude the user who triggered the action (creator/closer)
      if (excludedUserId) {
        const beforeCount = userIds.length;
        userIds = userIds.filter(id => id !== excludedUserId);
        console.log(`[Send Push] Excluded user ${excludedUserId}, recipients: ${beforeCount} → ${userIds.length}`);
      }

      if (userIds.length === 0) {
        console.log('[Send Push] No recipients after filtering, returning early');
        return new Response(JSON.stringify({ success: true, sent: 0 }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[Send Push] Final recipient user IDs:', userIds);
      query = query.in('user_id', userIds);
    }

    const { data: subs, error: subsError } = await query;

    if (subsError) {
      console.error('[Send Push] Error fetching subscriptions:', subsError);
    }

    if (!subs || subs.length === 0) {
      console.log('[Send Push] ⚠️ No push subscriptions found for recipients');
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Send Push] Found ${subs.length} subscriptions to send to`);
    console.log('[Send Push] Subscription user IDs:', subs.map(s => s.user_id));
    console.log('[Send Push] Subscription endpoints (first 50 chars):', subs.map(s => s.endpoint.substring(0, 50) + '...'));

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
    const sendResults: any[] = [];

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

        console.log(`[Send Push] Sending to user ${sub.user_id}... endpoint: ${sub.endpoint.substring(0, 50)}...`);
        const result = await webpush.sendNotification(pushSubscription, payload);
        console.log(`[Send Push] ✅ Push sent to ${sub.user_id}: HTTP ${result.statusCode}`);

        sendResults.push({
          user_id: sub.user_id,
          endpoint: sub.endpoint.substring(0, 60),
          status: result.statusCode,
          success: true
        });

        if (result.statusCode === 410 || result.statusCode === 404) {
          staleIds.push(sub.id);
        } else if (result.statusCode === 201) {
          sent++;
        }
      } catch (e) {
        console.error(`[Send Push] ❌ Failed to send push to ${sub.user_id}:`, e.message);
        console.error(`[Send Push] Error status code:`, e.statusCode);
        console.error(`[Send Push] Error body:`, e.body);

        sendResults.push({
          user_id: sub.user_id,
          endpoint: sub.endpoint.substring(0, 60),
          status: e.statusCode || 0,
          error: e.message,
          success: false
        });

        // If subscription is invalid/expired
        if (e.statusCode === 410 || e.statusCode === 404) {
          staleIds.push(sub.id);
        }
      }
    }

    console.log('[Send Push] ========== SENDING COMPLETE ==========');

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await adminClient.from('push_subscriptions').delete().in('id', staleIds);
      console.log(`Cleaned up ${staleIds.length} stale subscriptions`);
    }

    console.log(`[Send Push] ✅ Successfully sent ${sent}/${subs.length} push notifications`);

    // Log to database for persistent debugging
    try {
      const logData = {
        event_type: targetUserId ? 'test_push' : 'job_created',
        request_body: requestBody,
        recipients: subs.map(s => s.user_id),
        results: {
          total_subscriptions: subs.length,
          sent_count: sent,
          stale_count: staleIds.length,
          send_results: sendResults,
          payload: payload
        }
      };

      await adminClient.from('push_logs').insert(logData);
    } catch (logError) {
      console.error('[Send Push] Failed to log to database:', logError);
    }

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
