// Sound for Neon Harbor, synthesized live with WebAudio — no audio files,
// so the game stays fully offline and self-contained.
//
// Everything is an oscillator or filtered noise started on demand: engine
// hum that follows the car's speed, a two-tone police siren while wanted,
// a punch thud, a pickup blip and a little mission-complete arpeggio.
// AudioContext only starts after the first user gesture (the Start button),
// as browsers require; until then every call is a safe no-op.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let sirenHigh = false;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!ensure() || muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  return {
    // Call from the Start button's click handler.
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = value ? 0 : 0.5;
      if (value) this.stopEngine();
    },
    isMuted() {
      return muted;
    },
    // Continuous engine hum; speed is 0..1 of top speed.
    engine(speed, driving) {
      if (!ensure() || muted) return;
      if (!driving) {
        this.stopEngine();
        return;
      }
      if (!engineOsc) {
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineGain = ctx.createGain();
        engineGain.gain.value = 0.04;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        engineOsc.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
      }
      engineOsc.frequency.value = 55 + speed * 130;
      engineGain.gain.value = 0.03 + speed * 0.05;
    },
    stopEngine() {
      if (engineOsc) {
        try { engineOsc.stop(); } catch { /* already stopped */ }
        engineOsc = null;
        engineGain = null;
      }
    },
    // Call every frame while wanted; dt in seconds.
    siren(dt, wanted) {
      if (!ensure() || muted || wanted <= 0) {
        if (sirenOsc) {
          try { sirenOsc.stop(); } catch { /* already stopped */ }
          sirenOsc = null;
          sirenGain = null;
        }
        return;
      }
      if (!sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'sine';
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0.035;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        sirenTimer = 0;
        sirenHigh = false;
      }
      sirenTimer += dt;
      if (sirenTimer > 0.45) {
        sirenTimer = 0;
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.value = sirenHigh ? 880 : 660;
      }
    },
    punch() {
      noiseBurst(0.12, 0.5, 300);
      tone(90, 0.12, 'sine', 0.4);
    },
    hit() {
      noiseBurst(0.15, 0.4, 500);
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.35);
      tone(990, 0.14, 'sine', 0.35, 0.09);
    },
    missionComplete() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.35, i * 0.11));
    },
    missionFail() {
      [330, 262, 196].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.2, i * 0.14));
    },
    busted() {
      [440, 415, 392, 370].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.22, i * 0.18));
    },
    click() {
      tone(800, 0.05, 'square', 0.15);
    },
  };
}
