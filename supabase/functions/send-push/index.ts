import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AES128GCM encryption for Web Push payload
async function encryptPayload(
  payload: string,
  userPublicKey: string,
  userAuth: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; publicKey: Uint8Array }> {
  // Decode user public key and auth secret
  const userPublicKeyBytes = base64UrlDecode(userPublicKey);
  const authSecret = base64UrlDecode(userAuth);

  // Generate local key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Export local public key
  const localPublicKeyBytes = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);

  // Import user public key
  const importedUserPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: importedUserPublicKey },
    localKeyPair.privateKey,
    256
  );

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive encryption key using HKDF
  const prk = await hkdf(authSecret, sharedSecret, new TextEncoder().encode('Content-Encoding: auth\x00'), 32);
  const context = concat([
    new TextEncoder().encode('WebPush: info\x00'),
    new Uint8Array(userPublicKeyBytes),
    new Uint8Array(localPublicKeyBytes)
  ]);
  const ikm = await hkdf(salt, prk, context, 32);
  const contentEncryptionKey = await hkdf(ikm, new Uint8Array(0), new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(ikm, new Uint8Array(0), new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  // Encrypt payload
  const key = await crypto.subtle.importKey(
    'raw',
    contentEncryptionKey,
    'AES-GCM',
    false,
    ['encrypt']
  );

  // Add padding
  const paddedPayload = concat([
    new Uint8Array([0x00, 0x00]), // padding delimiter
    new TextEncoder().encode(payload)
  ]);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    paddedPayload
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    salt,
    publicKey: new Uint8Array(localPublicKeyBytes)
  };
}

// HKDF implementation
async function hkdf(salt: Uint8Array | ArrayBuffer, ikm: Uint8Array | ArrayBuffer, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(ikm),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Extract
  const prk = await crypto.subtle.sign('HMAC', key, new Uint8Array(salt));

  // Expand
  const prkKey = await crypto.subtle.importKey(
    'raw',
    prk,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  let t = new Uint8Array(0);
  const output = new Uint8Array(length);
  let offset = 0;
  let counter = 1;

  while (offset < length) {
    const input = concat([t, info, new Uint8Array([counter])]);
    t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, input));
    const toCopy = Math.min(t.length, length - offset);
    output.set(t.subarray(0, toCopy), offset);
    offset += toCopy;
    counter++;
  }

  return output;
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Minimal VAPID-signed web push
async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: string,
  vapidKeys: { publicKey: string; privateKey: string; subject: string }
) {
  // Encrypt payload
  const encrypted = await encryptPayload(payload, subscription.p256dh, subscription.auth_key);

  // Create Web Push payload body
  const body = concat([encrypted.salt, new Uint8Array([0x00, 0x00, 0x10, 0x00]), encrypted.publicKey, encrypted.ciphertext]);

  // Import VAPID private key
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
    body,
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
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY') || 'BH0-zYhwG6C6thFpljmd7EZQH_Y_JehctoTEmMQPpXviMQEhp7TW_NyiPY24DdESCw4JFxpIC1AB2Ze6le6QZAI';
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') || 'w3f-VmNxD3kJvVD4IAnQpBJd9OCo8TwPs2D1pZqIxYE';
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
        console.log(`Push sent to ${sub.user_id}: ${res.status}`);
        if (res.status === 410 || res.status === 404) {
          staleIds.push(sub.id);
        } else if (res.status === 201) {
          sent++;
        }
      } catch (e) {
        console.error(`Failed to send push to ${sub.user_id}:`, e.message);
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
