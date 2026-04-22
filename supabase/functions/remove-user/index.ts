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

    const { userId } = await req.json()
    if (!userId) throw new Error('Missing userId')

    // Step 1: NULL out jobs.assigned_tech_id where it equals the user ID
    await supabaseAdmin
      .from('jobs')
      .update({ assigned_tech_id: null })
      .eq('assigned_tech_id', userId)

    // Step 2: NULL out jobs.created_by where it equals the user ID
    await supabaseAdmin
      .from('jobs')
      .update({ created_by: null })
      .eq('created_by', userId)

    // Step 3: Delete all notifications for this user
    await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', userId)

    // Step 4: Delete all push_subscriptions for this user
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)

    // Step 5: Delete the profile row
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId)

    // Step 6: Delete user from auth using admin client
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) throw deleteError

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
