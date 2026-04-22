/**
 * NOTIFICATION SOUNDS MODULE
 * Web Audio API-based notification sounds (no external files needed)
 * All sounds are generated procedurally
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

  // Helper: Create oscillator
  function createOscillator(ctx, freq, type = 'sine') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  // Helper: Create gain envelope
  function createGain(ctx, startTime, attack, decay, sustain, release, maxGain = 0.3) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(maxGain, startTime + attack);
    gain.gain.linearRampToValueAtTime(sustain * maxGain, startTime + attack + decay);
    gain.gain.setValueAtTime(sustain * maxGain, startTime + attack + decay + 0.1);
    gain.gain.linearRampToValueAtTime(0, startTime + attack + decay + 0.1 + release);
    return gain;
  }

  // SOUND 1: Chime (default) - Pleasant bell-like tone
  function playChime() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Three harmonics for a chime effect
    const freqs = [800, 1200, 1600];
    freqs.forEach((freq, i) => {
      const osc = createOscillator(ctx, freq, 'sine');
      const gain = createGain(ctx, now, 0.01, 0.05, 0.3, 0.4, 0.15 / (i + 1));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    });
  }

  // SOUND 2: Bell - Classic notification bell
  function playBell() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Bell harmonics
    const freqs = [520, 1040, 1560, 2080];
    freqs.forEach((freq, i) => {
      const osc = createOscillator(ctx, freq, 'sine');
      const gain = createGain(ctx, now, 0.005, 0.02, 0.2, 0.3, 0.2 / (i + 1));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    });
  }

  // SOUND 3: Pop - Short, punchy notification
  function playPop() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = createOscillator(ctx, 1200, 'sine');
    const gain = ctx.createGain();

    // Quick attack and decay for "pop" effect
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    // Frequency sweep down for pop effect
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  // SOUND 4: Ding - Clear single tone
  function playDing() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = createOscillator(ctx, 1000, 'sine');
    const gain = createGain(ctx, now, 0.01, 0.1, 0.4, 0.5, 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.7);
  }

  // SOUND 5: Swoosh - Smooth rising tone
  function playSwoosh() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = createOscillator(ctx, 400, 'sine');
    const gain = ctx.createGain();

    // Frequency sweep up for swoosh effect
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);

    // Gentle envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.2);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
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
