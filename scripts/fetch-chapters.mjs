#!/usr/bin/env node
/**
 * Extract YouTube chapter markers and save them in the CLI-compatible format:
 *   <seconds> <title>
 *
 * Usage: node scripts/fetch-chapters.mjs <youtube-url> [output.txt]
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YT_DLP = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

const url = process.argv[2];
const outputPath = process.argv[3];

if (!url) {
  console.error('Usage: node scripts/fetch-chapters.mjs <youtube-url> [output.txt]');
  process.exit(1);
}

const result = spawnSync(YT_DLP, ['--js-runtimes', 'bun', '--no-playlist', '--dump-json', url], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.status !== 0) {
  console.error('yt-dlp failed:', result.stderr);
  process.exit(1);
}

const info = JSON.parse(result.stdout);
if (!info.chapters || info.chapters.length === 0) {
  console.error('No chapters found in video metadata.');
  process.exit(1);
}

const lines = info.chapters.map((c) => `${c.start_time.toFixed(1)} ${c.title}`);
const output = [
  `# Chapters for: ${info.title}`,
  `# Source: ${url}`,
  `# ${info.chapters.length} chapters`,
  ...lines,
].join('\n');

if (outputPath) {
  fs.writeFileSync(outputPath, output + '\n');
  console.log(`✓ Wrote ${info.chapters.length} chapters to ${outputPath}`);
} else {
  console.log(output);
}
