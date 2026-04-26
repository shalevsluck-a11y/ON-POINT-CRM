/* ============================================================
   SUPABASE-CLIENT.JS — Supabase client initialization
   ============================================================ */

// Use direct Supabase URL for Edge Functions (custom domain routing broken for new functions)
const SUPABASE_URL  = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjU3NzYsImV4cCI6MjA5MTk0MTc3Nn0.MqfDrG7-Ay4A01hQBs6Qkpj8KPe8zBNJBJiGP0dqXLI';

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
    params: {
      eventsPerSecond: 10,
      log_level: 'info'
    },
    // Force WebSocket connection with explicit endpoint
    transport: window.WebSocket,
    timeout: 10000,
    heartbeatIntervalMs: 30000,
  },
  global: {
    headers: {
      'apikey': SUPABASE_ANON,
    },
  },
});

// Log realtime connection status
console.log('[Realtime] Client configured with URL:', SUPABASE_URL);

// Single export used throughout the app
const SupabaseClient = _supa;
