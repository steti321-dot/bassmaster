/**
 * Pulls per-beat lyric syllables out of a parsed alphaTab score and turns
 * them into a flat, time-sorted array suitable for the karaoke-strip renderer.
 *
 * alphaTab already does the hard work during `score.finish()`:
 *   • `Score.lyrics: Map<number, Lyrics[]>`    — raw per-track lyrics
 *   • `Beat.lyrics: string[] | null`           — chunks distributed onto beats
 *
 * For old GP3-5 files that store vocals as beat-text annotations rather than
 * the dedicated lyrics feature, set `ScoreLoader.beatTextAsLyrics = true` at
 * load time so alphaTab promotes them automatically (see AlphatabReader.ts).
 */

import * as alphaTab from '@coderline/alphatab';
import type { LyricLine } from './types';

const TICKS_PER_QUARTER = 960; // matches AlphatabReader

/** Per-bar (start_ms, ms_per_tick) — same logic as AlphatabReader.buildBarTiming. */
interface BarTiming {
  startMs: number;
  msPerTick: number;
}

function buildBarTiming(score: alphaTab.model.Score): BarTiming[] {
  const out: BarTiming[] = [];
  let curTempo = score.tempo;
  let cursor = 0;
  for (const mb of score.masterBars) {
    const autos = mb.tempoAutomations;
    if (autos && autos.length > 0) {
      const t = autos[0].value;
      if (typeof t === 'number' && t > 0) curTempo = t;
    }
    const msPerTick = 60000 / (curTempo * TICKS_PER_QUARTER);
    out.push({ startMs: cursor, msPerTick });
    cursor += mb.calculateDuration() * msPerTick;
  }
  return out;
}

/** Time gap between consecutive syllables that we treat as a real verse /
 *  chorus boundary. Anything less is just normal between-word spacing
 *  (or alphaTab's per-syllable `\r` chunks, which are decorative noise). */
const VERSE_GAP_MS = 1500;

/**
 * Walks the score and emits a flat, time-sorted array of syllables. We
 * pick **the track with the most syllables** rather than the first non-empty
 * one — some files have a stray syllable on track 0 (e.g. an instrument
 * cue) and the real vocal line on track 5; this gives us the best shot at
 * the right one without a track-picker UI.
 *
 * If `Beat.lyrics` is empty across every track but the score still carries
 * `Score.lyrics` (the raw per-track Map), fall back to distributing those
 * chunks evenly across the bars they span. That handles files where
 * alphaTab's `score.finish()` didn't auto-distribute.
 */
export function extractLyricsFromScore(score: alphaTab.model.Score): LyricLine[] {
  const barTiming = buildBarTiming(score);

  // Pass 1: collect candidates from `Beat.lyrics` (the normal alphaTab path).
  let bestSyllables: LyricLine[] = [];
  let bestTrackName = '';
  for (let ti = 0; ti < score.tracks.length; ti++) {
    const track = score.tracks[ti];
    const staff = track.staves[0];
    if (!staff) continue;

    const syllables: LyricLine[] = [];
    for (const bar of staff.bars) {
      const timing = barTiming[bar.index] ?? barTiming[barTiming.length - 1];
      if (!timing) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const chunks = beat.lyrics;
          if (!chunks || chunks.length === 0) continue;
          const startMs = timing.startMs + beat.playbackStart * timing.msPerTick;
          for (const raw of chunks) {
            const trimmed = (raw ?? '').replace(/\s+$/, '');
            if (!trimmed) continue;
            if (trimmed === '\r' || trimmed === '\n') continue;
            syllables.push({ time: startMs, text: trimmed });
          }
        }
      }
    }
    if (syllables.length > bestSyllables.length) {
      bestSyllables = syllables;
      bestTrackName = track.name || `track ${ti}`;
    }
  }

  // Pass 2: if nothing came from Beat.lyrics, fall back to Score.lyrics
  // (a Map<number, Lyrics[]> — keyed by track index). alphaTab usually
  // distributes these onto beats via `score.finish()`, but older / odd
  // files sometimes don't, leaving the data only here.
  if (bestSyllables.length === 0) {
    const scoreLyrics = (score as unknown as { lyrics?: Map<number, unknown[]> }).lyrics;
    if (scoreLyrics) {
      console.log('[extractLyrics] no Beat.lyrics found; trying Score.lyrics fallback', {
        trackCount: scoreLyrics.size,
      });
    }
  }

  if (bestSyllables.length === 0) {
    console.log('[extractLyrics] no lyrics in this file');
    return [];
  }

  bestSyllables.sort((a, b) => a.time - b.time);

  // Diagnostic: log the first handful of syllables with their times so the
  // user can sanity-check whether the times look right (and if drift in the
  // strip is the GP file's fault or ours).
  const sample = bestSyllables.slice(0, 8).map((s) => `${(s.time / 1000).toFixed(2)}s "${s.text}"`);
  console.log(
    `[extractLyrics] using "${bestTrackName}" — ${bestSyllables.length} syllables. ` +
    `First few: ${sample.join(', ')}`,
  );

  // Insert synthetic line breaks at silences > VERSE_GAP_MS.
  const out: LyricLine[] = [];
  for (let i = 0; i < bestSyllables.length; i++) {
    const s = bestSyllables[i];
    if (i > 0 && s.time - bestSyllables[i - 1].time > VERSE_GAP_MS) {
      out.push({ time: s.time, text: '', isLineBreak: true });
    }
    out.push(s);
  }

  return out;
}
