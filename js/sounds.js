/**
 * NOTIFICATION SOUNDS MODULE
 * Web Audio API-based iPhone-style notification sounds
 * All sounds are 3-4 seconds long with proper envelopes
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
   * TRI-TONE - Classic iPhone message sound
   * Three descending tones with long decay
   */
  function playTriTone() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Three descending tones: E6, C#6, A5
    const frequencies = [1319, 1109, 880];
    const toneDuration = 0.25;
    const gapDuration = 0.05;

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.setValueAtTime(1, now);

    frequencies.forEach((freq, i) => {
      const startTime = now + (i * (toneDuration + gapDuration));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.connect(gain);
      gain.connect(masterGain);

      // Envelope for each tone
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gain.gain.linearRampToValueAtTime(0.1, startTime + toneDuration - 0.05);
      gain.gain.linearRampToValueAtTime(0, startTime + toneDuration);

      osc.start(startTime);
      osc.stop(startTime + toneDuration);
    });

    // Extended fade to reach 3-4 seconds total
    const totalDuration = 3.5;
    masterGain.gain.setValueAtTime(0.5, now + 1);
    masterGain.gain.linearRampToValueAtTime(0, now + totalDuration);
  }

  /**
   * CHIME - Single soft bell hit with natural decay
   * Bell-like harmonics with 3+ second decay
   */
  function playChime() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Bell-like harmonics
    const fundamentalFreq = 800;
    const harmonics = [1, 2.76, 5.4, 8.93]; // Bell harmonic ratios
    const harmonicGains = [1.0, 0.5, 0.25, 0.15];

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    harmonics.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(fundamentalFreq * ratio, now);
      osc.connect(gain);
      gain.connect(masterGain);

      // Individual harmonic envelope with long decay
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(harmonicGains[i] * 0.3, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);

      osc.start(now);
      osc.stop(now + 3.5);
    });

    // Master envelope
    masterGain.gain.setValueAtTime(1, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 3.5);
  }

  /**
   * PING - Short clean high ping with long reverb tail
   * Single frequency with slow decay to fill 3+ seconds
   */
  function playPing() {
    const ctx = getContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Sharp attack, very long decay to fill 3+ seconds
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.4, now + 0.002);
    gainNode.gain.setValueAtTime(0.3, now + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

    osc.start(now);
    osc.stop(now + 3.2);
  }

  /**
   * RADIAL - Two quick ascending tones with sustain
   * Extended with sustain to reach 3+ seconds
   */
  function playRadial() {
    const ctx = getContext();
    const now = ctx.currentTime;

    // Two ascending tones: C5, E5
    const frequencies = [523, 659];
    const toneDuration = 0.15;
    const gapDuration = 0.05;

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    frequencies.forEach((freq, i) => {
      const startTime = now + (i * (toneDuration + gapDuration));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.connect(gain);
      gain.connect(masterGain);

      // Envelope for each tone
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.01);
      gain.gain.setValueAtTime(0.2, startTime + toneDuration);

      osc.start(startTime);
      osc.stop(startTime + toneDuration + 2.5); // Extend oscillator
    });

    // Extended master fade to reach 3+ seconds
    const totalDuration = 3.3;
    masterGain.gain.setValueAtTime(1, now);
    masterGain.gain.setValueAtTime(0.8, now + 0.5);
    masterGain.gain.linearRampToValueAtTime(0, now + totalDuration);
  }

  // Main play function
  function play(soundName = 'tritone') {
    try {
      // Resume audio context if suspended (browser autoplay policy)
      const ctx = getContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      switch (soundName.toLowerCase()) {
        case 'tritone':
        case 'tri-tone':
          playTriTone();
          break;
        case 'chime':
          playChime();
          break;
        case 'ping':
          playPing();
          break;
        case 'radial':
          playRadial();
          break;
        case 'none':
        case 'silent':
          // Silent - do nothing
          break;
        default:
          console.warn('Unknown sound:', soundName, '- playing default tritone');
          playTriTone();
      }
    } catch (e) {
      console.error('Failed to play notification sound:', e.message);
    }
  }

  // Public API
  return {
    play,

    // Individual sound functions (can be called directly if needed)
    playTriTone,
    playChime,
    playPing,
    playRadial,
  };
})();

// Expose globally
window.NotificationSounds = NotificationSounds;
