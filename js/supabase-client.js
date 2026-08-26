/* ============================================================
   SUPABASE-CLIENT.JS — Supabase client initialization
   ============================================================ */

// Custom domain for auth (required for magic links)
const SUPABASE_URL  = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjU3NzYsImV4cCI6MjA5MTk0MTc3Nn0.MqfDrG7-Ay4A01hQBs6Qkpj8KPe8zBNJBJiGP0dqXLI';

// Detect if running in PWA mode vs regular browser (logging / diagnostics only —
// this MUST NOT affect where the session is stored, see below).
const isPWA = window.navigator.standalone === true ||
              window.matchMedia('(display-mode: standalone)').matches ||
              window.matchMedia('(display-mode: fullscreen)').matches;

// ONE storage key for every launch mode.
//
// This used to be `isPWA ? 'onpoint-pwa-auth' : 'onpoint-web-auth'`, which created
// two separate auth silos: signing in from the browser wrote the session under
// -web-, then opening the installed icon read from -pwa-, found nothing, and threw
// up the login screen. Every single launch. `isPWA` is also evaluated at script-parse
// time, where the display-mode media query is not reliably settled yet, so the same
// launch could land in either silo.
const storageKey = 'onpoint-auth';

// One-time migration: adopt whichever legacy silo still holds a session so this
// change doesn't sign everyone out on the way in.
(function migrateLegacyAuthStorage() {
  try {
    const legacy = ['onpoint-pwa-auth', 'onpoint-web-auth'];
    for (const prefix of legacy) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || k.indexOf(prefix) !== 0) continue;
        const target = storageKey + k.slice(prefix.length);
        if (window.localStorage.getItem(target) === null) {
          window.localStorage.setItem(target, window.localStorage.getItem(k));
        }
      }
    }
  } catch (e) {
    console.warn('[Auth] Legacy storage migration skipped:', e.message);
  }
})();

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

// Separate client for Edge Functions (custom domain routing broken for new functions)
const EDGE_FUNCTIONS_URL = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const EDGE_FUNCTIONS_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjU3NzYsImV4cCI6MjA5MTk0MTc3Nn0.MqfDrG7-Ay4A01hQBs6Qkpj8KPe8zBNJBJiGP0dqXLI';

const _edgeFunctionsClient = window.supabase.createClient(EDGE_FUNCTIONS_URL, EDGE_FUNCTIONS_ANON, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Single export used throughout the app
const SupabaseClient = _supa;
const EdgeFunctionsClient = _edgeFunctionsClient;
