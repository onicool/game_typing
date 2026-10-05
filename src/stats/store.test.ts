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

/** A controllable transaction model; browser checks use real IndexedDB too. */
function recoveryFixture() {
  type Row = { session: string; dict: string; [key: string]: unknown };
  type Transaction = { oncomplete: null | (() => void); onabort: null | (() => void);
    error: DOMException; objectStore(name: string): { put(row: Row): void;
      get(key: string): object; getAll(): object; getAllKeys(): object;
      index(name: string): { getAll(dict: string): object; getAllKeys(dict: string): object } }; abort(): void };
  const disk = new Map(['events', 'sessions'].map(name => [name, new Map<string, Row>()]));
  const held: { commit(): void; abort(): void }[] = [];
  let holdWrites = false;
  let readsUnavailable = false;
  let failure: 'throw' | 'error' | 'blocked' | null = null;
  const connections: { closed: boolean; close: () => void; onclose: null | (() => void);
    onversionchange: null | (() => void); transaction: ReturnType<typeof vi.fn> }[] = [];
  const requests: { result: typeof connections[number]; onsuccess: null | (() => void);
    onerror: null | (() => void); onblocked: null | (() => void) }[] = [];
  const open = vi.fn(() => {
    if (failure === 'throw') throw new DOMException('temporary denial', 'SecurityError');
    const db: typeof connections[number] = { closed: false, close: vi.fn(() => { db.closed = true; }),
      onclose: null, onversionchange: null, transaction: vi.fn((_names: unknown, mode: string) => {
        if (db.closed) throw new DOMException('closed', 'InvalidStateError');
        if (mode === 'readonly' && readsUnavailable) throw new Error('synthetic read outage');
        const staged = new Map<string, Row[]>();
        let reads = 0;
        const tx: Transaction = { oncomplete: null, onabort: null,
          error: new DOMException('quota', 'QuotaExceededError'), abort: () => tx.onabort?.(),
          objectStore: name => {
            const requestFor = (result: unknown) => {
              reads++;
              const request = { result: structuredClone(result), onsuccess: null as null | (() => void) };
              queueMicrotask(() => {
                request.onsuccess?.();
                if (--reads === 0) queueMicrotask(control.commit);
              });
              return request;
            };
            const get = (dict?: string) => {
              return requestFor([...disk.get(name)!.values()].filter(row => dict === undefined || row.dict === dict));
            };
            const keys = (dict?: string) => requestFor([...disk.get(name)!.values()]
              .filter(row => dict === undefined || row.dict === dict).map(row => row.session));
            return { put: row => staged.set(name, [...(staged.get(name) ?? []), structuredClone(row)]),
              get: key => requestFor(disk.get(name)!.get(key)), getAll: () => get(), getAllKeys: () => keys(),
              index: () => ({ getAll: dict => get(dict), getAllKeys: dict => keys(dict) }) };
          } };
        const control = { commit: () => {
          for (const [name, rows] of staged) for (const row of rows) disk.get(name)!.set(row.session, row);
          tx.oncomplete?.();
        }, abort: tx.abort };
        if (mode === 'readwrite' && holdWrites) held.push(control);
        // IndexedDB completes after its requests' success handlers. A single
        // microtask here wrongly resolved reads before getAll delivered rows.
        else if (mode === 'readwrite') queueMicrotask(() => queueMicrotask(control.commit));
        return tx;
      }) };
    const request = { result: db, onsuccess: null as null | (() => void),
      onerror: null as null | (() => void), onblocked: null as null | (() => void) };
    connections.push(db); requests.push(request);
    const failed = failure;
    queueMicrotask(() => failed === 'error' ? request.onerror?.() : failed === 'blocked'
      ? request.onblocked?.() : request.onsuccess?.());
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { disk, held, connections, requests, open,
    fail: (kind: typeof failure) => { failure = kind; }, hold: () => { holdWrites = true; },
    denyReads: (denied: boolean) => { readsUnavailable = denied; } };
}

async function untilHeld(held: ReturnType<typeof recoveryFixture>['held'], count = 1) {
  for (let i = 0; i < 30 && held.length < count; i++) await Promise.resolve();
  expect(held).toHaveLength(count);
}

describe('session save status', () => {
  const roundMeta = (i: number) => ({ ...meta, session: `round-${i}`, endedAt: i * 1000 });
  const roundEvent = (i: number) => ({ ...event, session: roundMeta(i).session });

  it('does not open a cancelled history read or discard its pending save', async () => {
    const fixture = recoveryFixture(); fixture.fail('throw');
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory');
    const read = new AbortController(); read.abort();
    const unavailable = vi.fn();
    expect(await loadEvents(undefined, unavailable, read.signal)).toEqual([]);
    expect(await loadSessions(undefined, unavailable, read.signal)).toEqual([]);
    expect(unavailable).not.toHaveBeenCalled();
    expect(fixture.open).toHaveBeenCalledTimes(1);
    fixture.fail(null);
    expect(await saveSession([roundEvent(1)], roundMeta(1))).toBe('persistent');
    expect((await loadEvents()).map(e => e.session)).toEqual([meta.session, roundMeta(1).session]);
    expect(fixture.disk.get('events')!.size).toBe(2);
  });

  it('cancels an active readonly reader without declaring an outage or altering either store', async () => {
    const fixture = recoveryFixture();
    const { saveSession, loadEvents } = await import('./store');
    for (let i = 0; i < 12; i++) await saveSession([roundEvent(i)], roundMeta(i));
    const read = new AbortController(), unavailable = vi.fn();
    const loading = loadEvents(undefined, unavailable, read.signal);
    await Promise.resolve();
    expect(fixture.connections[0].transaction).toHaveBeenLastCalledWith('events', 'readonly');
    read.abort();
    expect(await loading).toEqual([]);
    expect(unavailable).not.toHaveBeenCalled();
    expect(fixture.disk.get('events')!.size).toBe(12);
    expect(fixture.disk.get('sessions')!.size).toBe(12);
    expect(await loadEvents()).toEqual(Array.from({ length: 12 }, (_, i) => roundEvent(i)));
  });

  it('retains recent committed fallback while keeping the complete disk history independently readable', async () => {
    const fixture = recoveryFixture();
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    for (let i = 0; i < 12; i++) expect(await saveSession([roundEvent(i)], roundMeta(i))).toBe('persistent');
    const loaded = await loadEvents();
    expect(loaded).toHaveLength(12);
    // The oldest entry was evicted from the cache, so this also exercises
    // native read snapshot isolation rather than only the memory overlay.
    loaded[0].key = 'z'; loaded[0].expected[0] = 'z';
    expect((await loadEvents())[0]).toEqual(roundEvent(0));
    fixture.denyReads(true);
    const unavailable = vi.fn();
    expect((await loadEvents(undefined, unavailable)).map(e => e.session)).toEqual([7, 8, 9, 10, 11].map(i => roundMeta(i).session));
    expect(await loadSessions(undefined, unavailable)).toEqual([7, 8, 9, 10, 11].map(roundMeta));
    expect(unavailable).toHaveBeenCalledTimes(2);
    fixture.denyReads(false);
    expect(await loadSessions()).toEqual(Array.from({ length: 12 }, (_, i) => roundMeta(i)));
    expect(fixture.disk.get('events')!.size).toBe(12);
  });

  it('never evicts uncommitted rounds and persists the whole outage batch before limiting its cache', async () => {
    const fixture = recoveryFixture(); fixture.fail('throw');
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    for (let i = 0; i < 12; i++) expect(await saveSession([roundEvent(i)], roundMeta(i))).toBe('memory');
    expect(await loadEvents()).toEqual(Array.from({ length: 12 }, (_, i) => roundEvent(i)));
    fixture.fail(null);
    expect(await saveSession([roundEvent(12)], roundMeta(12))).toBe('persistent');
    expect(await loadSessions()).toEqual(Array.from({ length: 13 }, (_, i) => roundMeta(i)));
    expect(fixture.disk.get('events')!.size).toBe(13);
    expect(fixture.disk.get('sessions')!.size).toBe(13);
    fixture.denyReads(true);
    expect((await loadEvents()).map(e => e.session)).toEqual([8, 9, 10, 11, 12].map(i => roundMeta(i).session));
  });

  it('keeps accurate commit receipts when a shared batch evicts older queued snapshots', async () => {
    const fixture = recoveryFixture();
    const { saveSession, loadEvents } = await import('./store');
    const queued = Array.from({ length: 12 }, (_, i) => saveSession([roundEvent(i)], roundMeta(i)));
    expect(await Promise.all(queued)).toEqual(Array(12).fill('persistent'));
    expect(await loadEvents()).toEqual(Array.from({ length: 12 }, (_, i) => roundEvent(i)));
    expect(fixture.disk.get('events')!.size).toBe(12);
  });

  it('protects a newer pending same-ID snapshot while another commit exceeds the cache window', async () => {
    const fixture = recoveryFixture(); fixture.hold();
    const { saveSession, loadEvents } = await import('./store');
    const old = saveSession([roundEvent(0)], roundMeta(0)); await untilHeld(fixture.held);
    const nextEvent = { ...roundEvent(0), key: 'b', expected: ['b'] };
    const latest = saveSession([nextEvent], roundMeta(0));
    const other = Array.from({ length: 8 }, (_, i) => saveSession([roundEvent(i + 1)], roundMeta(i + 1)));
    fixture.held[0].commit(); expect(await old).toBe('persistent'); await untilHeld(fixture.held, 2);
    fixture.denyReads(true);
    expect((await loadEvents()).find(e => e.session === roundMeta(0).session)).toEqual(nextEvent);
    fixture.held[1].commit(); expect(await latest).toBe('persistent');
    expect(await Promise.all(other)).toEqual(Array(8).fill('persistent'));
    fixture.denyReads(false);
    expect((await loadEvents()).find(e => e.session === roundMeta(0).session)).toEqual(nextEvent);
    expect(fixture.disk.get('events')!.size).toBe(9);
  });

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

  it.each(['throw', 'error', 'blocked'] as const)('recovers from open %s and commits all pending rounds on the next save', async failure => {
    const fixture = recoveryFixture(); fixture.fail(failure);
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory');
    fixture.fail(null);
    const next = { ...meta, session: 'next-session', endedAt: 2000 };
    expect(await saveSession([{ ...event, session: next.session, key: 'b' }], next)).toBe('persistent');
    expect(fixture.disk.get('events')!.size).toBe(2);
    expect(fixture.disk.get('sessions')!.size).toBe(2);
    expect((await loadEvents()).map(e => e.key)).toEqual(['a', 'b']);
    expect(await loadSessions()).toEqual([meta, next]);
    expect(fixture.open).toHaveBeenCalledTimes(2);
    vi.resetModules(); const reopened = await import('./store');
    expect((await reopened.loadEvents()).map(e => e.key)).toEqual(['a', 'b']);
  });

  it('recovers a missing API and coalesces concurrent opens without duplicating a retried session', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { saveSession, loadEvents, loadSessions } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory');
    const fixture = recoveryFixture();
    await Promise.all([loadEvents(), loadSessions()]);
    expect(fixture.open).toHaveBeenCalledTimes(1);
    expect(await saveSession([{ ...event, key: 'b' }], { ...meta, accuracy: 0.5 })).toBe('persistent');
    expect(fixture.disk.get('events')!.size).toBe(1);
    expect((await loadEvents()).map(e => e.key)).toEqual(['b']);
    expect(await loadSessions()).toEqual([{ ...meta, accuracy: 0.5 }]);
  });

  it('keeps both stores unchanged on abort and retries the complete batch without changing original records', async () => {
    const fixture = recoveryFixture(); const { saveSession } = await import('./store');
    const original = { ...meta, session: 'original' };
    expect(await saveSession([{ ...event, session: original.session }], original)).toBe('persistent');
    fixture.hold();
    const failed = saveSession([event], meta); await untilHeld(fixture.held);
    fixture.held[0].abort(); expect(await failed).toBe('memory');
    expect(fixture.disk.get('events')!.size).toBe(1);
    expect(fixture.disk.get('sessions')!.size).toBe(1);
    const retry = saveSession([{ ...event, key: 'b' }], meta); await untilHeld(fixture.held, 2);
    fixture.held[1].commit(); expect(await retry).toBe('persistent');
    expect(fixture.disk.get('events')!.size).toBe(2);
    expect(fixture.disk.get('sessions')!.get('original')).toEqual(original);
    expect(fixture.disk.get('events')!.get(meta.session)!.events).toEqual([{ ...event, key: 'b' }]);
  });

  it('does not let an old transaction completion clear a newer snapshot of the same session', async () => {
    const fixture = recoveryFixture(); fixture.hold();
    const { saveSession, loadEvents } = await import('./store');
    const old = saveSession([event], meta); await untilHeld(fixture.held);
    const newer = saveSession([{ ...event, key: 'b' }], { ...meta, accuracy: 0.5 });
    await Promise.resolve(); expect(fixture.held).toHaveLength(1);
    fixture.held[0].commit(); expect(await old).toBe('persistent');
    await untilHeld(fixture.held, 2);
    expect(fixture.disk.get('events')!.get(meta.session)!.events).toEqual([event]);
    expect((await loadEvents()).map(e => e.key)).toEqual(['b']);
    fixture.held[1].commit(); expect(await newer).toBe('persistent');
    expect(fixture.disk.get('events')!.size).toBe(1);
    expect(fixture.disk.get('sessions')!.get(meta.session)!.accuracy).toBe(0.5);
  });

  it('does not mark a superseded queued snapshot as persistent or overwrite the latest one', async () => {
    const fixture = recoveryFixture(); const { saveSession, loadEvents } = await import('./store');
    const old = saveSession([event], meta);
    const latest = saveSession([{ ...event, key: 'b' }], meta);
    expect(await old).toBe('memory'); expect(await latest).toBe('persistent');
    expect(fixture.disk.get('events')!.size).toBe(1);
    expect((await loadEvents()).map(e => e.key)).toEqual(['b']);
  });

  it.each(['close-event', 'versionchange', 'closed-write', 'closed-read'] as const)('reopens after %s without discarding pending records', async reason => {
    const fixture = recoveryFixture(); const { saveSession, loadSessions } = await import('./store');
    await saveSession([event], meta);
    const original = fixture.connections[0];
    if (reason === 'close-event') { original.close(); original.onclose!(); }
    else if (reason === 'versionchange') original.onversionchange!();
    else {
      original.close();
      if (reason === 'closed-read') expect(await loadSessions()).toEqual([meta]);
      else expect(await saveSession([{ ...event, key: 'b' }], meta)).toBe('memory');
    }
    expect(await saveSession([{ ...event, key: 'c' }], meta)).toBe('persistent');
    expect(fixture.open).toHaveBeenCalledTimes(2);
    expect(fixture.disk.get('events')!.size).toBe(1);
    expect(fixture.disk.get('events')!.get(meta.session)!.events).toEqual([{ ...event, key: 'c' }]);
  });

  it('closes an abandoned open without invalidating a later healthy connection', async () => {
    const fixture = recoveryFixture(); fixture.fail('blocked');
    const { saveSession } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory'); fixture.fail(null);
    expect(await saveSession([event], meta)).toBe('persistent');
    fixture.requests[0].onsuccess!();
    expect(fixture.connections[0].close).toHaveBeenCalledTimes(1);
    fixture.connections[0].onclose?.();
    fixture.connections[1].onversionchange!();
    expect(await saveSession([event], meta)).toBe('persistent');
    fixture.connections[1].onclose?.();
    expect(await saveSession([event], meta)).toBe('persistent');
    expect(fixture.open).toHaveBeenCalledTimes(3);
  });

  it('aborts an abandoned request before a late schema upgrade can change stores', async () => {
    const createObjectStore = vi.fn(); const abort = vi.fn();
    const request = { result: { createObjectStore }, transaction: { abort },
      onblocked: null as null | (() => void), onupgradeneeded: null as null | (() => void) };
    vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => request.onblocked?.()); return request; } });
    const { saveSession } = await import('./store');
    expect(await saveSession([event], meta)).toBe('memory');
    request.onupgradeneeded!();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(createObjectStore).not.toHaveBeenCalled();
  });
});
