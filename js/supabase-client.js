/* ============================================================
   SUPABASE-CLIENT.JS — Supabase client initialization
   ============================================================ */

const SUPABASE_URL  = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODk3NzIsImV4cCI6MjA5MjI2NTc3Mn0.4Y8atq2axARopvt6_BlBfkyUQyrbuQyjYsUNit-MJwM';

// Detect if running in PWA mode vs regular browser
const isPWA = window.navigator.standalone === true ||
              window.matchMedia('(display-mode: standalone)').matches ||
              window.matchMedia('(display-mode: fullscreen)').matches;

// Use separate storage keys for PWA and browser to prevent conflicts
const storageKey = isPWA ? 'onpoint-pwa-auth' : 'onpoint-web-auth';

console.log('Initializing Supabase client:', { isPWA, storageKey });

// Custom storage implementation with specific key
const customStorage = {
  getItem: (key) => {
    return window.localStorage.getItem(`${storageKey}-${key}`);
  },
  setItem: (key, value) => {
    window.localStorage.setItem(`${storageKey}-${key}`, value);
  },
  removeItem: (key) => {
    window.localStorage.removeItem(`${storageKey}-${key}`);
  },
};

// supabase is loaded via CDN script tag in index.html
const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: customStorage,
    storageKey: storageKey,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// Single export used throughout the app
const SupabaseClient = _supa;
