/* ============================================================
   LOGIN.JS — Login, first-setup, and set-password controllers
   ============================================================ */

const LoginScreen = (() => {

  function show() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-email')?.focus();
  }

  function hide() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  async function submit() {
    const email    = document.getElementById('login-email')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const btn      = document.getElementById('login-btn');
    const errEl    = document.getElementById('login-error');

    if (!email || !password) {
      _showError('Please enter your email and password.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Signing in…';
    errEl.classList.add('hidden');

    try {
      await Auth.login(email, password);
      // onAuthChange in app.js will handle the rest
    } catch (e) {
      _showError(_friendlyError(e.message));
      btn.disabled    = false;
      btn.textContent = 'Sign In';
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
      return 'Incorrect email or password.';
    if (msg.includes('Email not confirmed'))
      return 'Please verify your email first.';
    if (msg.includes('Too many requests'))
      return 'Too many attempts. Please wait a moment.';
    return msg;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
    });
    document.getElementById('login-email')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-password')?.focus();
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
