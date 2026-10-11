import { describe, expect, it } from 'vitest';
import { BattleMotion, MotionTrack, normalVariant, PHASES, PLAYER_MOVES } from './battle-motion';

describe('body motion independent of key damage and the game clock', () => {
  it('plays six anatomical phases and finishes without deferred work', () => {
    const track = new MotionTrack(); track.start('thrust', 1000, 'normal');
    expect([1000, 1045, 1090, 1125, 1180, 1240].map(t => track.sample(t)?.phase)).toEqual(PHASES);
    expect(track.sample(1320)).toBeNull(); expect(track.sample(999)).toBeNull();
  });
  it('selects all four normals deterministically with no immediate repeats', () => {
    const variants = Array.from({ length: 100 }, (_, i) => normalVariant(i + 1));
    expect(new Set(variants).size).toBe(4);
    expect(variants.every((v, i) => i === 0 || v !== variants[i - 1])).toBe(true);
    for (const character of ['elna', 'towa'] as const) {
      const motions = new BattleMotion(character);
      expect([0, 1, 2, 3].map(n => { motions.accepted('attack', n * 700); return motions.player.sample(n * 700)?.move; })).toEqual(PLAYER_MOVES[character].slice(0, 4));
    }
  });
  it('uses contact frames for a 100-key burst instead of restarting windup forever', () => {
    const motion = new BattleMotion('elna');
    for (let i = 0; i < 100; i++) motion.accepted('attack', 1000);
    expect(motion.attacks).toBe(100);
    expect(motion.player.sample(1000)).toMatchObject({ move: 'reverse', frame: 2, chain: true });
    expect(motion.player.sample(1230)).toBeNull();
    expect(motion.enemy.sample(1180)).toBeNull();
  });
  it('preserves a readable finisher while later keys remain immediate', () => {
    const motion = new BattleMotion('elna');
    motion.combo(1000); expect(motion.accepted('attack', 1000).variant).toBe(4);
    for (let n = 0; n < 20; n++) motion.accepted('defend', 1050 + n);
    expect(motion.player.sample(1120)).toMatchObject({ move: 'helix', kind: 'combo' });
    motion.combo(1800); expect(motion.accepted('attack', 1800).variant).toBe(5);
    expect(motion.player.sample(2260)).toBeNull();
  });
  it('aligns all three enemy contacts with the announced packet and never duplicates a schedule', () => {
    const motion = new BattleMotion('towa');
    for (let i = 0; i < 3; i++) {
      const due = 2000 + i * 2000; motion.incoming(due, due - 400); motion.incoming(due, due - 400);
      expect(motion.enemy.sample(due - 400)?.phase).toBe('windup');
      expect(motion.enemy.sample(due)?.phase).toBe('contact');
    }
    expect(motion.enemyAttacks).toBe(3);
  });
  it('keeps contact and recoil visible when the next packet is announced', () => {
    const motion = new BattleMotion('elna'); motion.incoming(2000, 1500);
    motion.incoming(4000, 2000);
    expect(motion.enemy.sample(2000)).toMatchObject({ move: 'shot', phase: 'contact' });
    motion.incoming(4000, 2050);
    expect(motion.enemy.sample(2050)).toMatchObject({ move: 'shot', phase: 'follow' });
    motion.incoming(4000, 2300);
    expect(motion.enemyAttacks).toBe(2);
    expect(motion.enemy.sample(3600)?.move).toBe('melee');
  });
  it('makes parry distinct and protects its recoil from the final accepted defense key', () => {
    const motion = new BattleMotion('towa'); motion.reaction('parry', 1000); motion.accepted('defend', 1000);
    expect(motion.player.sample(1000)?.kind).toBe('parry');
    expect(motion.enemy.sample(1000)?.move).toBe('deflect');
    expect(motion.enemy.sample(1000)).toEqual(motion.enemy.sample(1000));
    motion.clear(); expect(motion.player.sample(1000)).toBeNull(); expect(motion.enemy.sample(1000)).toBeNull();
  });
});
