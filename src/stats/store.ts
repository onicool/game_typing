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
interface SavedSession { meta: SessionMeta; record: EventRecord }
const memory = new Map<string, SavedSession>();
const pending = new Map<string, SavedSession>();
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
  // Retain every save in memory too: quota, privacy restrictions, or a closed
  // connection can fail after opening. A retry replaces a session, never doubles it.
  const savedMeta = { ...meta };
  const record: EventRecord = {
    session: meta.session, dict: meta.dict, endedAt: meta.endedAt, events: copyEvents(events),
  };
  const saved = { meta: savedMeta, record };
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
    if (!batch.length) return memory.get(current.meta.session) === current ? 'persistent' : 'memory';
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
      if (pending.get(saved.meta.session) === saved) pending.delete(saved.meta.session);
    }
    return batch.includes(current) ? 'persistent' : 'memory';
  } catch (error) {
    recoverClosedConnection(db, error);
    // The complete session is still available until this page is closed/reloaded.
    return 'memory';
  }
}

async function readRecords<T>(name: string, dict?: string): Promise<T[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    if (!db) return [];
    const target = db;
    return await new Promise<T[]>((resolve, reject) => {
      const transaction = target.transaction(name, 'readonly');
      const store = transaction.objectStore(name);
      const request = dict === undefined ? store.getAll() : store.index('dict').getAll(dict);
      let records: T[] = [];
      request.onsuccess = () => { records = request.result as T[]; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    recoverClosedConnection(db, error);
    return [];
  }
}

export async function loadEvents(dict?: string): Promise<StoredKey[]> {
  const records = new Map((await readRecords<EventRecord>('events', dict)).map(record => [record.session, record]));
  // Memory wins even if an existing persisted session was replaced during an
  // unavailable write (including a changed dictionary).
  for (const [session, saved] of memory) records.set(session, saved.record);
  const ordered = Array.from(records.values())
    .filter(record => dict === undefined || record.dict === dict)
    .sort((a, b) => a.endedAt - b.endedAt);
  const result: StoredKey[] = [];
  for (const record of ordered) {
    for (const event of record.events) {
      if (dict === undefined || event.dict === dict) result.push({ ...event, expected: [...event.expected] });
    }
  }
  return result;
}

export async function loadSessions(dict?: string): Promise<{
  session: string; dict: string; mode: string; kanaPerSec: number; accuracy: number; endedAt: number;
}[]> {
  const records = new Map((await readRecords<SessionMeta>('sessions', dict)).map(meta => [meta.session, meta]));
  for (const [session, saved] of memory) records.set(session, saved.meta);
  return Array.from(records.values())
    .filter(meta => dict === undefined || meta.dict === dict)
    .sort((a, b) => a.endedAt - b.endedAt)
    .map(meta => ({ ...meta }));
}
