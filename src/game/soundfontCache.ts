/**
 * IndexedDB-backed cache for soundfont SF2 files.
 * Uses its own database ('lgg-soundfonts') so it never conflicts with
 * the recentFiles DB ('lgg-cache') version number.
 */

const DB_NAME = 'lgg-soundfonts';
const DB_VERSION = 1;
const SF_STORE = 'soundfonts';

const DEFAULT_PROXY = 'https://guitar-workbench-proxy.bassmaster.workers.dev';
const PROXY_BASE = (process.env.REACT_APP_PROXY_BASE || DEFAULT_PROXY).replace(/\/+$/, '');

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SF_STORE)) {
        db.createObjectStore(SF_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCachedSoundFont(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SF_STORE, 'readonly');
      const req = tx.objectStore(SF_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.bytes as Uint8Array : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveSoundFontToCache(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SF_STORE, 'readwrite');
      tx.objectStore(SF_STORE).put({ key, bytes });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[soundfontCache] save failed:', e);
  }
}

async function fetchWithFallback(url: string): Promise<Response> {
  // Try direct first; archive.org CDN redirects sometimes drop CORS headers
  // so fall back to the proxy if the direct fetch fails.
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) return res;
  } catch {
    // fall through to proxy
  }
  const proxyUrl = `${PROXY_BASE}/proxy?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Soundfont fetch failed: ${res.status} ${res.statusText}`);
  return res;
}

export async function fetchAndCacheSoundFont(
  key: string,
  url: string,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
  const res = await fetchWithFallback(url);
  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (contentLength > 0) onProgress(received / contentLength);
  }

  const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

  await saveSoundFontToCache(key, bytes);
  onProgress(1);
  return bytes;
}

export async function isSoundFontCached(key: string): Promise<boolean> {
  const bytes = await loadCachedSoundFont(key);
  return bytes !== null;
}
