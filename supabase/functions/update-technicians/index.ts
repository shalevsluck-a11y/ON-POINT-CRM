import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    console.log('[Edge Function] ═══ update-technicians called ═══')

    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    console.log('[Edge Function] Auth header present:', !!authHeader)
    if (!authHeader) {
      console.error('[Edge Function] ❌ No authorization header')
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Create Supabase client with user's auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    console.log('[Edge Function] Supabase client created')

    // Verify user is admin
    console.log('[Edge Function] Getting user...')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError) {
      console.error('[Edge Function] ❌ getUser error:', userError.message)
      return new Response(JSON.stringify({ error: 'Auth error: ' + userError.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (!user) {
      console.error('[Edge Function] ❌ No user from getUser()')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    console.log('[Edge Function] ✅ User:', user.id)

    // Check admin role
    console.log('[Edge Function] Checking profile role...')
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('[Edge Function] ❌ Profile query error:', profileError.message)
      return new Response(JSON.stringify({ error: 'Profile error: ' + profileError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log('[Edge Function] Profile role:', profile?.role)
    if (profile?.role !== 'admin') {
      console.error('[Edge Function] ❌ Not admin, role is:', profile?.role)
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get technicians from request body
    const { technicians } = await req.json()
    console.log('[Edge Function] Technicians to save:', technicians?.length)

    // Call RPC with USER's auth (has auth.uid() context for admin check)
    console.log('[Edge Function] Calling RPC: update_app_settings_technicians...')
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('update_app_settings_technicians', {
      techs_json: technicians
    })

    if (rpcError) {
      console.error('[Edge Function] ❌ RPC error:', rpcError.message, rpcError.details, rpcError.hint)
      return new Response(JSON.stringify({
        error: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log('[Edge Function] ✅ RPC success')
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[Edge Function] ❌ CATCH block:', error.message, error.stack)
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
