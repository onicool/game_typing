/** Short operation and battle effects only. Ordinary BGM lives in music.ts. */

const DEFAULT_VOLUME = 0.7;
const MASTER_GAIN = 0.55 / DEFAULT_VOLUME;


export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
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

  /** A fixed, brief key confirmation; speed and combo do not compose music. */
  key(_stage: number, _critical: boolean, _comboTier = 0) {
    this.play(() => {
      const ctx = this.live();
      if (ctx) this.voice(ctx.currentTime, 'sine', 880, 0.035, 0.035, 3000);
    });
  }

  miss() {
    this.play(() => this.synthMiss());
  }

  comboBreak() {
    this.play(() => {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime, tone = ctx.createOscillator(), gain = ctx.createGain();
      tone.type = 'sine'; tone.frequency.setValueAtTime(440, t);
      tone.frequency.exponentialRampToValueAtTime(220, t + .12);
      gain.gain.setValueAtTime(.06, t); gain.gain.exponentialRampToValueAtTime(.001, t + .14);
      tone.connect(gain); gain.connect(this.master); tone.start(t); tone.stop(t + .16);
    });
  }

  /** Theatrical enemy cues; optional and independent of BGM playback. */
  combatCue(kind: 'windup' | 'guard' | 'impact') {
    this.play(() => {
      const ctx = this.live();
      if (!ctx) return;
      const t = ctx.currentTime, tone = ctx.createOscillator(), gain = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(kind === 'windup' ? 220 : kind === 'guard' ? 660 : 140, t);
      gain.gain.setValueAtTime(.045, t);
      gain.gain.exponentialRampToValueAtTime(.001, t + .16);
      tone.connect(gain); gain.connect(this.master); tone.start(t); tone.stop(t + .18);
    });
  }

  battleCue(kind: 'windup' | 'parry' | 'crack' | 'special' | 'victory') {
    this.play(() => {
      const ctx = this.live(); if (!ctx) return;
      const t = ctx.currentTime;
      const notes = { windup: [220], parry: [660, 880], crack: [140, 92], special: [660, 990, 1320], victory: [523.25, 659.25, 783.99] }[kind];
      notes.forEach((freq, i) => this.voice(t + i * .045, 'sine', freq, kind === 'victory' ? .5 : .2, .045, 8000));
    });
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

  /** Brief word-completion cue, independent of music and typing speed. */
  word(_stage: number) {
    this.play(() => {
      const ctx = this.live();
      if (ctx) this.voice(ctx.currentTime, 'sine', 660, 0.08, 0.045, 3000);
    });
  }

  /** Whole firewall destroyed. */
  breach() {
    this.play(() => this.synthBreach());
  }

  private synthBreach() {
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
