import { describe, expect, it } from 'vitest';
import { KeyEffects, KEY_EFFECT_MS, KEY_EFFECT_SLOTS } from './key-effects';
import { TypingSession } from '../engine/romaji';
describe('one immediate visual action per accepted physical letter', () => {
  it.each(['shi', 'si', 'ci'])('counts the actual %s spelling, not committed kana', keys => {
    const session = new TypingSession('し'), fx = new KeyEffects();
    expect(session.input('#').accepted).toBe(false);
    for (const key of keys) if (session.input(key).accepted) fx.emit('attack', 0);
    expect(session.complete).toBe(true); expect(fx.attacks).toBe(keys.length);
  });
  it('keeps attack and defense actions distinct in a mixed burst with no delayed queue', () => {
    const fx = new KeyEffects();
    for (let i = 0; i < 60; i++) fx.emit(i % 2 ? 'attack' : 'defend', i, i % 10 === 0);
    expect(fx.accepted).toBe(60); expect(fx.attacks).toBe(30); expect(fx.deflections).toBe(30);
    expect(fx.slots.filter(Boolean)).toHaveLength(60);
    expect(fx.slots[59]).toEqual({ id: 60, action: 'attack', at: 59, strong: false });
  });
  it('bounds a very long burst and retains the latest action immediately', () => {
    const fx = new KeyEffects();
    for (let i = 0; i < 10000; i++) fx.emit('defend', i);
    expect(fx.slots).toHaveLength(KEY_EFFECT_SLOTS); expect(fx.deflections).toBe(10000);
    expect(Math.max(...fx.slots.map(s => s!.at))).toBe(9999);
    expect(Math.min(...fx.slots.map(s => s!.at))).toBe(10000 - KEY_EFFECT_SLOTS);
    expect(KEY_EFFECT_MS).toBeLessThan(300);
  });
  it('changing graphics clears active shapes without resetting accepted counts', () => {
    const fx = new KeyEffects(); fx.emit('attack', 0); fx.clearVisuals();
    expect(fx.slots.every(s => s === null)).toBe(true); expect(fx.attacks).toBe(1);
  });
});
