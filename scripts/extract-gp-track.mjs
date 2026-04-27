// Generic GP-track extractor → emits a TS array literal of {time,duration,string,fret}.
//
// Usage: node scripts/extract-gp-track.mjs <gp-file> [trackIndex] [maxBars]
//
//   trackIndex defaults to 0 (first track)
//   maxBars defaults to 8 (first 8 bars only)

import { readFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';

const TPQ = 960;
const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/extract-gp-track.mjs <gp-file> [trackIndex] [maxBars]');
  process.exit(1);
}
const trackIndex = parseInt(process.argv[3] ?? '0', 10);
const maxBars = parseInt(process.argv[4] ?? '8', 10);

const bytes = new Uint8Array(readFileSync(path));
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);

console.error(`Title:  ${score.title}`);
console.error(`Artist: ${score.artist}`);
console.error(`Tempo:  ${score.tempo}`);
console.error(`Tracks:`);
score.tracks.forEach((t, i) => {
  const tuning = t.staves[0]?.tuning ?? [];
  console.error(`  [${i}]${i === trackIndex ? '*' : ' '} ${t.name}  strings=${tuning.length}  isPerc=${t.staves[0]?.isPercussion}  prog=${t.playbackInfo?.program}`);
});

const track = score.tracks[trackIndex];
if (!track) { console.error(`No track at index ${trackIndex}`); process.exit(1); }
const staff = track.staves[0];
const tuning = staff.tuning.slice();
console.error(`\nUsing track [${trackIndex}]: ${track.name}`);
console.error(`Tuning: ${JSON.stringify(tuning)} (${tuning.map(midiToName).join(' ')})`);

// Build per-bar timing
const bars = [];
{
  let curTempo = score.tempo;
  let cursor = 0;
  for (const mb of score.masterBars) {
    const autos = mb.tempoAutomations;
    if (autos && autos.length > 0) {
      const t = autos[0].value;
      if (typeof t === 'number' && t > 0) curTempo = t;
    }
    const msPerTick = 60000 / (curTempo * TPQ);
    bars.push({ startMs: cursor, msPerTick });
    cursor += mb.calculateDuration() * msPerTick;
  }
}

const stringCount = tuning.length;
const cutoffMs = bars[Math.min(maxBars, bars.length - 1)]?.startMs ?? Number.POSITIVE_INFINITY;

const notes = [];
for (const bar of staff.bars) {
  if (bar.index >= maxBars) break;
  const timing = bars[bar.index];
  if (!timing) continue;
  for (const v of bar.voices) {
    for (const beat of v.beats) {
      if (beat.isEmpty || beat.notes.length === 0) continue;
      const startMs = timing.startMs + beat.playbackStart * timing.msPerTick;
      if (startMs >= cutoffMs) continue;
      const durMs = beat.playbackDuration * timing.msPerTick;
      for (const n of beat.notes) {
        if (n.fret < 0 || n.fret > 30 || n.isTieDestination || n.isDead) continue;
        const ourString = Math.max(0, Math.min(stringCount - 1, stringCount - n.string));
        notes.push({
          time: Math.round(startMs),
          duration: Math.max(60, Math.round(durMs)),
          string: ourString,
          fret: n.fret,
        });
      }
    }
  }
}
notes.sort((a, b) => a.time - b.time || a.string - b.string);

console.error(`\nExtracted ${notes.length} notes (≤${maxBars} bars, cut at ${Math.round(cutoffMs)}ms)`);

console.log(`// auto-generated from ${path.split(/[\\/]/).pop()}`);
console.log(`// track=${trackIndex} (${track.name}), tempo=${score.tempo}, tuning=${JSON.stringify(tuning)}`);
console.log(`const TEMPO = ${score.tempo};`);
console.log('const NOTES: Array<{ time: number; duration: number; string: number; fret: number }> = [');
for (const n of notes) {
  console.log(`  { time: ${n.time}, duration: ${n.duration}, string: ${n.string}, fret: ${n.fret} },`);
}
console.log('];');

function midiToName(m) {
  const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return `${N[((m % 12) + 12) % 12]}${Math.floor(m/12)-1}`;
}
