import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;

// __dirname at runtime is <project>/dist (see tsconfig.electron.json outDir)
const PROJECT_ROOT = path.join(__dirname, '..');

const YT_DLP_PATH = path.join(
  PROJECT_ROOT,
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

const TRANSCRIBE_PATH = path.join(
  PROJECT_ROOT,
  'target',
  'release',
  process.platform === 'win32' ? 'transcribe.exe' : 'transcribe'
);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(PROJECT_ROOT, 'build', 'index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * IPC Handler: Download YouTube audio via yt-dlp.exe binary
 * Spawns yt-dlp as subprocess, captures audio to temp file, reads back as buffer.
 */
ipcMain.handle('download-youtube-audio', async (event, url: string): Promise<{ data: number[]; extension: string }> => {
  if (!fs.existsSync(YT_DLP_PATH)) {
    throw new Error(`yt-dlp not found at ${YT_DLP_PATH}. Run: node scripts/setup-ytdlp.mjs`);
  }

  const tempDir = app.getPath('temp');
  const outputTemplate = path.join(tempDir, `yt-audio-${Date.now()}.%(ext)s`);

  return new Promise((resolve, reject) => {
    // Force M4A (AAC in MP4 container, format 140 on YouTube) so symphonia can decode it.
    // Fallback to any AAC m4a stream, then anything else if those fail.
    const proc = spawn(YT_DLP_PATH, [
      '-f', '140/bestaudio[ext=m4a]/bestaudio',
      '-o', outputTemplate,
      '--no-playlist',
      '--progress',
      '--newline',
      '--js-runtimes', 'bun',
      url,
    ]);

    let downloadedFile: string | null = null;

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFile = destMatch[1].trim();
      }
      const progressMatch = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        event.sender.send('youtube-download-progress', Math.round(percent));
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error('[yt-dlp stderr]', data.toString());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      if (!downloadedFile || !fs.existsSync(downloadedFile)) {
        reject(new Error('yt-dlp completed but no output file found'));
        return;
      }

      try {
        const buffer = fs.readFileSync(downloadedFile);
        const extension = path.extname(downloadedFile) || '.m4a';
        fs.unlinkSync(downloadedFile);
        resolve({ data: Array.from(buffer), extension });
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', reject);
  });
});

/**
 * IPC Handler: Get YouTube video info via yt-dlp --dump-json
 */
ipcMain.handle('get-youtube-info', async (_event, url: string) => {
  if (!fs.existsSync(YT_DLP_PATH)) {
    throw new Error('yt-dlp not installed');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, ['--dump-json', '--no-playlist', '--js-runtimes', 'bun', url]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title,
          author: info.uploader || info.channel,
          lengthSeconds: info.duration,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
});

/**
 * IPC Handler: Save GP4 file via native file dialog
 */
ipcMain.handle(
  'save-gp4-file',
  async (_event, dataArray: number[], defaultName: string): Promise<string | null> => {
    if (!mainWindow) return null;

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save GP4 File',
      defaultPath: defaultName,
      filters: [
        { name: 'Guitar Pro 4 Files', extensions: ['gp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const buffer = Buffer.from(dataArray);
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
  }
);

/**
 * IPC Handler: Run the Rust transcribe CLI on an audio file or raw audio bytes.
 * Returns the parsed notes JSON along with the GP4 file bytes.
 */
ipcMain.handle(
  'transcribe-audio',
  async (
    event,
    options: {
      inputPath?: string; // Pre-existing file path (from YouTube download)
      inputData?: number[]; // Or raw bytes to write to a temp file (from file upload)
      inputFilename?: string; // Used with inputData to pick an extension
      useAi?: boolean;
      polyphonic?: boolean;
      instrument?: 'guitar' | 'bass';
      cleanDrums?: boolean;
    }
  ): Promise<{ notes: any[]; tempo: number; timeSignature: any; instrument: 'guitar' | 'bass'; gp4Data: number[]; gp4Path: string }> => {
    if (!fs.existsSync(TRANSCRIBE_PATH)) {
      throw new Error(`transcribe binary not found at ${TRANSCRIBE_PATH}. Run: cargo build --release`);
    }

    const tempDir = app.getPath('temp');
    const runId = `mp3togp4-${Date.now()}`;

    // If raw bytes provided, write them to a temp file with the right extension
    let inputPath = options.inputPath;
    let cleanupInput = false;
    if (!inputPath && options.inputData && options.inputFilename) {
      const ext = path.extname(options.inputFilename) || '.m4a';
      inputPath = path.join(tempDir, `${runId}-input${ext}`);
      fs.writeFileSync(inputPath, Buffer.from(options.inputData));
      cleanupInput = true;
    }

    if (!inputPath) {
      throw new Error('No input provided: pass inputPath or inputData');
    }

    const gp4Path = path.join(tempDir, `${runId}.gp4`);
    const jsonPath = path.join(tempDir, `${runId}.json`);

    const args = [inputPath, gp4Path, '--json', jsonPath];
    if (options.useAi) args.push('--ai');
    else if (options.polyphonic) args.push('--chords');
    if (options.instrument === 'bass') args.push('--bass');
    if (options.cleanDrums) args.push('--clean');

    return new Promise((resolve, reject) => {
      const proc = spawn(TRANSCRIBE_PATH, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        // Forward progress messages to renderer
        for (const line of text.split('\n')) {
          if (line.trim()) event.sender.send('transcribe-progress', line.trim());
        }
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (cleanupInput && inputPath) {
          try {
            fs.unlinkSync(inputPath);
          } catch {}
        }

        if (code !== 0) {
          reject(new Error(`transcribe exited ${code}: ${stderr || stdout}`));
          return;
        }

        try {
          const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          const gp4Bytes = fs.readFileSync(gp4Path);

          // Keep gp4 on disk for now, caller can save it later
          resolve({
            notes: parsed.notes,
            tempo: parsed.tempo,
            timeSignature: parsed.timeSignature,
            instrument: parsed.instrument || 'guitar',
            gp4Data: Array.from(gp4Bytes),
            gp4Path,
          });

          // Cleanup json but not gp4 (caller may save it)
          try {
            fs.unlinkSync(jsonPath);
          } catch {}
        } catch (err) {
          reject(err);
        }
      });

      proc.on('error', reject);
    });
  }
);

/**
 * gprotab.net integration. Search results + download proxy via main process
 * (CORS would block this from the renderer). Their download links are HTML
 * pages with a `?download` query param that returns the .gp file body.
 *
 * Source: https://gprotab.net/ — tabs are user-submitted; we surface them
 * for personal practice. Attribution appears in the picker UI.
 */
const GPROTAB_BASE = 'https://gprotab.net';
const GPROTAB_UA = 'Mozilla/5.0 (compatible; GuitarWorkbench/1.0; +https://gprotab.net)';

async function gprotabFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': GPROTAB_UA,
      Accept: 'text/html,application/octet-stream,*/*',
    },
  });
}

export interface GprotabResult {
  artist: string;
  title: string;
  url: string; // absolute https://gprotab.net/...
}

ipcMain.handle('gprotab-search', async (_event, query: string): Promise<GprotabResult[]> => {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const searchUrl = `${GPROTAB_BASE}/en/search/?q=${q}`;
  const res = await gprotabFetch(searchUrl);
  if (!res.ok) throw new Error(`gprotab search failed: HTTP ${res.status}`);
  const html = await res.text();

  // Parse the result rows. The search page shows results as
  //   <a href="/en/tabs/<artist-slug>/<song-slug>">Song Title</a>
  // wrapped in a row with the artist name nearby. We extract every tab link
  // and dedupe by URL; the artist is recovered from the slug if missing.
  const out: GprotabResult[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]+href="(\/en\/tabs\/([^/"]+)\/([^"]+))"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const artistSlug = decodeURIComponent(m[2]).replace(/-/g, ' ');
    const titleText = m[4].trim();
    if (!titleText) continue;
    out.push({
      artist: artistSlug.replace(/\b\w/g, (c) => c.toUpperCase()),
      title: titleText,
      url: `${GPROTAB_BASE}${path}`,
    });
    if (out.length >= 30) break;
  }
  return out;
});

ipcMain.handle(
  'gprotab-download',
  async (_event, tabUrl: string): Promise<{ data: number[]; filename: string }> => {
    if (!tabUrl.startsWith(`${GPROTAB_BASE}/`)) {
      throw new Error('Invalid gprotab URL');
    }
    // The download is served at <tab-url>?download
    const downloadUrl = tabUrl.includes('?')
      ? `${tabUrl}&download`
      : `${tabUrl}?download`;

    const res = await gprotabFetch(downloadUrl);
    if (!res.ok) throw new Error(`gprotab download failed: HTTP ${res.status}`);

    // Extract filename from Content-Disposition if present, else build one.
    const cd = res.headers.get('content-disposition') ?? '';
    let filename = '';
    const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (fnMatch) filename = decodeURIComponent(fnMatch[1]);
    if (!filename) {
      // Fall back to slug-based name; default to .gp5 since most gprotab uploads are gp5.
      const slug = tabUrl.replace(`${GPROTAB_BASE}/en/tabs/`, '').replace(/\//g, '-');
      filename = `${slug}.gp5`;
    }

    const buf = Buffer.from(await res.arrayBuffer());

    // Sanity check: every Guitar Pro file starts with a 1-byte length prefix
    // followed by "FICHIER GUITAR PRO". If we got HTML or some other payload
    // (rate-limit page, redirect, captcha), bail with a clear error rather
    // than passing junk to the parser later.
    const header = buf.subarray(1, 19).toString('ascii');
    if (!header.startsWith('FICHIER GUITAR PRO')) {
      const preview = buf.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ');
      throw new Error(
        `Download did not return a Guitar Pro file (got ${buf.length} bytes ` +
        `starting with "${preview.slice(0, 40)}..."). ` +
        `gprotab.net may have rate-limited the request or changed its layout.`,
      );
    }
    return { data: Array.from(buf), filename };
  }
);

app.on('ready', () => {
  // Set Content Security Policy. Permissive in dev (so react-scripts HMR works),
  // strict in production. Silences the Electron security warning.
  const isDev = process.env.NODE_ENV === 'development';
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws://localhost:* http://localhost:*; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; " +
      "style-src 'self' 'unsafe-inline' http://localhost:*; " +
      "connect-src 'self' ws://localhost:* http://localhost:* https:; " +
      "img-src 'self' data: blob: https:; " +
      "media-src 'self' data: blob: https:;"
    : "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "media-src 'self' data: blob:; " +
      "connect-src 'self';";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
