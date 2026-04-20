/* ============================================================
   SUPABASE-CLIENT.JS — Supabase client initialization
   ============================================================ */

const SUPABASE_URL  = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODk3NzIsImV4cCI6MjA5MjI2NTc3Mn0.4Y8atq2axARopvt6_BlBfkyUQyrbuQyjYsUNit-MJwM';

// supabase is loaded via CDN script tag in index.html
const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// Single export used throughout the app
const SupabaseClient = _supa;
