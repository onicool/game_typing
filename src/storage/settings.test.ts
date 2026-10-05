import { describe, expect, it } from 'vitest';
import { createSettingsStore, isBoolean, isDictionaryIndex, isEffectLevel,
  isNonNegativeNumber, isSpellingPreferences, isVolume } from './settings';

function fixture() {
  const data = new Map<string, string>();
  let readFailure = false;
  let writeFailure = false;
  const issues: ('invalid' | 'unavailable' | null)[] = [];
  const access = () => ({
    getItem(key: string) { if (readFailure) throw new Error('synthetic read failure'); return data.get(key) ?? null; },
    setItem(key: string, raw: string) { if (writeFailure) throw new Error('synthetic quota failure'); data.set(key, raw); },
  });
  return { data, issues, access, store: createSettingsStore(issue => issues.push(issue), access),
    failReads: (fail: boolean) => { readFailure = fail; },
    failWrites: (fail: boolean) => { writeFailure = fail; } };
}

const schemas = [
  { key: 'dict', validate: isDictionaryIndex(2), invalid: [-1, 0.5, 2, null, '1'], valid: [0, 1] },
  { key: 'sound', validate: isBoolean, invalid: [null, 0, 'false', {}], valid: [true, false] },
  { key: 'volume', validate: isVolume, invalid: [-1, 1.1, null, '0.5', {}], valid: [0, 0.5, 1] },
  { key: 'effects.shake', validate: isEffectLevel, invalid: [null, -1, 0.4, 2, '0'], valid: [0, 0.5, 1] },
  { key: 'pb.jp-core', validate: isNonNegativeNumber, invalid: [null, -1, 'fast', []], valid: [0, 2.25] },
  { key: 'prefs', validate: isSpellingPreferences, invalid: [null, [], 'shi', { 'し': 1 }, { 'し': null }], valid: [{}, { 'し': 'si' }] },
];

describe('validated settings and preservation', () => {
  it.each(schemas)('rejects invalid $key values and accepts its schema', ({ validate, invalid, valid }) => {
    for (const value of invalid) expect(validate(value)).toBe(false);
    for (const value of valid) expect(validate(value)).toBe(true);
  });

  it('rejects non-finite numeric values', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(isDictionaryIndex(2)(value)).toBe(false);
      expect(isVolume(value)).toBe(false);
      expect(isNonNegativeNumber(value)).toBe(false);
    }
  });

  it.each(['{broken', 'null', '-1', '0.5', '2', '"1"', '{}', '[]'])
  ('starts and reloads safely without overwriting a damaged dictionary value: %s', raw => {
    const f = fixture();
    f.data.set('icebreaker.dict', raw);
    expect(f.store.get('dict', 0, isDictionaryIndex(2))).toBe(0);
    expect(f.data.get('icebreaker.dict')).toBe(raw);
    expect(f.store.set('dict', 1)).toBe('invalid');
    expect(f.store.get('dict', 0, isDictionaryIndex(2))).toBe(1); // live change works
    expect(f.data.get('icebreaker.dict')).toBe(raw);
    const reloaded = createSettingsStore(() => {}, f.access);
    expect(reloaded.get('dict', 0, isDictionaryIndex(2))).toBe(0);
    expect(f.data.get('icebreaker.dict')).toBe(raw);
    expect(f.issues.at(-1)).toBe('invalid');
  });

  it('preserves mixed preferences rather than saving a filtered subset', () => {
    const f = fixture();
    const raw = '{"し":"si","ち":null}';
    f.data.set('icebreaker.prefs', raw);
    const prefs = f.store.get('prefs', {}, isSpellingPreferences);
    expect(prefs).toEqual({});
    prefs['し'] = 'shi';
    expect(f.store.set('prefs', prefs)).toBe('invalid');
    expect(f.data.get('icebreaker.prefs')).toBe(raw);
  });

  it('does not write defaults at startup, and persists explicit changes to healthy keys', () => {
    const f = fixture();
    expect(f.store.get('sound', true, isBoolean)).toBe(true);
    expect(f.data.size).toBe(0);
    expect(f.store.set('sound', false)).toBe('persistent');
    const reloaded = createSettingsStore(() => {}, f.access);
    expect(reloaded.get('sound', true, isBoolean)).toBe(false);
    expect(f.data.get('icebreaker.sound')).toBe('false');
  });

  it('protects against data becoming invalid after startup and recovers after external repair', () => {
    const f = fixture();
    f.data.set('icebreaker.volume', '0.5');
    expect(f.store.get('volume', 1, isVolume)).toBe(0.5);
    f.data.set('icebreaker.volume', '{broken');
    expect(f.store.set('volume', 0.2)).toBe('invalid');
    expect(f.data.get('icebreaker.volume')).toBe('{broken');
    f.data.set('icebreaker.volume', '0.4'); // external repair, never done by the app
    expect(f.store.set('volume', 0.3)).toBe('persistent');
    expect(f.data.get('icebreaker.volume')).toBe('0.3');
    expect(f.issues.at(-1)).toBe(null);
  });

  it.each(['read', 'write'])('keeps explicit changes in memory on a %s failure, then resumes saving', failure => {
    const f = fixture();
    f.data.set('icebreaker.sound', 'true');
    expect(f.store.get('sound', true, isBoolean)).toBe(true);
    if (failure === 'read') f.failReads(true);
    else f.failWrites(true);
    expect(f.store.set('sound', false)).toBe('unavailable');
    expect(f.store.get('sound', true, isBoolean)).toBe(false);
    expect(f.issues.at(-1)).toBe('unavailable');
    expect(f.data.get('icebreaker.sound')).toBe('true');
    f.failReads(false); f.failWrites(false);
    expect(f.store.set('sound', false)).toBe('persistent');
    expect(f.data.get('icebreaker.sound')).toBe('false');
    expect(f.issues.at(-1)).toBe(null);
  });

  it('does not silently repair storage on reload or recovery of read access', () => {
    const f = fixture();
    f.data.set('icebreaker.volume', '0.6');
    f.failReads(true);
    expect(f.store.get('volume', 1, isVolume)).toBe(1);
    expect(f.store.set('volume', 0.1)).toBe('unavailable');
    f.failReads(false);
    const reloaded = createSettingsStore(() => {}, f.access);
    expect(reloaded.get('volume', 1, isVolume)).toBe(0.6);
    expect(f.data.get('icebreaker.volume')).toBe('0.6');
  });

  it('rejects writes without a schema or with an invalid new value', () => {
    const f = fixture();
    expect(f.store.set('sound', true)).toBe('invalid');
    f.store.get('sound', true, isBoolean);
    expect(f.store.set('sound', 'false')).toBe('invalid');
    expect(f.data.size).toBe(0);
  });

  it('keeps a damaged-key notice while unrelated healthy settings are changed', () => {
    const f = fixture();
    f.data.set('icebreaker.dict', '-1');
    f.store.get('dict', 0, isDictionaryIndex(2));
    f.store.get('sound', true, isBoolean);
    f.store.set('sound', false);
    expect(f.issues.at(-1)).toBe('invalid');
    expect(f.data.get('icebreaker.dict')).toBe('-1');
  });
});
