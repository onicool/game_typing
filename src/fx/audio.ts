/**
 * Procedural synth audio. Every sound starts inside the keydown handler with no
 * scheduling delay: the music follows the player, never the other way round.
 *
 * - each accepted key: a short tone from the current chord (arpeggiator style,
 *   so any typing speed stays consonant)
 * - each completed word: the progression advances one chord, with layers that
 *   stack up with the overclock stage
 */

const PROGRESSION: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]; // up-down over two octaves of chord tones

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private chordIdx = 0;
  private arpIdx = 0;
  enabled = true;

  /** Must be called from a user gesture (first keydown). */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);

    // feedback delay for a little neon space
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.22;
    this.delaySend.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.master);

    const len = ctx.sampleRate * 1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  reset() {
    this.chordIdx = 0;
    this.arpIdx = 0;
  }

  /** Accepted keystroke. stage = overclock 0..3 */
  key(stage: number, critical: boolean) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const chord = PROGRESSION[this.chordIdx];
    const step = ARP[this.arpIdx % ARP.length];
    this.arpIdx++;
    const midi = chord[step % 3] + 12 * Math.floor(step / 3) + 12;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800 + stage * 1400;
    filter.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    filter.connect(g);
    g.connect(this.master);
    g.connect(this.delaySend);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = mtof(midi);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = mtof(midi) * 1.003;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o1.connect(filter);
    o2.connect(g2).connect(filter);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.2);
    o2.stop(t + 0.2);

    // tiny transient click so fast typing still feels percussive
    this.noiseBurst(t, 0.012, 6000, 0.05, 'highpass');

    if (critical) {
      const s = ctx.createOscillator();
      s.type = 'sine';
      s.frequency.value = mtof(midi + 24);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.08, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      s.connect(sg);
      sg.connect(this.master);
      sg.connect(this.delaySend);
      s.start(t);
      s.stop(t + 0.3);
    }
  }

  miss() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.07, 700, 0.22, 'bandpass');
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(92, t);
    o.frequency.linearRampToValueAtTime(70, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Word completed: advance the progression and play the accompaniment layers. */
  word(stage: number) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.chordIdx = (this.chordIdx + 1) % PROGRESSION.length;
    this.arpIdx = 0;
    const chord = PROGRESSION[this.chordIdx];

    // shatter
    this.noiseBurst(t, 0.18, 3200, 0.16, 'bandpass', 900);

    // bass (always)
    this.voice(t, 'sawtooth', mtof(chord[0] - 24), 0.5, 0.2, 500 + stage * 300);
    // pad stab from stage 1
    if (stage >= 1) for (const n of chord) this.voice(t, 'sawtooth', mtof(n), 0.35, 0.05, 1400 + stage * 500);
    // sub thump from stage 2
    if (stage >= 2) this.thump(t, 0.18);
    // sparkle from stage 3
    if (stage >= 3) for (let i = 0; i < 3; i++) this.voice(t + i * 0.06, 'sine', mtof(chord[i] + 24), 0.18, 0.05, 8000, true);
  }

  /** Whole firewall destroyed. */
  breach() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.thump(t, 0.5);
    this.noiseBurst(t, 0.6, 5000, 0.25, 'lowpass', 300);
  }

  private live(): AudioContext | null {
    return this.enabled && this.ctx ? this.ctx : null;
  }

  private voice(t: number, type: OscillatorType, freq: number, dur: number, vol: number, cutoff: number, send = false) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.master);
    if (send) g.connect(this.delaySend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private thump(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
