import { describe, expect, it } from 'vitest';
import { combatPoses, POSE_HOLD_MS } from './battle-art';

describe('illustrated combat poses on the game clock', () => {
  it('changes anatomy on an accepted attack and returns without a queued pose', () => {
    expect(combatPoses(0, 'attack', false, true)).toEqual({ player: 'attack', sentinel: 'hit' });
    expect(combatPoses(POSE_HOLD_MS, 'attack', false, true)).toEqual({ player: 'idle', sentinel: 'idle' });
    expect(combatPoses(0, 'attack', true, true)).toEqual({ player: 'attack', sentinel: 'hit' });
  });
  it('keeps a guard stance after a final defense key changes the next word to attack', () => {
    expect(combatPoses(0, 'defend', false, true)).toEqual({ player: 'guard', sentinel: 'idle' });
    expect(combatPoses(0, 'defend', true, true)).toEqual({ player: 'guard', sentinel: 'attack' });
    expect(combatPoses(500, 'defend', true, true)).toEqual({ player: 'guard', sentinel: 'attack' });
  });
  it('does not play action poses with reduced motion or a future event time', () => {
    expect(combatPoses(0, 'attack', false, false)).toEqual({ player: 'idle', sentinel: 'idle' });
    expect(combatPoses(0, 'attack', true, false)).toEqual({ player: 'guard', sentinel: 'idle' });
    expect(combatPoses(-1, 'attack', false, true)).toEqual({ player: 'idle', sentinel: 'idle' });
  });
});
