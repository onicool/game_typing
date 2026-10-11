import type { KeyAction } from './key-effects';

export const PLAYER_MOVES = {
  elna: ['thrust', 'sweep', 'rise', 'reverse', 'helix', 'burst'],
  towa: ['jab', 'cross', 'uppercut', 'palm', 'double', 'nova'],
} as const;
export const ENEMY_MOVES = ['shot', 'melee', 'volley'] as const;
export const PHASES = ['windup', 'accelerate', 'contact', 'follow', 'recover', 'ready'] as const;
export type MotionKind = 'normal' | 'combo' | 'guard' | 'parry' | 'hit' | 'deflect' | 'enemy';
const TIMES: Record<MotionKind, readonly number[]> = {
  normal: [45, 45, 35, 55, 60, 80], combo: [70, 70, 60, 80, 90, 90],
  guard: [30, 25, 35, 35, 35, 40], parry: [30, 25, 55, 35, 35, 40],
  hit: [20, 40, 60, 40, 40, 40], deflect: [30, 35, 65, 45, 45, 50],
  enemy: [250, 150, 40, 70, 70, 80],
};
export interface MotionSample { move: string; frame: number; phase: typeof PHASES[number]; kind: MotionKind; progress: number; chain: boolean }
interface Clip { move: string; kind: MotionKind; start: number; chain: boolean; protectUntil: number }
export function normalVariant(accepted: number, variants = 4) { return Math.max(0, accepted - 1) % variants; }

/** One replaceable body clip. Immediate key effects are owned by a separate pool.
 * No wall clock, timer, queue, or gameplay damage is owned by this presenter. */
export class MotionTrack {
  private clip: Clip | null = null;
  private lastKey = -Infinity;
  start(move: string, now: number, kind: MotionKind, rapid = false) {
    if (this.clip && now < this.clip.protectUntil && kind !== 'combo' && kind !== 'parry') return false;
    const chain = rapid && now - this.lastKey < 100;
    const times = TIMES[kind];
    this.clip = { move, kind, start: now - (chain ? times[0] + times[1] : 0), chain,
      protectUntil: now + (kind === 'combo' ? 260 : kind === 'parry' ? 180 : kind === 'hit' && !rapid ? 100 : 0) };
    if (rapid) this.lastKey = now;
    return true;
  }
  schedule(move: string, dueAt: number) {
    return this.start(move, dueAt - 400, 'enemy');
  }
  sample(now: number): MotionSample | null {
    const c = this.clip;
    if (!c || now < c.start) return null;
    const times = TIMES[c.kind], duration = times.reduce((a, b) => a + b, 0), age = now - c.start;
    if (age >= duration) return null;
    let end = 0;
    const frame = times.findIndex(t => { end += t; return age < end; });
    return { move: c.move, frame, phase: PHASES[frame], kind: c.kind, progress: age / duration, chain: c.chain };
  }
  clear() { this.clip = null; this.lastKey = -Infinity; }
}

export class BattleMotion {
  readonly player = new MotionTrack();
  readonly enemy = new MotionTrack();
  attacks = 0;
  combos = 0;
  enemyAttacks = 0;
  private pendingComboAt = -Infinity;
  private enemyDue = Infinity;
  constructor(readonly character: 'elna' | 'towa', private variants = 4) {}
  combo(now: number) { this.pendingComboAt = now; }
  accepted(action: KeyAction, now: number) {
    const combo = action === 'attack' && this.pendingComboAt === now;
    const variant = combo ? 4 + this.combos++ % 2 : action === 'attack' ? normalVariant(++this.attacks, this.variants) : 0;
    this.player.start(action === 'defend' ? 'guard' : PLAYER_MOVES[this.character][variant], now, combo ? 'combo' : action === 'defend' ? 'guard' : 'normal', true);
    if (action === 'attack') this.enemy.start('hit', now, 'hit', true);
    return { action, character: this.character, variant, combo };
  }
  reaction(kind: 'guard' | 'parry' | 'hit', now: number) {
    this.player.start('guard', now, kind, kind === 'guard');
    if (kind === 'parry') this.enemy.start('deflect', now, 'parry');
  }
  incoming(dueAt: number | null, now: number) {
    if (dueAt === null) { this.enemyDue = Infinity; return; }
    if (dueAt === this.enemyDue) return;
    const current = this.enemy.sample(now);
    // A packet advances nextAt at contact. Let its drawn recoil finish before
    // selecting the next announced packet; no future body clips are queued.
    if (current && (current.kind !== 'enemy' || current.frame >= 2)) return;
    this.enemyDue = dueAt;
    this.enemy.schedule(ENEMY_MOVES[this.enemyAttacks++ % ENEMY_MOVES.length], dueAt);
  }
  clear() { this.player.clear(); this.enemy.clear(); this.enemyDue = Infinity; this.pendingComboAt = -Infinity; }
}
