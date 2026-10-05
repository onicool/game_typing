/**
 * Procedural synth audio. Every sound starts inside the keydown handler with no
 * scheduling delay: the music follows the player, never the other way round.
 *
 * - each accepted key: a short tone from the current chord (arpeggiator style,
 *   so any typing speed stays consonant)
 * - each completed word: the progression advances one chord, with layers that
 *   stack up with the overclock stage
 */

const PROGRESSIONS: number[][][] = [
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am–F–C–G
  [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], // Am–G–F–E
  [[50, 53, 57], [57, 60, 64], [53, 57, 60], [55, 59, 62]], // Dm–Am–F–G
];
const DEFAULT_VOLUME = 0.7;
const MASTER_GAIN = 0.55 / DEFAULT_VOLUME;
const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]; // up-down over two octaves of chord tones

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private chordIdx = 0;
  private arpIdx = 0;
  private progressionIdx = 0;
  private _enabled = true;
  private _volume = DEFAULT_VOLUME;
  private failed = false;
  private resuming: AudioContext | null = null;
  onAvailabilityChange?: () => void;

  get unavailable(): boolean { return this.failed; }

  get enabled(): boolean { return this._enabled; }
  set enabled(enabled: boolean) {
    // A deliberate off → on gesture retries; typing must never retry a failed
    // device on every key or change the user's saved sound preference.
    if (enabled && !this._enabled && this.failed) {
      this.failed = false;
      this._enabled = enabled;
      this.onAvailabilityChange?.();
    }
    this._enabled = enabled;
    this.play(() => this.rampMaster());
  }

  get volume(): number { return this._volume; }
  setVolume(v: number) {
    this._volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    this.play(() => this.rampMaster());
  }

  private rampMaster() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gain = this.master.gain;
    // Hold the instantaneous gain when another change interrupts a ramp.
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(t);
    else {
      const current = gain.value;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(current, t);
    }
    gain.linearRampToValueAtTime(this._enabled ? this._volume * MASTER_GAIN : 0, t + 0.03);
  }

  /** Must be called from a user gesture (first keydown). */
  ensure() {
    if (!this.enabled || this.volume === 0 || this.failed) return;
    try {
      if (this.ctx?.state === 'closed') this.ctx = null;
      if (!this.ctx) this.initialize();
      const ctx = this.ctx!;
      if (ctx.state !== 'running' && this.resuming !== ctx) {
        this.resuming = ctx;
        void ctx.resume().catch(() => this.fail(ctx)).finally(() => {
          if (this.resuming === ctx) this.resuming = null;
        });
      }
    } catch {
      this.fail(this.ctx);
    }
  }

  private initialize() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = this._enabled ? this._volume * MASTER_GAIN : 0;
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
      // Publish only a complete graph. A failed allocation cannot leave a half
      // initialised context behind for volume changes or the next key.
      this.ctx = ctx;
    } catch (error) {
      this.close(ctx);
      throw error;
    }
  }

  private close(ctx: AudioContext) {
    try { void ctx.close().catch(() => {}); } catch { /* already unavailable */ }
  }

  private fail(ctx: AudioContext | null) {
    if (ctx && ctx !== this.ctx) return; // Ignore an obsolete resume rejection.
    this.ctx = null;
    this.resuming = null;
    if (ctx) this.close(ctx);
    if (!this.failed) {
      this.failed = true;
      this.onAvailabilityChange?.();
    }
  }

  private play(effect: () => void) {
    const ctx = this.ctx;
    try { effect(); } catch { this.fail(ctx); }
  }

  reset() {
    this.progressionIdx = 0;
    this.chordIdx = 0;
    this.arpIdx = 0;
  }

  /** Accepted keystroke. stage = overclock 0..3 */
  key(stage: number, critical: boolean) {
    this.play(() => this.synthKey(stage, critical));
  }

  private synthKey(stage: number, critical: boolean) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const chord = PROGRESSIONS[this.progressionIdx][this.chordIdx];
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
    this.noiseBurst(t, 0.01 + Math.random() * 0.003, 5400 + Math.random() * 1200, 0.022 + Math.random() * 0.008, 'highpass');

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
    this.play(() => this.synthMiss());
  }

  private synthMiss() {
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
    this.play(() => this.synthWord(stage));
  }

  private synthWord(stage: number) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.chordIdx = (this.chordIdx + 1) % PROGRESSIONS[this.progressionIdx].length;
    this.arpIdx = 0;
    const chord = PROGRESSIONS[this.progressionIdx][this.chordIdx];

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
    this.play(() => this.synthBreach());
  }

  private synthBreach() {
    // Advance even while muted so the music still follows gameplay.
    this.progressionIdx = (this.progressionIdx + 1) % PROGRESSIONS.length;
    this.chordIdx = 0;
    this.arpIdx = 0;
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.thump(t, 0.5);
    this.noiseBurst(t, 0.6, 4400 + Math.random() * 1200, 0.175, 'lowpass', 250 + Math.random() * 150);
  }

  private live(): AudioContext | null {
    return this.enabled && this.volume > 0 && this.ctx?.state === 'running' ? this.ctx : null;
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
