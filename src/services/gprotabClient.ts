/**
 * Cross-target gprotab.net client.
 *
 * In Electron builds: forwards to `window.electronAPI.gprotab*` (which
 * uses Node's fetch in the main process to bypass CORS).
 *
 * In web builds: hits a Cloudflare Worker proxy whose URL is injected
 * at build time via `REACT_APP_PROXY_BASE`. The Worker re-implements
 * the same logic (gprotab search HTML scrape, download `?download` URL).
 *
 * Either way, callers get the same shape — search returns up to 30
 * results, download returns `{ data: Uint8Array, filename: string }`.
 */

export interface GprotabResult {
  artist: string;
  title: string;
  url: string;
}

export interface GprotabDownloadResult {
  data: Uint8Array;
  filename: string;
}

const PROXY_BASE = (process.env.REACT_APP_PROXY_BASE || '').replace(/\/+$/, '');

function hasElectronApi(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.gprotabSearch;
}

export async function gprotabSearch(query: string): Promise<GprotabResult[]> {
  if (hasElectronApi()) {
    return await (window as any).electronAPI.gprotabSearch(query);
  }
  if (!PROXY_BASE) {
    throw new Error('Search is unavailable in this build (no proxy configured).');
  }
  const res = await fetch(`${PROXY_BASE}/gprotab/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`gprotab search failed: HTTP ${res.status}`);
  return (await res.json()) as GprotabResult[];
}

export async function gprotabDownload(tabUrl: string): Promise<GprotabDownloadResult> {
  if (hasElectronApi()) {
    return await (window as any).electronAPI.gprotabDownload(tabUrl);
  }
  if (!PROXY_BASE) {
    throw new Error('Download is unavailable in this build (no proxy configured).');
  }
  const res = await fetch(
    `${PROXY_BASE}/gprotab/download?url=${encodeURIComponent(tabUrl)}`,
  );
  if (!res.ok) throw new Error(`gprotab download failed: HTTP ${res.status}`);
  // Worker returns the raw bytes with a Content-Disposition header for filename
  const cd = res.headers.get('content-disposition') ?? '';
  let filename = '';
  const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (fnMatch) filename = decodeURIComponent(fnMatch[1]);
  if (!filename) filename = 'tab.gp5';
  const buf = new Uint8Array(await res.arrayBuffer());
  return { data: buf, filename };
}

/** True when this build can talk to a gprotab proxy at all. */
export function gprotabAvailable(): boolean {
  return hasElectronApi() || PROXY_BASE.length > 0;
}
