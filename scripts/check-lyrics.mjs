#!/usr/bin/env node
// Quick lyric audit — feeds a directory of .gp files to alphaTab and prints
// how many beats carry lyric chunks per track. Tells us which downloads are
// actually usable for karaoke (vs files where the "Voice" track is just notes
// without text, or where lyrics live in the comments field).
//
// Usage:  node scripts/check-lyrics.mjs <dir>
//
// Designed to be run against a scratch dir of GP files (e.g. /tmp/lyric-check
// produced by the gprotab batch downloads in this session).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as alphaTab from '@coderline/alphatab';

const dir = process.argv[2] || '/tmp/lyric-check';

// Promote beat-text to lyrics for old GP3 files that abused the text field.
try { alphaTab.importer.ScoreLoader.beatTextAsLyrics = true; } catch {}

const files = readdirSync(dir).filter((f) => f.endsWith('.gp'));
if (files.length === 0) {
  console.error(`No .gp files in ${dir}`);
  process.exit(1);
}

for (const f of files) {
  const path = join(dir, f);
  const size = statSync(path).size;
  if (size < 100) continue; // skip error responses

  let score;
  try {
    const buf = new Uint8Array(readFileSync(path));
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(buf);
  } catch (err) {
    console.log(`${f.padEnd(28)}  PARSE ERROR: ${err.message}`);
    continue;
  }

  // Per-track count of beats with lyric chunks
  const trackStats = score.tracks.map((t, ti) => {
    let beatsWithLyrics = 0;
    let totalChunks = 0;
    let firstFew = [];
    const staff = t.staves[0];
    if (!staff) return { ti, name: t.name, beatsWithLyrics, totalChunks, firstFew };
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const chunks = beat.lyrics;
          if (chunks && chunks.length > 0) {
            const real = chunks.filter((c) => c && c.replace(/\s+$/, '') && c !== '\r' && c !== '\n');
            if (real.length > 0) {
              beatsWithLyrics++;
              totalChunks += real.length;
              if (firstFew.length < 6) firstFew.push(...real.slice(0, 6 - firstFew.length));
            }
          }
        }
      }
    }
    return { ti, name: t.name, beatsWithLyrics, totalChunks, firstFew };
  });

  const best = trackStats.reduce((a, b) => (b.totalChunks > a.totalChunks ? b : a), trackStats[0]);
  const tag = best.totalChunks > 10 ? ' ✅' : best.totalChunks > 0 ? ' (sparse)' : '';
  console.log(
    `${f.padEnd(28)}  ${score.title?.padEnd(30)} ` +
    `best="${best.name}" syl=${best.totalChunks}${tag}` +
    (best.firstFew.length ? `  ${best.firstFew.map((s) => `"${s}"`).join(' ')}` : ''),
  );
}
