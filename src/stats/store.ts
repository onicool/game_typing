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
const memory = new Map<string, { meta: SessionMeta; record: EventRecord }>();
let database: Promise<IDBDatabase | null> | undefined;

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  database = new Promise(resolve => {
    try {
      if (!globalThis.indexedDB) { resolve(null); return; }
      const request = globalThis.indexedDB.open('icebreaker-stats', 1);
      let abandoned = false;
      const unavailable = (): void => { abandoned = true; resolve(null); };
      request.onerror = unavailable;
      request.onblocked = unavailable;
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['events', 'sessions']) {
          const store = db.createObjectStore(name, { keyPath: 'session' });
          store.createIndex('dict', 'dict', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    } catch { resolve(null); }
  });
  return database;
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
  memory.set(meta.session, { meta: savedMeta, record });
  try {
    const db = await openDatabase();
    if (!db) return 'memory';
    await new Promise<void>((resolve, reject) => {
      // Metadata and all raw events are committed together at round end.
      const transaction = db.transaction(['events', 'sessions'], 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      try {
        transaction.objectStore('events').put(record);
        transaction.objectStore('sessions').put(savedMeta);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
    return 'persistent';
  } catch {
    // The complete session is still available until this page is closed/reloaded.
    return 'memory';
  }
}

async function readRecords<T>(name: string, dict?: string): Promise<T[]> {
  try {
    const db = await openDatabase();
    if (!db) return [];
    return await new Promise<T[]>((resolve, reject) => {
      const transaction = db.transaction(name, 'readonly');
      const store = transaction.objectStore(name);
      const request = dict === undefined ? store.getAll() : store.index('dict').getAll(dict);
      let records: T[] = [];
      request.onsuccess = () => { records = request.result as T[]; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { return []; }
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
