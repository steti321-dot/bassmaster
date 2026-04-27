/**
 * Fetch a Guitar Pro file from any URL.
 *
 * In Electron builds, hits the URL directly through the renderer's fetch
 * (Electron's CSP allows arbitrary connect-src in dev/prod). If that's
 * CORS-blocked or no proxy is configured, we fall back to the same
 * Cloudflare Worker the gprotab client uses — its `/proxy?url=` endpoint
 * pipes the response back with permissive CORS headers.
 *
 * Either way, we sanity-check that the body starts with the GP file
 * magic prefix (1-byte length + "FICHIER GUITAR PRO") to reject HTML
 * error pages early.
 */

// Default to the deployed Cloudflare Worker so the URL-paste / proxy
// fallback works even when REACT_APP_PROXY_BASE isn't injected at build
// time. Override per-build via the env var if you ever rehost the proxy.
const DEFAULT_PROXY = 'https://guitar-workbench-proxy.bassmaster.workers.dev';
const PROXY_BASE = (process.env.REACT_APP_PROXY_BASE || DEFAULT_PROXY).replace(/\/+$/, '');
const GP_MAGIC = 'FICHIER GUITAR PRO';

export interface FetchedGpFile {
  bytes: Uint8Array;
  filename: string;
}

function deriveFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    if (/\.(gp[3-5])$/i.test(last)) return decodeURIComponent(last);
  } catch {}
  return 'tab.gp5';
}

function magicCheck(buf: Uint8Array): void {
  if (buf.byteLength < 32) {
    throw new Error('Response too small to be a Guitar Pro file.');
  }
  const head = new TextDecoder('latin1').decode(buf.subarray(1, 19));
  if (!head.startsWith(GP_MAGIC)) {
    const preview = new TextDecoder('utf-8', { fatal: false })
      .decode(buf.subarray(0, 60))
      .replace(/\s+/g, ' ');
    throw new Error(
      `URL did not return a Guitar Pro file (got "${preview.slice(0, 40)}…"). ` +
      `Make sure you're pasting a direct link to a .gp/.gp4/.gp5 file.`,
    );
  }
}

async function tryDirect(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function viaProxy(url: string): Promise<Uint8Array> {
  if (!PROXY_BASE) {
    throw new Error(
      'Direct fetch was blocked by CORS and no proxy is configured. ' +
      'Drop the file in instead, or rebuild with REACT_APP_PROXY_BASE set.',
    );
  }
  const res = await fetch(`${PROXY_BASE}/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Proxy fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchGpFromUrl(url: string): Promise<FetchedGpFile> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Please paste a full URL starting with http:// or https://');
  }

  // Try direct first — if the host serves the right CORS headers we save a
  // hop. Otherwise fall back to the proxy.
  let bytes = await tryDirect(trimmed);
  if (!bytes) bytes = await viaProxy(trimmed);
  magicCheck(bytes);

  return { bytes, filename: deriveFilename(trimmed) };
}
