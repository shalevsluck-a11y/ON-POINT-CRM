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
   * SOUND 1: iPhone New Mail
   * The most recognized notification sound on earth
   * Single clean bell tone at 1174hz (D6) with slight harmonic at 2348hz
   * Attack: 0.001s, Decay: 1.2s, Pure sine wave
   */
  function playChime() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Main tone: 1174hz (D6)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 1174;

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.001); // 1ms attack
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.2); // 1.2s decay

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 1.25);

    // Harmonic: 2348hz at 20% volume
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 2348;

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.001); // 20% of main volume
    gain2.gain.exponentialRampToValueAtTime(0.0002, now + 1.2);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 1.25);
  }

  /**
   * SOUND 2: Android Default Notification (Pixie Dust)
   * Used by billions of Android phones by default
   * Quick ascending three-note melody
   * Note 1: 880hz for 0.08s
   * Note 2: 1108hz for 0.08s
   * Note 3: 1318hz for 0.12s
   */
  function playBell() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Note 1: 880hz for 0.08s
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 880;

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.005); // Fast attack
    gain1.gain.linearRampToValueAtTime(0, now + 0.08); // Quick decay

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.09);

    // Note 2: 1108hz for 0.08s
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 1108;

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.085);
    gain2.gain.linearRampToValueAtTime(0, now + 0.16);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.17);

    // Note 3: 1318hz for 0.12s
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = 1318;

    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0, now + 0.16);
    gain3.gain.linearRampToValueAtTime(0.3, now + 0.165);
    gain3.gain.linearRampToValueAtTime(0, now + 0.28);

    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.16);
    osc3.stop(now + 0.29);
  }

  /**
   * SOUND 3: Emergency Alert Sound
   * The attention signal used by emergency broadcast systems
   * Loud alternating tone between 853hz and 960hz
   * Switches every 0.1s for 0.8s total
   * High volume - guarantees attention even across the room
   */
  function playPop() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Alternating between 853hz and 960hz, 4 switches total (0.8s)
    const frequencies = [853, 960, 853, 960, 853, 960, 853, 960];

    for (let i = 0; i < 8; i++) {
      const startTime = now + (i * 0.1);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequencies[i];

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.005); // High volume
      gain.gain.setValueAtTime(0.5, startTime + 0.095);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.11);
    }
  }

  /**
   * SOUND 4: Slack Notification
   * Used by millions of professionals every day
   * Warm low pop followed by slightly higher ring
   * First tone: 440hz (A4) for 0.06s with soft attack
   * Second tone: 554hz (C#5) for 0.15s with medium attack and slow decay
   */
  function playDing() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // First tone: 440hz for 0.06s
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 440;

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.01); // Soft attack
    gain1.gain.linearRampToValueAtTime(0, now + 0.06);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.07);

    // Second tone: 554hz for 0.15s
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 554;

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.06);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.08); // Medium attack
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.21); // Slow decay

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.22);
  }

  /**
   * SOUND 5: Silent
   * No sound at all
   */
  function playSwoosh() {
    // Silent option - do nothing
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
