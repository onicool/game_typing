import type { StoredKey } from './types';

type SessionMeta = {
  session: string;
  dict: string;
  mode: string;
  kanaPerSec: number;
  accuracy: number;
  endedAt: number;
};
interface EventRecord { session: string; dict: string; endedAt: number; events: StoredKey[] }
/** A persistent result is returned only after both stores commit. */
export type SessionSaveStatus = 'persistent' | 'memory';
interface SavedSession { meta: SessionMeta; record: EventRecord; committed: boolean }
const memory = new Map<string, SavedSession>();
const pending = new Map<string, SavedSession>();
// Matches the result's recent-five view. Uncommitted snapshots are never evicted.
const RECENT_COMMITTED_LIMIT = 5;
const recentCommitted = new Set<string>();
let database: Promise<IDBDatabase | null> | undefined;
let connection: IDBDatabase | null = null;
let writes = Promise.resolve();

function forgetConnection(db: IDBDatabase): void {
  if (connection === db) {
    connection = null;
    database = undefined;
  }
}

function recoverClosedConnection(db: IDBDatabase | null, error: unknown): void {
  if (db && error instanceof DOMException && error.name === 'InvalidStateError') forgetConnection(db);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  const attempt = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (!globalThis.indexedDB) { resolve(null); return; }
      const request = globalThis.indexedDB.open('icebreaker-stats', 1);
      let abandoned = false;
      const unavailable = (): void => { abandoned = true; resolve(null); };
      request.onerror = unavailable;
      request.onblocked = unavailable;
      request.onupgradeneeded = () => {
        if (abandoned) { request.transaction?.abort(); return; }
        const db = request.result;
        for (const name of ['events', 'sessions']) {
          const store = db.createObjectStore(name, { keyPath: 'session' });
          store.createIndex('dict', 'dict', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        connection = db;
        db.onversionchange = () => { db.close(); forgetConnection(db); };
        db.onclose = () => forgetConnection(db);
        resolve(db);
      };
    } catch { resolve(null); }
  });
  database = attempt;
  void attempt.then(db => {
    // Includes synchronous denial and missing APIs. An old blocked request's
    // late success/close must not invalidate a newer connection.
    if (!db && database === attempt) database = undefined;
  });
  return attempt;
}

function copyEvents(events: StoredKey[]): StoredKey[] {
  return events.map(event => ({ ...event, expected: [...event.expected] }));
}

export async function saveSession(events: StoredKey[], meta: {
  session: string; dict: string; mode: string; kanaPerSec: number; accuracy: number; endedAt: number;
}): Promise<SessionSaveStatus> {
  // Retain complete snapshots until commit: quota, privacy restrictions, or a
  // closed connection can fail after opening. A retry replaces, never doubles.
  const savedMeta = { ...meta };
  const record: EventRecord = {
    session: meta.session, dict: meta.dict, endedAt: meta.endedAt, events: copyEvents(events),
  };
  const saved = { meta: savedMeta, record, committed: false };
  recentCommitted.delete(meta.session);
  memory.set(meta.session, saved);
  pending.set(meta.session, saved);
  // Serialize retries, including duplicate session IDs. Old completions cannot
  // clear a newer pending snapshot or write over a newer committed snapshot.
  const operation = writes.then(() => persistPending(saved));
  writes = operation.then(() => {});
  return operation;
}

async function persistPending(current: SavedSession): Promise<SessionSaveStatus> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    if (!db) return 'memory';
    const batch = Array.from(pending.values());
    if (!batch.length) return current.committed ? 'persistent' : 'memory';
    const target = db;
    await new Promise<void>((resolve, reject) => {
      // Recover previous memory-only rounds on the next successful save, with
      // both stores atomic. No background polling, data clearing or schema reset.
      const transaction = target.transaction(['events', 'sessions'], 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      try {
        for (const saved of batch) {
          transaction.objectStore('events').put(saved.record);
          transaction.objectStore('sessions').put(saved.meta);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
    for (const saved of batch) {
      saved.committed = true;
      if (pending.get(saved.meta.session) === saved) pending.delete(saved.meta.session);
      if (memory.get(saved.meta.session) === saved) recentCommitted.add(saved.meta.session);
    }
    while (recentCommitted.size > RECENT_COMMITTED_LIMIT) {
      const oldest = recentCommitted.values().next().value!;
      recentCommitted.delete(oldest);
      // Release only the page-memory copy. Both native stores already committed.
      if (!pending.has(oldest)) memory.delete(oldest);
    }
    // Earlier operations may have committed this queued snapshot in their batch,
    // then evicted its cache entry. Cache membership is not persistence evidence.
    return current.committed ? 'persistent' : 'memory';
  } catch (error) {
    recoverClosedConnection(db, error);
    // The complete session is still available until this page is closed/reloaded.
    return 'memory';
  }
}

async function readRecords<T>(name: string, dict?: string, unavailable?: () => void, signal?: AbortSignal): Promise<T[]> {
  let db: IDBDatabase | null = null;
  try {
    if (signal?.aborted) return [];
    db = await openDatabase();
    if (signal?.aborted) return [];
    if (!db) { unavailable?.(); return []; }
    const target = db;
    return await new Promise<T[]>((resolve, reject) => {
      const transaction = target.transaction(name, 'readonly');
      const store = transaction.objectStore(name);
      let records: T[] = [];
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        try { transaction.abort(); } catch { /* read already completed */ }
        cleanup();
        reject(new DOMException('History read cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      const fail = (error: unknown) => {
        cleanup();
        try { transaction.abort(); } catch { /* read already ended */ }
        reject(error);
      };
      if (name === 'events') {
        // Enumerate lightweight primary keys, then pipeline session-sized reads.
        // Each callback decodes one session; a sequential cursor would add an IPC
        // round trip per row, while getAll clones the full history in one task.
        const keys = dict === undefined ? store.getAllKeys() : store.index('dict').getAllKeys(dict);
        keys.onerror = () => fail(keys.error);
        keys.onsuccess = () => {
          if (signal?.aborted) return;
          try {
            for (const key of keys.result) {
              const request = store.get(key);
              request.onsuccess = () => { if (!signal?.aborted && request.result !== undefined) records.push(request.result as T); };
              request.onerror = () => fail(request.error);
            }
          } catch (error) { fail(error); }
        };
      } else {
        // Session metadata is small even for a large history.
        const request = dict === undefined ? store.getAll() : store.index('dict').getAll(dict);
        request.onsuccess = () => { records = request.result as T[]; };
        request.onerror = () => fail(request.error);
      }
      transaction.oncomplete = () => { cleanup(); resolve(records); };
      transaction.onerror = transaction.onabort = () => { cleanup(); reject(transaction.error); };
      if (signal?.aborted) abort();
    });
  } catch (error) {
    recoverClosedConnection(db, error);
    if (!signal?.aborted) unavailable?.();
    return [];
  }
}

export async function loadEvents(dict?: string, unavailable?: () => void, signal?: AbortSignal): Promise<StoredKey[]> {
  const records = new Map((await readRecords<EventRecord>('events', dict, unavailable, signal)).map(record => [record.session, record]));
  if (signal?.aborted) return [];
  // Memory wins even if an existing persisted session was replaced during an
  // unavailable write (including a changed dictionary).
  for (const [session, saved] of memory) records.set(session, saved.record);
  const ordered = Array.from(records.values())
    .filter(record => dict === undefined || record.dict === dict)
    .sort((a, b) => a.endedAt - b.endedAt);
  const result: StoredKey[] = [];
  for (const record of ordered) {
    // IndexedDB values already own independent structured clones. Memory
    // snapshots need another defensive copy to protect pending/recent records.
    const fromMemory = memory.get(record.session)?.record === record;
    for (const event of record.events) {
      if (dict === undefined || event.dict === dict) result.push(fromMemory ? { ...event, expected: [...event.expected] } : event);
    }
  }
  return result;
}

export async function loadSessions(dict?: string, unavailable?: () => void, signal?: AbortSignal): Promise<{
  session: string; dict: string; mode: string; kanaPerSec: number; accuracy: number; endedAt: number;
}[]> {
  const records = new Map((await readRecords<SessionMeta>('sessions', dict, unavailable, signal)).map(meta => [meta.session, meta]));
  if (signal?.aborted) return [];
  for (const [session, saved] of memory) records.set(session, saved.meta);
  return Array.from(records.values())
    .filter(meta => dict === undefined || meta.dict === dict)
    .sort((a, b) => a.endedAt - b.endedAt)
    .map(meta => ({ ...meta }));
}
