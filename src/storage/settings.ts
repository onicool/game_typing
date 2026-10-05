type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>;
type Validator = (value: unknown) => boolean;
export type SettingsWriteStatus = 'persistent' | 'invalid' | 'unavailable';

/** Read the current bytes again before writing; never replace unrecognised data. */
export function writePreservingInvalid(key: string, value: unknown, validate: Validator,
  storage: StorageAccess = () => globalThis.localStorage): SettingsWriteStatus {
  try {
    const target = storage();
    const raw = target.getItem(key);
    if (raw !== null) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return 'invalid'; }
      if (!validate(parsed)) return 'invalid';
    }
    if (!validate(value)) return 'invalid';
    target.setItem(key, JSON.stringify(value));
    return 'persistent';
  } catch { return 'unavailable'; }
}

/** Invalid disk values stay untouched. Explicit changes still work in this page. */
export function createSettingsStore(onIssue: (issue: 'invalid' | 'unavailable' | null) => void = () => {},
  storage: StorageAccess = () => globalThis.localStorage) {
  const validators = new Map<string, Validator>();
  const memory = new Map<string, unknown>();
  const unsaved = new Set<string>();
  const issues = new Map<string, SettingsWriteStatus>();
  const report = (key: string, status: SettingsWriteStatus) => {
    if (status === 'persistent') issues.delete(key);
    else issues.set(key, status);
    onIssue([...issues.values()].includes('invalid') ? 'invalid' : issues.size ? 'unavailable' : null);
  };
  const reportReadable = (key: string) => report(key, unsaved.has(key) ? 'unavailable' : 'persistent');
  return {
    get<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
      validators.set(key, validate);
      let value = fallback;
      try {
        const raw = storage().getItem(`icebreaker.${key}`);
        if (raw !== null) {
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch {
            report(key, 'invalid');
            return (memory.get(key) as T | undefined) ?? fallback;
          }
          if (validate(parsed)) { value = parsed; reportReadable(key); }
          else report(key, 'invalid');
        } else reportReadable(key);
      } catch { report(key, 'unavailable'); }
      return (memory.get(key) as T | undefined) ?? value;
    },
    set(key: string, value: unknown): SettingsWriteStatus {
      const validate = validators.get(key);
      // Every setting must first declare its schema via get().
      if (!validate || !validate(value)) return 'invalid';
      memory.set(key, value);
      const status = writePreservingInvalid(`icebreaker.${key}`, value, validate, storage);
      if (status === 'persistent') unsaved.delete(key);
      else unsaved.add(key);
      report(key, status);
      return status;
    },
  };
}

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const isVolume = (value: unknown): value is number => isNonNegativeNumber(value) && value <= 1;
export const isEffectLevel = (value: unknown): value is 0 | 0.5 | 1 => value === 0 || value === 0.5 || value === 1;
export const isDictionaryIndex = (count: number) => (value: unknown): value is number =>
  isNonNegativeNumber(value) && Number.isInteger(value) && value < count;
export const isSpellingPreferences = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every(spelling => typeof spelling === 'string');
