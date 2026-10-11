export type KeyAction = 'attack' | 'defend';
export const KEY_EFFECT_MS = 240;
export const KEY_EFFECT_SLOTS = 64;
export interface KeyEffect { id: number; action: KeyAction; at: number; strong: boolean; variant?: number }

/** Immediate, overlapping feedback. Never queue work for a later frame.
 * Even a burst larger than the pool updates all counters; only the oldest
 * visible effects are replaced, so there is no input-to-animation backlog. */
export class KeyEffects {
  readonly slots: (KeyEffect | null)[] = Array(KEY_EFFECT_SLOTS).fill(null);
  accepted = 0;
  attacks = 0;
  deflections = 0;
  emit(action: KeyAction, at: number, strong = false, variant?: number): KeyEffect {
    const effect: KeyEffect = { id: ++this.accepted, action, at, strong, ...(variant === undefined ? {} : { variant }) };
    if (action === 'attack') this.attacks++; else this.deflections++;
    this.slots[(effect.id - 1) % KEY_EFFECT_SLOTS] = effect;
    return effect;
  }
  clearVisuals() { this.slots.fill(null); }
}
