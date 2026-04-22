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

  // SOUND 1: iMessage style (default) - iconic iPhone message sound
  // Two-tone ping: 1318hz→1760hz sweep, then 1760hz held
  function playChime() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = createOscillator(ctx, 1318, 'sine');
    const gain = ctx.createGain();

    // Frequency sweep from 1318hz to 1760hz over 0.15s
    osc.frequency.setValueAtTime(1318, now);
    osc.frequency.linearRampToValueAtTime(1760, now + 0.15);
    // Hold at 1760hz for 0.1s (total 0.25s)

    // Clean envelope - quick attack, smooth fadeout
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain.gain.setValueAtTime(0.3, now + 0.2);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  // SOUND 2: WhatsApp style - double pop (880hz then 740hz)
  function playBell() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // First pop: 880hz for 0.05s
    const osc1 = createOscillator(ctx, 880, 'sine');
    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.005);
    gain1.gain.linearRampToValueAtTime(0, now + 0.05);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.06);

    // Second pop: 740hz for 0.05s (slight overlap)
    const osc2 = createOscillator(ctx, 740, 'sine');
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.045);
    gain2.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain2.gain.linearRampToValueAtTime(0, now + 0.1);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.045);
    osc2.stop(now + 0.11);
  }

  // SOUND 3: Telegram style - clean short pop at 1046hz
  function playPop() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = createOscillator(ctx, 1046, 'sine');
    const gain = ctx.createGain();

    // Very fast attack, moderate decay
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  // SOUND 4: Urgent alert - three quick beeps at 1400hz
  function playDing() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Three beeps, each 0.12s with 0.08s gaps
    for (let i = 0; i < 3; i++) {
      const startTime = now + (i * 0.2); // 0.12s beep + 0.08s gap = 0.2s interval
      const osc = createOscillator(ctx, 1400, 'sine');
      const gain = ctx.createGain();

      // Sharp attack for urgency
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gain.gain.setValueAtTime(0.3, startTime + 0.1);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.13);
    }
  }

  // SOUND 5: Silent - no sound
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
