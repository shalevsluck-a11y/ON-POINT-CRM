import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) throw new Error('Unauthorized')

    // Check if requesting user is admin
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      throw new Error('Admin only')
    }

    const { name, email, role, assigned_lead_source, payout_pct } = await req.json()
    if (!name || !email || !role) {
      throw new Error('Name, email, and role are required')
    }

    // Generate random temporary password (never shown to anyone)
    const tempPassword = crypto.randomUUID() + crypto.randomUUID()

    // Create user with email and temporary password
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name }
    })

    if (createError) throw createError

    // Create profile
    const profileData: any = {
      id: newUser.user.id,
      name,
      role
    }
    if (assigned_lead_source) profileData.assigned_lead_source = assigned_lead_source
    if (payout_pct !== null && payout_pct !== undefined) profileData.payout_pct = payout_pct

    await supabaseAdmin
      .from('profiles')
      .upsert(profileData)

    // Generate magic link
    const { data: magicLinkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: 'https://crm.onpointprodoors.com'
      }
    })

    if (linkError) throw linkError

    return new Response(
      JSON.stringify({
        success: true,
        userId: newUser.user.id,
        name,
        email,
        magicLink: magicLinkData.properties.action_link
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
