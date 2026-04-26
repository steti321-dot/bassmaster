/**
 * Postinstall script: downloads yt-dlp binary to bin/
 * Cross-platform: downloads yt-dlp.exe on Windows, yt-dlp on macOS/Linux
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN_DIR = path.join(__dirname, '..', 'bin');
const IS_WINDOWS = process.platform === 'win32';
const BINARY_NAME = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp';
const BINARY_PATH = path.join(BIN_DIR, BINARY_NAME);

if (fs.existsSync(BINARY_PATH)) {
  const size = fs.statSync(BINARY_PATH).size;
  console.log(`✓ yt-dlp already present at bin/${BINARY_NAME} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  process.exit(0);
}

if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

console.log(`⬇️  Downloading ${BINARY_NAME} to bin/...`);

try {
  const mod = await import('yt-dlp-wrap');
  const YTDlpWrap = mod.default.default || mod.default;
  await YTDlpWrap.downloadFromGithub(BINARY_PATH);
  const size = fs.statSync(BINARY_PATH).size;
  console.log(`✓ Downloaded ${BINARY_NAME} (${(size / 1024 / 1024).toFixed(1)} MB)`);
} catch (err) {
  console.error(`✗ Failed to download yt-dlp: ${err.message}`);
  console.error('  App will still work for local file uploads; YouTube URL mode requires yt-dlp.');
  process.exit(0);
}
