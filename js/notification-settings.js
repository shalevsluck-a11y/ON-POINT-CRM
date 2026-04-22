/* ============================================================
   NOTIFICATION SETTINGS - Ringtone Picker UI
   ============================================================ */

const NotificationSettings = (() => {

  const SOUNDS = [
    { id: 'chime', name: 'Chime', file: '/assets/sounds/chime.mp3' },
    { id: 'bell', name: 'Bell', file: '/assets/sounds/bell.mp3' },
    { id: 'alert', name: 'Alert', file: '/assets/sounds/alert.mp3' },
    { id: 'tone', name: 'Digital Tone', file: '/assets/sounds/tone.mp3' }
  ];

  let _currentSound = 'chime'; // default
  let _audioPreview = null;

  // ──────────────────────────────────────────────────────────
  // INIT - Load saved preference
  // ──────────────────────────────────────────────────────────

  function init() {
    const saved = localStorage.getItem('notif-sound');
    if (saved && SOUNDS.find(s => s.id === saved)) {
      _currentSound = saved;
    } else {
      _currentSound = 'chime';
      localStorage.setItem('notif-sound', _currentSound);
    }
  }

  // ──────────────────────────────────────────────────────────
  // GET CURRENT SOUND FILE
  // ──────────────────────────────────────────────────────────

  function getCurrentSoundFile() {
    const sound = SOUNDS.find(s => s.id === _currentSound);
    return sound ? sound.file : SOUNDS[0].file;
  }

  function getCurrentSoundId() {
    return _currentSound;
  }

  // ──────────────────────────────────────────────────────────
  // PLAY PREVIEW
  // ──────────────────────────────────────────────────────────

  function playPreview(soundId) {
    const sound = SOUNDS.find(s => s.id === soundId);
    if (!sound) return;

    // Stop any currently playing preview
    if (_audioPreview) {
      _audioPreview.pause();
      _audioPreview.currentTime = 0;
    }

    _audioPreview = new Audio(sound.file);
    _audioPreview.volume = 0.7;
    _audioPreview.play().catch(e => console.warn('Preview play failed:', e));
  }

  // ──────────────────────────────────────────────────────────
  // SELECT SOUND
  // ──────────────────────────────────────────────────────────

  function selectSound(soundId) {
    const sound = SOUNDS.find(s => s.id === soundId);
    if (!sound) return;

    _currentSound = soundId;
    localStorage.setItem('notif-sound', soundId);

    console.log(`[NotificationSettings] Sound changed to: ${sound.name}`);

    // Update UI
    renderPicker();
  }

  // ──────────────────────────────────────────────────────────
  // RENDER PICKER UI
  // ──────────────────────────────────────────────────────────

  function renderPicker() {
    const container = document.getElementById('notification-settings-container');
    if (!container) return;

    const isExpanded = container.classList.contains('expanded');

    const html = `
      <div class="notification-settings-card">
        <div class="notification-settings-header" onclick="NotificationSettings.toggleExpanded()">
          <div class="notification-settings-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 6 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span>Notification Sound</span>
          </div>
          <div class="notification-settings-current">
            ${SOUNDS.find(s => s.id === _currentSound)?.name || 'Chime'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate(${isExpanded ? '180deg' : '0deg'}); transition: transform 0.2s">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>

        ${isExpanded ? `
          <div class="notification-settings-options">
            ${SOUNDS.map(sound => `
              <div class="notification-option ${sound.id === _currentSound ? 'selected' : ''}"
                   onclick="NotificationSettings.selectSound('${sound.id}')">
                <div class="notification-option-info">
                  <div class="notification-option-name">${sound.name}</div>
                  ${sound.id === _currentSound ? '<div class="notification-option-check">✓</div>' : ''}
                </div>
                <button class="notification-preview-btn"
                        onclick="event.stopPropagation(); NotificationSettings.playPreview('${sound.id}')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Preview
                </button>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  }

  function toggleExpanded() {
    const container = document.getElementById('notification-settings-container');
    if (!container) return;

    container.classList.toggle('expanded');
    renderPicker();
  }

  function showInSettings() {
    // Insert the picker into the settings view
    const settingsContent = document.querySelector('#view-settings .view-content');
    if (!settingsContent) return;

    // Check if already exists
    if (document.getElementById('notification-settings-container')) {
      return;
    }

    const container = document.createElement('div');
    container.id = 'notification-settings-container';
    container.className = '';

    // Insert after the first section (admin users)
    const firstSection = settingsContent.querySelector('.settings-section');
    if (firstSection && firstSection.nextSibling) {
      settingsContent.insertBefore(container, firstSection.nextSibling);
    } else {
      settingsContent.appendChild(container);
    }

    renderPicker();
  }

  return {
    init,
    getCurrentSoundFile,
    getCurrentSoundId,
    playPreview,
    selectSound,
    toggleExpanded,
    showInSettings,
    renderPicker
  };

})();

// Auto-initialize
if (typeof window !== 'undefined') {
  window.NotificationSettings = NotificationSettings;
  document.addEventListener('DOMContentLoaded', () => {
    NotificationSettings.init();
  });
}
