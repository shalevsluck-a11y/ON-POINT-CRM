import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Minimal VAPID-signed web push using the Web Push Protocol
async function sendPush(subscription: { endpoint: string; p256dh: string; auth_key: string }, payload: string, vapidKeys: { publicKey: string; privateKey: string; subject: string }) {
  // Import vapid private key
  const privateKeyBytes = base64UrlDecode(vapidKeys.privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const audience = new URL(subscription.endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64UrlEncode(JSON.stringify({ aud: audience, exp: expiration, sub: vapidKeys.subject }));
  const sigInput = `${header}.${claims}`;

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const signature = base64UrlEncode(sigBytes);
  const jwt = `${sigInput}.${signature}`;

  const vapidHeader = `vapid t=${jwt}, k=${vapidKeys.publicKey}`;

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: new TextEncoder().encode(payload),
  });

  return response;
}

function base64UrlEncode(data: string | ArrayBuffer): string {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = new Uint8Array(data);
  }
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const paddedStr = padded + '='.repeat(padLength);
  const binary = atob(paddedStr);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

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

    const { title, body, jobId, targetUserId } = await req.json();

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch subscriptions — either all or for a specific user
    let query = adminClient.from('push_subscriptions').select('*');
    if (targetUserId) query = query.eq('user_id', targetUserId);
    const { data: subs } = await query;

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // VAPID keys - TODO: Move to secrets via Supabase Dashboard
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY') || 'BGNE39yvpaok-a8Iqxe9Pf-7sfnQMq282TWZ0WvKcahkIJSdOFGGQq8od2yeB5CzYa3F0TQcdt0-GyvhV3SjAXo';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') || 'Z1ssH21_TN-iHGCFgCt9s9RLW1yUnbphJbMkh34MgFI';
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:service@onpointprodoors.com';
    const payload = JSON.stringify({ title, body, jobId });

    let sent = 0;
    const staleIds: string[] = [];

    for (const sub of subs) {
      try {
        const res = await sendPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth_key: sub.auth_key },
          payload,
          { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject }
        );
        if (res.status === 410 || res.status === 404) {
          staleIds.push(sub.id);
        } else {
          sent++;
        }
      } catch (_e) {
        // Skip failed subscriptions
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await adminClient.from('push_subscriptions').delete().in('id', staleIds);
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
