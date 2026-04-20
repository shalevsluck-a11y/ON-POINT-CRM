/* ============================================================
   NOTIFICATIONS.JS — Real-time in-app notification system
   Bell icon, unread badge, notification dropdown
   ============================================================ */

const Notifications = (() => {

  let _unread = [];
  let _channel = null;

  // ──────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────

  async function init() {
    await _loadUnread();
    _subscribeRealtime();
    _renderBell();
  }

  async function _loadUnread() {
    try {
      _unread = await DB.getUnreadNotifications();
      _renderBell();
    } catch (e) {
      console.warn('Notifications._loadUnread error:', e.message);
    }
  }

  function _subscribeRealtime() {
    _channel = DB.subscribeToNotifications(n => {
      _unread.unshift(n);
      _renderBell();
      _showBannerToast(n);
    });
  }

  // ──────────────────────────────────────────────────────────
  // RENDER — Bell icon with badge
  // ──────────────────────────────────────────────────────────

  function _renderBell() {
    const bell = document.getElementById('notif-bell');
    const badge = document.getElementById('notif-badge');
    if (!bell || !badge) return;

    const count = _unread.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
    bell.classList.toggle('has-unread', count > 0);
  }

  // ──────────────────────────────────────────────────────────
  // DROPDOWN — Show notification list
  // ──────────────────────────────────────────────────────────

  function toggleDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      dropdown.classList.add('hidden');
    } else {
      _renderDropdown(dropdown);
      dropdown.classList.remove('hidden');
    }
  }

  function _renderDropdown(container) {
    if (_unread.length === 0) {
      container.innerHTML = `
        <div class="notif-header">
          <span class="notif-header-title">Notifications</span>
        </div>
        <div class="notif-empty">All caught up ✓</div>`;
      return;
    }

    const items = _unread.slice(0, 20).map(n => `
      <div class="notif-item${n.is_read ? ' notif-read' : ''}"
           data-id="${n.id}"
           onclick="Notifications.handleClick('${n.id}', '${n.job_id || ''}')">
        <div class="notif-item-dot"></div>
        <div class="notif-item-content">
          <div class="notif-item-title">${_esc(n.title)}</div>
          <div class="notif-item-body">${_esc(n.body)}</div>
          <div class="notif-item-time">${_timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');

    container.innerHTML = `
      <div class="notif-header">
        <span class="notif-header-title">Notifications</span>
        <button class="notif-mark-all" onclick="Notifications.markAllRead()">Mark all read</button>
      </div>
      <div class="notif-list">${items}</div>`;
  }

  async function handleClick(notifId, jobId) {
    document.getElementById('notif-dropdown')?.classList.add('hidden');
    await DB.markNotificationRead(notifId);
    _unread = _unread.filter(n => n.id !== notifId);
    _renderBell();
    if (jobId) App.openJobDetail(jobId);
  }

  async function markAllRead() {
    document.getElementById('notif-dropdown')?.classList.add('hidden');
    await DB.markAllNotificationsRead();
    _unread = [];
    _renderBell();
  }

  // ──────────────────────────────────────────────────────────
  // BANNER TOAST for incoming real-time notifications
  // ──────────────────────────────────────────────────────────

  function _showBannerToast(n) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'toast toast-info notif-toast';
    div.innerHTML = `
      <div class="notif-toast-title">${_esc(n.title)}</div>
      <div class="notif-toast-body">${_esc(n.body)}</div>`;

    if (n.job_id) {
      div.style.cursor = 'pointer';
      div.onclick = () => {
        App.openJobDetail(n.job_id);
        div.remove();
      };
    }

    container.appendChild(div);
    setTimeout(() => {
      div.classList.add('toast-out');
      setTimeout(() => div.remove(), 200);
    }, 5000);
  }

  // ──────────────────────────────────────────────────────────
  // SEND a notification (admin/dispatcher)
  // ──────────────────────────────────────────────────────────

  async function send({ title, body, jobId }) {
    try {
      await DB.createNotification({ title, body, jobId });
    } catch (e) {
      console.warn('Notifications.send error:', e.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────

  function _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function destroy() {
    if (_channel) {
      SupabaseClient.removeChannel(_channel);
      _channel = null;
    }
  }

  return {
    init,
    toggleDropdown,
    handleClick,
    markAllRead,
    send,
    destroy,
  };

})();
