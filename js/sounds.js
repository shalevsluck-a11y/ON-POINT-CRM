/**
 * NOTIFICATION SOUNDS MODULE
 * Web Audio API-based notification sounds (no external files needed)
 * All sounds are generated procedurally using proven alert sound patterns
 * from the most popular apps and devices in the world
 */

const NotificationSounds = (() => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  // Initialize Audio Context on first use (prevents autoplay issues)
  function getContext() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  /**
   * SOUND 1: WhatsApp Classic
   * Quick double ding similar to WhatsApp default notification
   */
  function playChime() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // First ding: 880Hz
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 880;

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.4, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Second ding: 1174Hz (slightly higher)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 1174;

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.26);
  }

  /**
   * SOUND 2: WhatsApp Tri-Tone
   * Three ascending notes similar to WhatsApp group notification
   */
  function playBell() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const notes = [659, 784, 988]; // E5, G5, B5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const start = now + (i * 0.1);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  }

  /**
   * SOUND 3: WhatsApp Pop
   * Single quick pop similar to WhatsApp message sent sound
   */
  function playPop() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * SOUND 4: WhatsApp Swoosh
   * Descending tone similar to WhatsApp call notification
   */
  function playDing() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  /**
   * SOUND 5: WhatsApp Chime
   * Pleasant melodic tone similar to WhatsApp status update
   */
  function playSwoosh() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Play C-E-G chord
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.41);
    });
  }

  // Main play function
  function play(soundName = 'chime') {
    try {
      // Resume audio context if suspended (browser autoplay policy)
      const ctx = getContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      switch (soundName.toLowerCase()) {
        case 'chime':
          playChime();
          break;
        case 'bell':
          playBell();
          break;
        case 'pop':
          playPop();
          break;
        case 'ding':
          playDing();
          break;
        case 'swoosh':
          playSwoosh();
          break;
        case 'none':
        case 'silent':
          // Silent - do nothing
          break;
        default:
          console.warn('Unknown sound:', soundName, '- playing default chime');
          playChime();
      }
    } catch (e) {
      console.error('Failed to play notification sound:', e.message);
    }
  }

  // Public API
  return {
    play,

    // Individual sound functions (can be called directly if needed)
    playChime,
    playBell,
    playPop,
    playDing,
    playSwoosh,
  };
})();

// Expose globally
window.NotificationSounds = NotificationSounds;
