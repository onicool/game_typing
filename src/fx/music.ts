export interface MusicTrack { title: string; url: string }

/** One ordinary looping player. Typing, combos and tempo never control it. */
export class Music {
  private player: HTMLAudioElement | null = null;
  private track: MusicTrack | null = null;
  private active = false;
  private started = false;
  private pending = false;
  private generation = 0;
  private failed = false;
  private _enabled = true;
  private _volume = 0.35;
  onChange?: () => void;

  constructor(private readonly createPlayer = () => {
    const player = document.createElement('audio');
    player.id = 'bgm-player';
    player.preload = 'none';
    document.body.append(player);
    return player;
  }) {}

  get enabled() { return this._enabled; }
  get volume() { return this._volume; }
  get title() { return this.track?.title ?? ''; }
  get status(): 'idle' | 'muted' | 'paused' | 'playing' | 'unavailable' {
    if (!this.started) return 'idle';
    if (!this.enabled || this.volume === 0) return 'muted';
    if (this.failed) return 'unavailable';
    return this.active && this.player && !this.player.paused ? 'playing' : 'paused';
  }

  /** Call synchronously from the user's start/retry action, never at page load. */
  start(track: MusicTrack) {
    this.pause();
    this.track = track;
    this.started = true;
    this.failed = false;
    try {
      const player = this.player ??= this.createPlayer();
      player.loop = true;
      player.playbackRate = 1;
      player.src = track.url;
      player.currentTime = 0;
      player.onplaying = () => this.onChange?.();
      player.onpause = () => this.onChange?.();
      player.onerror = () => { this.failed = true; this.pausePlayer(); this.onChange?.(); };
      this.resume();
    } catch { this.failed = true; this.onChange?.(); }
  }

  setEnabled(enabled: boolean) {
    if (enabled && !this._enabled) this.failed = false;
    this._enabled = enabled;
    this.sync();
  }

  setVolume(volume: number) {
    const previous = this._volume;
    this._volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    if (previous === 0 && this._volume > 0) this.failed = false;
    this.sync();
  }

  pause() {
    this.active = false;
    this.generation++;
    this.pending = false;
    this.pausePlayer();
    this.onChange?.();
  }

  resume() { this.active = true; this.sync(); }

  stop() {
    this.pause();
    this.started = false;
    this.track = null;
    if (this.player) {
      this.player.onerror = null;
      this.player.removeAttribute('src');
      this.player.load();
    }
    this.onChange?.();
  }

  private pausePlayer() { try { this.player?.pause(); } catch { /* optional audio */ } }

  private sync() {
    const player = this.player;
    if (!player || !this.started) { this.onChange?.(); return; }
    try {
      player.volume = this.volume;
      player.muted = !this.enabled || this.volume === 0;
      if (!this.active || player.muted || this.failed) {
        this.generation++;
        this.pending = false;
        this.pausePlayer();
      } else if (player.paused && !this.pending) {
        const generation = ++this.generation;
        this.pending = true;
        void player.play().then(() => {
          // A pause, mute, navigation or new track may have superseded this play.
          if (!this.started || !this.active || !this.enabled || this.volume === 0) this.pausePlayer();
          if (generation === this.generation) this.onChange?.();
        }).catch(() => {
          if (generation === this.generation) { this.failed = true; this.pausePlayer(); this.onChange?.(); }
        }).finally(() => { if (generation === this.generation) this.pending = false; });
      }
    } catch { this.failed = true; this.pending = false; this.pausePlayer(); }
    this.onChange?.();
  }
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { title: '同じ空を阻む翼', url: '/audio/music/boss/stage_01_boss_sera.mp3' },
  { title: '威張る金貨と踊る風', url: '/audio/music/boss/stage_02_boss_steward.mp3' },
  { title: '奪う手と待つ灯', url: '/audio/music/boss/stage_03_boss_nico.mp3' },
  { title: 'ひとつの瓶、ふたつの流れ', url: '/audio/music/boss/stage_04_boss_marta.mp3' },
  { title: '拍手を奪う仮面', url: '/audio/music/boss/stage_05_boss_vel.mp3' },
  { title: '最後の橋に立つ盾', url: '/audio/music/boss/stage_06_boss_isaac.mp3' },
  { title: '白き光が問い返す', url: '/audio/music/boss/stage_07_boss_aster.mp3' },
];
