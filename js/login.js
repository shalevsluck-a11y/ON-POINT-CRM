/* ============================================================
   LOGIN.JS — Login screen controller
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

    btn.disabled   = true;
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

  // Allow Enter key on password field
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
