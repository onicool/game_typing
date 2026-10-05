import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredKey } from './types';

const meta = { session: 'synthetic-session', dict: 'jp-test', mode: 'benchmark',
  kanaPerSec: 2, accuracy: 1, endedAt: 1000 };
const event: StoredKey = { session: meta.session, dict: meta.dict, mode: meta.mode,
  t: 100, key: 'a', code: 'KeyA', correct: true, expected: ['a'], prevKey: null,
  dt: NaN, wordStart: true, afterMiss: false, intended: null };

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

/** The browser owns completion: putting records is not proof of a commit. */
function databaseFixture() {
  const puts = new Map(['events', 'sessions'].map(name => [name, vi.fn()]));
  const transaction = {
    oncomplete: null as null | (() => void), onerror: null as null | (() => void),
    onabort: null as null | (() => void), error: new Error('synthetic quota failure'),
    objectStore: (name: string) => ({ put: puts.get(name)! }), abort: vi.fn(),
  };
  const db = { transaction: vi.fn(() => transaction), close: vi.fn(), onversionchange: null };
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: db, onsuccess: null as null | (() => void) };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return { db, transaction, puts };
}

async function untilTransaction(db: ReturnType<typeof databaseFixture>['db']) {
  for (let i = 0; i < 10 && !db.transaction.mock.calls.length; i++) await Promise.resolve();
  expect(db.transaction).toHaveBeenCalledWith(['events', 'sessions'], 'readwrite');
}

describe('session save status', () => {
  it('keeps an independent, readable snapshot when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    const events = [{ ...event, expected: ['a'] }];
    const metadata = { ...meta };
    expect(await saveSession(events, metadata)).toBe('memory');
    events[0].expected[0] = 'z';
    metadata.accuracy = 0;
    expect((await loadEvents(meta.dict))[0].expected).toEqual(['a']);
    expect(await loadSessions(meta.dict)).toEqual([meta]);
    expect(await loadEvents('en-test')).toEqual([]);
    const loaded = await loadEvents(meta.dict);
    loaded[0].expected[0] = 'x';
    expect((await loadEvents(meta.dict))[0].expected).toEqual(['a']);
  });

  it.each(['throw', 'error', 'blocked'])('reports memory retention for an open %s', async failure => {
    vi.stubGlobal('indexedDB', { open: () => {
      if (failure === 'throw') throw new Error('synthetic security restriction');
      const request = { onerror: null as null | (() => void), onblocked: null as null | (() => void) };
      queueMicrotask(() => failure === 'error' ? request.onerror?.() : request.onblocked?.());
      return request;
    } });
    const { saveSession, loadSessions } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory');
    expect(await loadSessions(meta.dict)).toEqual([meta]);
  });

  it('reports persistence only after the atomic transaction completes', async () => {
    const { db, transaction, puts } = databaseFixture();
    const { saveSession } = await import('./store');
    let settled = false;
    const pending = saveSession([event], meta).then(status => { settled = true; return status; });
    await untilTransaction(db);
    expect(puts.get('events')).toHaveBeenCalledWith(expect.objectContaining({ events: [event] }));
    expect(puts.get('sessions')).toHaveBeenCalledWith(meta);
    expect(settled).toBe(false);
    transaction.oncomplete!();
    expect(await pending).toBe('persistent');
  });

  it.each(['abort', 'error', 'put'])('reports memory retention after a transaction %s', async failure => {
    const { db, transaction, puts } = databaseFixture();
    if (failure === 'put') puts.get('sessions')!.mockImplementation(() => { throw new Error('synthetic write failure'); });
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    const pending = saveSession([event], meta);
    await untilTransaction(db);
    if (failure === 'abort') transaction.onabort!();
    else if (failure === 'error') transaction.onerror!();
    expect(await pending).toBe('memory');
    if (failure === 'put') expect(transaction.abort).toHaveBeenCalled();
    // No fake disk reads: prove that the fallback still exposes the session.
    db.transaction.mockImplementation(() => { throw new Error('synthetic read failure'); });
    expect(await loadEvents(meta.dict)).toEqual([event]);
    expect(await loadSessions(meta.dict)).toEqual([meta]);
  });

  it('replaces a retried memory session without duplicate events', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    await saveSession([event], meta);
    expect(await saveSession([{ ...event, key: 'b' }], { ...meta, accuracy: 0.5 })).toBe('memory');
    expect((await loadEvents(meta.dict)).map(e => e.key)).toEqual(['b']);
    expect(await loadSessions(meta.dict)).toEqual([{ ...meta, accuracy: 0.5 }]);
  });
});
