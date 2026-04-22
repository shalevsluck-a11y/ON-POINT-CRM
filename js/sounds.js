/**
 * NOTIFICATION SOUNDS MODULE
 * Real MP3 notification sounds from Mixkit (royalty-free)
 * Sounds: tritone, chime, ping, bell
 */

const NotificationSounds = (() => {
  const SOUND_FILES = {
    tritone: '/public/sounds/tritone.mp3',
    chime: '/public/sounds/chime.mp3',
    ping: '/public/sounds/ping.mp3',
    bell: '/public/sounds/bell.mp3',
  };

  // Pre-load audio elements for faster playback
  const audioCache = {};

  function preload() {
    Object.keys(SOUND_FILES).forEach(key => {
      const audio = new Audio(SOUND_FILES[key]);
      audio.preload = 'auto';
      audioCache[key] = audio;
    });
  }

  /**
   * Play a notification sound
   * @param {string} soundName - One of: tritone, chime, ping, bell, none, silent
   */
  function play(soundName = 'tritone') {
    try {
      const key = soundName.toLowerCase().trim();

      // Silent sounds
      if (key === 'none' || key === 'silent') {
        return;
      }

      // Get audio element (from cache or create new)
      let audio = audioCache[key];
      if (!audio && SOUND_FILES[key]) {
        audio = new Audio(SOUND_FILES[key]);
        audioCache[key] = audio;
      }

      if (!audio) {
        console.warn('Unknown sound:', soundName, '- playing default tritone');
        audio = audioCache['tritone'] || new Audio(SOUND_FILES['tritone']);
      }

      // Reset to start and play
      audio.currentTime = 0;
      audio.volume = 0.7;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.warn('Failed to play notification sound:', e.message);
        });
      }
    } catch (e) {
      console.error('Error playing notification sound:', e.message);
    }
  }

  // Individual sound functions for backwards compatibility
  function playTriTone() { play('tritone'); }
  function playChime() { play('chime'); }
  function playPing() { play('ping'); }
  function playBell() { play('bell'); }

  // Public API
  return {
    play,
    playTriTone,
    playChime,
    playPing,
    playBell,
    preload,
  };
})();

// Expose globally
window.NotificationSounds = NotificationSounds;

// Pre-load sounds on page load for instant playback
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    NotificationSounds.preload();
  });
} else {
  NotificationSounds.preload();
}
