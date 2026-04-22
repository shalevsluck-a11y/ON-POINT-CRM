/* ============================================================
   LOGIN.JS — Login, first-setup, and set-password controllers
   ============================================================ */

const LoginScreen = (() => {

  function show() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    // Always reset the button so it can be clicked even if a prior attempt never cleared it
    const btn = document.getElementById('login-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Magic Link'; }
    document.getElementById('login-email')?.focus();
  }

  function hide() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  async function submit() {
    let input = document.getElementById('login-email')?.value?.trim();
    const btn   = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');

    if (!input) {
      _showError('Please enter your login code or paste your login link.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Logging in…';
    errEl.classList.add('hidden');

    try {
      let token = input;

      // If input is a full URL with #token=, extract just the token
      if (input.includes('#token=')) {
        token = input.split('#token=')[1].split('&')[0];
      } else if (input.includes('token=') && input.includes('http')) {
        token = input.split('token=')[1].split('&')[0];
      }

      // Store token/code and mark for permanent session
      localStorage.setItem('magic_token', token);
      localStorage.setItem('stay_logged_in', 'true');

      // Show success and reload to trigger auth
      errEl.textContent = '✅ Logging you in...';
      errEl.style.color = '#10b981';
      errEl.classList.remove('hidden');

      // Reload to trigger auth.js login
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      _showError('Login failed. Please try again.');
      btn.disabled    = false;
      btn.textContent = 'Login';
    }
  }

  function _showError(msg) {
    const el = document.getElementById('login-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function _friendlyError(msg) {
    if (!msg) return 'Something went wrong. Please try again.';
    if (msg.includes('Invalid login credentials'))
      return 'Incorrect username or password.';
    if (msg.includes('Email not confirmed'))
      return 'Please verify your email first.';
    if (msg.includes('Too many requests'))
      return 'Too many attempts. Please wait a moment.';
    if (msg.includes('CONNECTION_TIMEOUT') || msg.includes('CONNECTION_ERROR') || msg.includes('timeout') || msg.includes('timed out'))
      return 'Please check your connection and try again.';
    return msg;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-email')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
    });
  });

  return { show, hide, submit };

})();


// ──────────────────────────────────────────────────────────
// SETUP SCREEN — shown once when no admin exists yet
// ──────────────────────────────────────────────────────────

const SetupScreen = (() => {

  function show() {
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('setup-name')?.focus();
  }

  function hide() {
    document.getElementById('setup-screen').classList.add('hidden');
  }

  async function submit() {
    const name     = document.getElementById('setup-name')?.value?.trim();
    const email    = document.getElementById('setup-email')?.value?.trim();
    const password = document.getElementById('setup-password')?.value;
    const confirm  = document.getElementById('setup-confirm')?.value;
    const btn      = document.getElementById('setup-btn');
    const errEl    = document.getElementById('setup-error');

    errEl.classList.add('hidden');

    if (!name || !email || !password) {
      _showError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      _showError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      _showError('Passwords do not match.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Creating account…';

    // Block onAuthStateChange from routing to app before admin role is set
    App.setFirstSetupInProgress(true);

    try {
      // 1. Sign up (also signs in automatically when email confirmation is off)
      const { data: signUpData, error: signUpErr } = await SupabaseClient.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (signUpErr) throw signUpErr;

      if (!signUpData.session) {
        throw new Error('Email confirmation is enabled — please disable it in Supabase → Authentication → Settings, then try again.');
      }

      // 2. Claim admin role (server enforces only-once; profile created by trigger with role=tech)
      await Auth.completeFirstAdminSetup();

      // 3. Load app as admin
      await App.completeFirstSetup();
    } catch (e) {
      App.setFirstSetupInProgress(false);
      _showError(e.message || 'Setup failed. Please try again.');
      btn.disabled    = false;
      btn.textContent = 'Create Admin Account';
    }
  }

  function _showError(msg) {
    const el = document.getElementById('setup-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  return { show, hide, submit };

})();


// ──────────────────────────────────────────────────────────
// SET PASSWORD SCREEN — for invited users completing onboarding
// ──────────────────────────────────────────────────────────

const SetPasswordScreen = (() => {

  function show() {
    document.getElementById('set-password-screen').classList.remove('hidden');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('sp-password')?.focus();
  }

  function hide() {
    document.getElementById('set-password-screen').classList.add('hidden');
  }

  async function submit() {
    const password = document.getElementById('sp-password')?.value;
    const confirm  = document.getElementById('sp-confirm')?.value;
    const btn      = document.getElementById('sp-btn');
    const errEl    = document.getElementById('sp-error');

    errEl.classList.add('hidden');

    if (!password) {
      _showError('Please enter a password.');
      return;
    }
    if (password.length < 8) {
      _showError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      _showError('Passwords do not match.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Setting password…';

    try {
      await Auth.updatePassword(password);
      hide();
      // onAuthChange will fire and take user into the app
    } catch (e) {
      _showError(e.message || 'Failed to set password. Try again.');
      btn.disabled    = false;
      btn.textContent = 'Set Password & Continue';
    }
  }

  function _showError(msg) {
    const el = document.getElementById('sp-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  return { show, hide, submit };

})();
