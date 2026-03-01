let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function noise(ctx: AudioContext, duration: number): AudioBufferSourceNode {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

export function playDiceRoll(): void {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // Multiple short bursts of filtered noise to simulate dice clattering
    for (let i = 0; i < 6; i++) {
      const t = now + i * 0.06 + Math.random() * 0.03;
      const n = noise(ctx, 0.08);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800 + Math.random() * 2400;
      bp.Q.value = 2.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12 + Math.random() * 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      n.connect(bp).connect(gain).connect(ctx.destination);
      n.start(t);
      n.stop(t + 0.08);
    }

    // Underlying rumble
    const rumble = noise(ctx, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(0.06, now);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    rumble.connect(lp).connect(rGain).connect(ctx.destination);
    rumble.start(now);
    rumble.stop(now + 0.5);
  } catch {
    // Audio not available
  }
}

export function playDiceLand(): void {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // Thump - low frequency impact
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);

    // Short noise burst for the surface contact
    const n = noise(ctx, 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 600;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.08, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    n.connect(hp).connect(nGain).connect(ctx.destination);
    n.start(now);
    n.stop(now + 0.06);
  } catch {
    // Audio not available
  }
}

export function playScoreEntry(): void {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // Pen scratch / stamp sound
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.04;
      const n = noise(ctx, 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 3000 + i * 500;
      bp.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      n.connect(bp).connect(gain).connect(ctx.destination);
      n.start(t);
      n.stop(t + 0.05);
    }

    // Stamp thud
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(200, now + 0.02);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(g).connect(ctx.destination);
    osc.start(now + 0.02);
    osc.stop(now + 0.13);
  } catch {
    // Audio not available
  }
}

export function playKniffelFanfare(): void {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // Triumphant chord progression: C-E-G-C
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const t = now + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
      gain.gain.setValueAtTime(0.15, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.85);
    });

    // Final shimmer
    const shimmer = noise(ctx, 0.6);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6000;
    const sGain = ctx.createGain();
    const sTime = now + 0.4;
    sGain.gain.setValueAtTime(0, sTime);
    sGain.gain.linearRampToValueAtTime(0.04, sTime + 0.1);
    sGain.gain.exponentialRampToValueAtTime(0.001, sTime + 0.55);
    shimmer.connect(hp).connect(sGain).connect(ctx.destination);
    shimmer.start(sTime);
    shimmer.stop(sTime + 0.6);
  } catch {
    // Audio not available
  }
}

export function playCelebration(): void {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;

    // Quick ascending arpeggio
    const notes = [440, 554.37, 659.25];
    notes.forEach((freq, i) => {
      const t = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch {
    // Audio not available
  }
}
