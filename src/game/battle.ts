import type { Character } from './journey';

export type Difficulty = 'standard' | 'challenge' | 'seraph';
export const SERAPH_VERSION = 1;
export const isDifficulty = (v: unknown): v is Difficulty => v === 'standard' || v === 'challenge' || v === 'seraph';
/** Older normal records need no new field. Unknown hard rules cannot compete. */
export const isCompatibleDifficulty = (meta: { difficulty?: unknown; seraphVersion?: unknown }): boolean =>
  isDifficulty(meta.difficulty) && (meta.difficulty !== 'seraph' || meta.seraphVersion === SERAPH_VERSION);
export const difficultyText = (d: unknown): string => d === 'standard' ? '標準' : d === 'challenge' ? '挑戦' : d === 'seraph' ? '熾天' : '未対応の難度';
export interface BattleConfig { character: Character; difficulty: Difficulty; bossHp: number; seed: number; initialKanaPerSec?: number }
export interface WordView { index: number; kana: number }
export interface InputView { current: WordView; remainingKana: number; previews: [WordView, WordView] }
export type BattleEvent =
  | { type: 'damage'; amount: number; special: 'judgment' | 'ring' | null }
  | { type: 'windup'; marked: number[]; dueAt: number }
  | { type: 'parry' } | { type: 'crack'; cracks: number } | { type: 'restore'; cracks: number }
  | { type: 'prayer-reset' } | { type: 'phase2' } | { type: 'victory' } | { type: 'defeat' };
export interface BattleAttack { marked: number[]; completed: number[]; startedAt: number; dueAt: number }
export interface BattleSnapshot {
  hp: number; bossHp: number; cracks: number; attack: BattleAttack | null; ringStreak: number;
  phase: 1 | 2; active: boolean; outcome: 'cleared' | 'lost' | null; kanaPerSec: number;
  stats: { parries: number; resolved: number; cracks: number; resets: number; specials: number };
}

/** Rules use only caller-supplied game time; no DOM, clocks, timers or storage. */
export class Battle {
  private hp: number;
  private cracks = 0;
  private attack: BattleAttack | null = null;
  private ringStreak = 0;
  private phase: 1 | 2 = 1;
  private active = false;
  private outcome: BattleSnapshot['outcome'] = null;
  private nextAttackAt = Infinity;
  private phase2Attacks = 0;
  private previousWordAt = 0;
  private lastWordIndex = -1;
  private speeds: { kana: number; durationMs: number }[] = [];
  private stats = { parries: 0, resolved: 0, cracks: 0, resets: 0, specials: 0 };
  readonly seed: number;

  constructor(private config: BattleConfig) {
    if (!Number.isFinite(config.bossHp) || config.bossHp <= 0) throw new Error('Boss HP must be positive');
    this.hp = config.bossHp; this.seed = config.seed >>> 0;
  }
  private speed() {
    const time = this.speeds.reduce((s, w) => s + w.durationMs, 0);
    if (time > 0) return this.speeds.reduce((s, w) => s + w.kana, 0) / time * 1000;
    return this.config.initialKanaPerSec && Number.isFinite(this.config.initialKanaPerSec) && this.config.initialKanaPerSec > 0
      ? this.config.initialKanaPerSec : 2;
  }
  routeWordDone(w: { kana: number; durationMs: number }) {
    if (w.kana > 0 && Number.isFinite(w.durationMs) && w.durationMs >= 0) this.speeds = [...this.speeds, { ...w }].slice(-3);
  }
  startBoss(gameMs: number) {
    if (this.active || this.outcome) return;
    this.active = true; this.previousWordAt = gameMs; this.nextAttackAt = gameMs + 3000;
  }
  private interval() { return (this.config.difficulty === 'standard' ? 5000 : this.config.difficulty === 'seraph' ? 2000 : 3000) - (this.phase === 2 ? 1000 : 0); }
  private resolve(gameMs: number) { this.attack = null; this.stats.resolved++; this.nextAttackAt = gameMs + this.interval(); }
  private expire(gameMs: number): BattleEvent[] {
    if (!this.attack || gameMs <= this.attack.dueAt || this.outcome) return [];
    this.resolve(gameMs); this.cracks++; this.stats.cracks++;
    const events: BattleEvent[] = [{ type: 'crack', cracks: this.cracks }];
    if (this.cracks === 3) {
      if (this.config.difficulty === 'standard') {
        this.cracks = 0; this.stats.resets++; events.push({ type: 'prayer-reset' });
      } else {
        this.outcome = 'lost'; this.active = false; events.push({ type: 'defeat' });
      }
    }
    return events;
  }
  tick(gameMs: number, view: InputView): BattleEvent[] {
    if (!this.active || this.outcome) return [];
    const events = this.expire(gameMs);
    if (this.outcome || this.attack || gameMs < this.nextAttackAt) return events;
    const two = this.phase === 2 && ++this.phase2Attacks % (this.config.difficulty === 'seraph' ? 2 : 3) === 0;
    const marked = view.previews.slice(0, two ? 2 : 1);
    const required = 1000 * (view.remainingKana + marked.reduce((s, w) => s + w.kana, 0)) / this.speed();
    const standard = this.config.difficulty === 'standard', seraph = this.config.difficulty === 'seraph';
    const factor = (standard ? 1.6 : 1.15) - (this.phase === 2 ? .15 : 0);
    const upper = Math.max((standard ? 20000 : 14000) * marked.length, required * 1.1);
    // Seraph removes the early-phase extra margin but never asks for more than
    // the measured kana speed. The pressure comes from less rest and more pairs.
    const duration = seraph ? Math.max(2500, required) : Math.max(standard ? 5000 : 3500, Math.min(required * factor, upper));
    this.attack = { marked: marked.map(w => w.index), completed: [], startedAt: gameMs, dueAt: gameMs + duration };
    events.push({ type: 'windup', marked: [...this.attack.marked], dueAt: this.attack.dueAt });
    return events;
  }
  wordDone(w: { index: number; kana: number; clean: boolean; gameMs: number }, _view: InputView): BattleEvent[] {
    if (!this.active || this.outcome || w.index <= this.lastWordIndex) return [];
    const events = this.expire(w.gameMs);
    if (this.outcome) return events;
    this.lastWordIndex = w.index;
    let parryDamage = 0;
    if (this.attack?.marked.includes(w.index)) {
      this.attack.completed.push(w.index);
      if (this.attack.marked.every(index => this.attack!.completed.includes(index))) {
        this.resolve(w.gameMs); this.stats.parries++; parryDamage = 8; events.push({ type: 'parry' });
      }
    }
    this.routeWordDone({ kana: w.kana, durationMs: w.gameMs - this.previousWordAt });
    this.previousWordAt = w.gameMs;
    let special: 'judgment' | 'ring' | null = null;
    let amount = w.kana * (w.clean ? 1.25 : 1);
    if (this.config.character === 'elna' && w.clean && w.kana >= 8) { amount = w.kana * 1.8; special = 'judgment'; }
    if (this.config.character === 'towa') {
      this.ringStreak = w.clean ? this.ringStreak + 1 : 0;
      if (this.ringStreak === 3) { amount += 10; special = 'ring'; this.ringStreak = 0; }
    }
    amount += parryDamage; this.hp = Math.max(0, this.hp - amount);
    events.push({ type: 'damage', amount, special });
    if (special) this.stats.specials++;
    if (special === 'ring' && this.cracks > 0) { this.cracks--; events.push({ type: 'restore', cracks: this.cracks }); }
    if (this.hp === 0) {
      this.attack = null; this.active = false; this.outcome = 'cleared'; events.push({ type: 'victory' });
    } else if (this.phase === 1 && this.hp <= this.config.bossHp / 2) { this.phase = 2; events.push({ type: 'phase2' }); }
    return events;
  }
  snapshot(): BattleSnapshot {
    return { hp: this.hp, bossHp: this.config.bossHp, cracks: this.cracks,
      attack: this.attack ? { ...this.attack, marked: [...this.attack.marked], completed: [...this.attack.completed] } : null,
      ringStreak: this.ringStreak, phase: this.phase, active: this.active, outcome: this.outcome,
      kanaPerSec: this.speed(), stats: { ...this.stats } };
  }
}
