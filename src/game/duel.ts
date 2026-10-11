import type { BattleEvent, BattleSnapshot, InputView } from './battle';

/** First-stage trial values. Times use Round's paused game clock. */
export const DUEL_TUNING = { bossHp: 280, guardHp: 100, keysPerSecond: 4, grace: 1.6,
  minimumWindowMs: 8000, packetsMin: 3, packetsMax: 8, keysPerPacket: 10,
  chip: 2, keyDamage: 1, completionDamage: 12, cleanBonus: 4, recovery: 4,
  minimumPacketGapMs: 800 } as const;
type Window = NonNullable<BattleSnapshot['duel']> & { index: number; delivered: number; chips: number; damage: number };

/** The trial rewards partial input; it never consumes or locks keyboard input.
 * A corrected mistake can still finish a combo/parry; clean input adds a bonus.
 * Each tick delivers at most one small packet, reanchored after a delayed frame. */
export class Duel {
  readonly seed: number;
  private hp: number = DUEL_TUNING.bossHp;
  private guardHp: number = DUEL_TUNING.guardHp;
  private active = false;
  private window: Window | null = null;
  private nextMode: 'attack' | 'defend' = 'attack';
  private lastWord = -1;
  private lastTime = 0;
  private outcome: BattleSnapshot['outcome'] = null;
  private stats = { parries: 0, resolved: 0, cracks: 0, resets: 0, specials: 0 };
  constructor(seed: number) { this.seed = seed >>> 0; }
  routeWordDone(_word: { kana: number; durationMs: number }) {}
  startBoss(gameMs: number) { this.active = true; this.lastTime = gameMs; }
  private begin(gameMs: number, view: InputView) {
    const target = Math.max(1, view.remainingKeys ?? Math.ceil(view.remainingKana * 1.7));
    const duration = Math.max(DUEL_TUNING.minimumWindowMs, target / DUEL_TUNING.keysPerSecond * DUEL_TUNING.grace * 1000);
    const packets = Math.max(DUEL_TUNING.packetsMin, Math.min(DUEL_TUNING.packetsMax, Math.ceil(target / DUEL_TUNING.keysPerPacket)));
    const interval = Math.max(DUEL_TUNING.minimumPacketGapMs, duration / (packets + 2));
    this.window = { mode: this.nextMode, index: view.current.index, startedAt: gameMs, endsAt: gameMs + duration,
      accepted: 0, target, packets, remaining: packets, guarded: 0, delivered: 0, chips: 0, damage: 0,
      nextAt: gameMs + interval * 2, interval, guardHp: this.guardHp };
    this.nextMode = this.nextMode === 'attack' ? 'defend' : 'attack';
  }
  tick(gameMs: number, view: InputView): BattleEvent[] {
    if (!this.active || this.outcome || gameMs < this.lastTime) return [];
    this.lastTime = gameMs;
    if (!this.window) this.begin(gameMs, view);
    const window = this.window!, events: BattleEvent[] = [];
    // Completion at exactly endsAt is still in time. No catch-up burst on resume.
    if (gameMs > window.endsAt) {
      this.stats.resolved++;
      if (this.guardHp <= 0) { this.outcome = 'lost'; this.active = false; return [{ type: 'defeat' }]; }
      this.begin(gameMs, view); return events;
    }
    if (window.mode === 'defend' && window.remaining > 0 && gameMs >= window.nextAt) {
      const budget = Math.floor(window.accepted / Math.max(1, window.target) * window.packets);
      const guarded = window.guarded < budget;
      window.delivered++; window.remaining--; window.nextAt = gameMs + window.interval;
      if (guarded) window.guarded++;
      else { window.chips++; window.damage += DUEL_TUNING.chip; this.guardHp = Math.max(0, this.guardHp - DUEL_TUNING.chip); this.stats.cracks++; }
      events.push({ type: 'chip', amount: guarded ? 0 : DUEL_TUNING.chip, guarded });
    }
    return events;
  }
  /** Called only after Round accepts a physical key, before word completion.
   * `after` corrects the target for alternate romaji paths instead of rewarding
   * longer spellings less. Kana progress alone would miss intermediate letters. */
  acceptedKey(gameMs: number, before: InputView, after: InputView): BattleEvent[] {
    if (!this.active || this.outcome) return [];
    if (!this.window) this.begin(gameMs, before);
    const window = this.window!;
    window.accepted++;
    const remaining = after.current.index === before.current.index ? after.remainingKeys ?? Math.ceil(after.remainingKana * 1.7) : 0;
    window.target = window.accepted + remaining;
    // A longer supported spelling receives the same per-letter allowance.
    // Never shorten a deadline or move a packet already announced to the player.
    window.endsAt = Math.max(window.endsAt, window.startedAt + Math.max(DUEL_TUNING.minimumWindowMs,
      window.target / DUEL_TUNING.keysPerSecond * DUEL_TUNING.grace * 1000));
    this.hp = Math.max(0, this.hp - DUEL_TUNING.keyDamage);
    // Finish-word bonuses/parry must be resolved before victory on the last key.
    return [];
  }
  wordDone(word: { index: number; kana: number; clean: boolean; gameMs: number }, view: InputView): BattleEvent[] {
    if (!this.active || this.outcome || word.index <= this.lastWord) return [];
    this.lastWord = word.index;
    const window = this.window, events: BattleEvent[] = [];
    if (window && word.gameMs <= window.endsAt) {
      if (window.mode === 'defend') {
        this.guardHp = Math.min(DUEL_TUNING.guardHp, this.guardHp + window.damage + DUEL_TUNING.recovery);
        this.stats.cracks -= window.chips; this.stats.parries++;
        events.push({ type: 'parry' });
      } else events.push({ type: 'combo', clean: word.clean });
      this.stats.resolved++;
      const amount = DUEL_TUNING.completionDamage + (word.clean ? DUEL_TUNING.cleanBonus : 0);
      this.hp = Math.max(0, this.hp - amount); events.push({ type: 'damage', amount, special: null });
    }
    if (this.hp === 0) { this.active = false; this.outcome = 'cleared'; events.push({ type: 'victory' }); }
    else this.begin(word.gameMs, view);
    return events;
  }
  snapshot(): BattleSnapshot {
    const window = this.window;
    return { hp: this.hp, bossHp: DUEL_TUNING.bossHp, cracks: Math.min(2, Math.floor((100 - this.guardHp) / 34)),
      attack: this.active && window?.mode === 'defend' ? { marked: [window.index], completed: [], startedAt: window.startedAt, dueAt: window.endsAt } : null,
      ringStreak: 0, phase: 1, active: this.active, outcome: this.outcome, kanaPerSec: 2,
      stats: { ...this.stats }, ...(window ? { duel: { ...window, guardHp: this.guardHp } } : {}) };
  }
}
