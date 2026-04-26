/**
 * IndexedDB-backed cache of recently-opened GP files.
 *
 * Stores raw bytes by filename so the user can re-open a file from the picker
 * without re-browsing the filesystem. Capped at MAX_RECENT entries (LRU by
 * lastOpened); overflows are evicted on each save.
 */

export interface RecentFile {
  name: string;
  size: number;
  lastOpened: number;
}

const DB_NAME = 'lgg-cache';
const STORE = 'recent-gp-files';
const MAX_RECENT = 10;

interface CacheEntry {
  name: string;
  lastOpened: number;
  size: number;
  bytes: Uint8Array;
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listRecentFiles(): Promise<RecentFile[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []) as CacheEntry[];
        const sorted = all.sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(
          sorted.map(({ name, size, lastOpened }) => ({ name, size, lastOpened }))
        );
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[recentFiles] list failed:', err);
    return [];
  }
}

export async function saveRecentFile(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const entry: CacheEntry = {
        name,
        lastOpened: Date.now(),
        size: bytes.byteLength,
        bytes,
      };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await evictOldest();
  } catch (err) {
    console.warn('[recentFiles] save failed:', err);
  }
}

export async function loadRecentFile(name: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(name);
      req.onsuccess = () => resolve(req.result as CacheEntry | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!entry) return null;
    // Touch lastOpened so this file rises to the top of the list
    await saveTouch(name);
    return entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
  } catch (err) {
    console.warn('[recentFiles] load failed:', err);
    return null;
  }
}

export async function removeRecentFile(name: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[recentFiles] remove failed:', err);
  }
}

async function saveTouch(name: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(name);
    getReq.onsuccess = () => {
      const entry = getReq.result as CacheEntry | undefined;
      if (entry) {
        entry.lastOpened = Date.now();
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function evictOldest(): Promise<void> {
  const all = await listRecentFiles();
  if (all.length <= MAX_RECENT) return;
  const toDelete = all.slice(MAX_RECENT);
  for (const f of toDelete) {
    await removeRecentFile(f.name);
  }
}
