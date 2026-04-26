/**
 * Guitar Workbench web proxy.
 *
 * Three endpoints, all GET, all add permissive CORS headers so the static
 * GH Pages frontend can call them from any origin:
 *
 *   /proxy?url=<encoded>
 *     → fetch the given URL server-side, stream the body back. Used for
 *       paste-URL when the host doesn't serve CORS for .gp files.
 *
 *   /gprotab/search?q=<query>
 *     → scrape the gprotab.net search page, return up to 30 results as JSON.
 *
 *   /gprotab/download?url=<encoded gprotab tab URL>
 *     → fetch the gprotab page with `?download` appended, stream the .gp
 *       bytes back with the original Content-Disposition.
 *
 * Mirrors the logic in `../../src/electron/main.ts`'s `gprotab-search` and
 * `gprotab-download` handlers, plus a generic proxy.
 */

const GPROTAB_BASE = 'https://gprotab.net';
const UA = 'Mozilla/5.0 (compatible; GuitarWorkbench/1.0; +https://gprotab.net)';

function corsHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' }),
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function handleProxy(request: Request, url: URL): Promise<Response> {
  const target = url.searchParams.get('url');
  if (!target) return errorResponse('Missing ?url=');
  if (!/^https?:\/\//i.test(target)) return errorResponse('URL must be http(s)');

  const upstream = await fetch(target, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
  });
  if (!upstream.ok) {
    return errorResponse(`Upstream returned HTTP ${upstream.status}`, 502);
  }

  // Stream body through; preserve a few useful headers.
  const headers = corsHeaders({
    'Content-Type':
      upstream.headers.get('content-type') ?? 'application/octet-stream',
  });
  const cd = upstream.headers.get('content-disposition');
  if (cd) (headers as Record<string, string>)['Content-Disposition'] = cd;

  return new Response(upstream.body, { status: 200, headers });
}

async function handleSearch(url: URL): Promise<Response> {
  const q = url.searchParams.get('q');
  if (!q) return jsonResponse([]);

  const searchUrl = `${GPROTAB_BASE}/en/search/?q=${encodeURIComponent(q.trim())}`;
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) return errorResponse(`gprotab search HTTP ${res.status}`, 502);
  const html = await res.text();

  // Same regex used in src/electron/main.ts:gprotab-search.
  const linkRegex = /<a[^>]+href="(\/en\/tabs\/([^/"]+)\/([^"]+))"[^>]*>([^<]+)<\/a>/gi;
  const seen = new Set<string>();
  const out: Array<{ artist: string; title: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const titleText = m[4].trim();
    if (!titleText) continue;
    const artistSlug = decodeURIComponent(m[2]).replace(/-/g, ' ');
    out.push({
      artist: artistSlug.replace(/\b\w/g, (c) => c.toUpperCase()),
      title: titleText,
      url: `${GPROTAB_BASE}${path}`,
    });
    if (out.length >= 30) break;
  }
  return jsonResponse(out);
}

async function handleDownload(url: URL): Promise<Response> {
  const tabUrl = url.searchParams.get('url');
  if (!tabUrl) return errorResponse('Missing ?url=');
  if (!tabUrl.startsWith(`${GPROTAB_BASE}/`)) {
    return errorResponse('Invalid gprotab URL');
  }
  const downloadUrl = tabUrl.includes('?')
    ? `${tabUrl}&download`
    : `${tabUrl}?download`;
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
  });
  if (!res.ok) return errorResponse(`gprotab download HTTP ${res.status}`, 502);

  const buf = new Uint8Array(await res.arrayBuffer());
  // Magic-byte sanity check: every Guitar Pro file starts with a 1-byte
  // length prefix followed by "FICHIER GUITAR PRO". HTML responses (rate
  // limit, captcha) get rejected here.
  const head = new TextDecoder('latin1').decode(buf.subarray(1, 19));
  if (!head.startsWith('FICHIER GUITAR PRO')) {
    return errorResponse('Download did not return a Guitar Pro file', 502);
  }

  const cd = res.headers.get('content-disposition') ?? 'attachment; filename="tab.gp5"';
  return new Response(buf, {
    status: 200,
    headers: corsHeaders({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': cd,
    }),
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return errorResponse('Only GET supported', 405);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '') return statusPage();
      if (url.pathname === '/proxy') return await handleProxy(request, url);
      if (url.pathname === '/gprotab/search') return await handleSearch(url);
      if (url.pathname === '/gprotab/download') return await handleDownload(url);
      return errorResponse('Not found', 404);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return errorResponse(detail, 500);
    }
  },
};

function statusPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Guitar Workbench proxy</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
           background: #07090d; color: #d6efff;
           max-width: 720px; margin: 60px auto; padding: 0 20px; line-height: 1.55; }
    h1 { color: #00f5ff; letter-spacing: 0.06em; }
    code { background: rgba(0,245,255,0.08); padding: 2px 6px; border-radius: 3px; color: #fff066; }
    a { color: #00f5ff; }
    .ok { color: #2dff8b; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🎸 Guitar Workbench proxy</h1>
  <p class="ok">✓ Online</p>
  <p>This worker is the CORS-bypass proxy used by the
     <a href="https://github.com/">Guitar Workbench</a> web app to fetch
     Guitar Pro tabs from third-party hosts. It exposes three endpoints:</p>
  <ul>
    <li><code>GET /gprotab/search?q=…</code> — search gprotab.net</li>
    <li><code>GET /gprotab/download?url=…</code> — download a gprotab tab</li>
    <li><code>GET /proxy?url=…</code> — generic CORS-bypass for direct .gp URLs</li>
  </ul>
  <p>If you're seeing this page, the worker is up — open the actual app instead.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: corsHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
  });
}
