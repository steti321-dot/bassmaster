/**
 * GP-format reader powered by @coderline/alphatab.
 *
 * Used as a fallback for any version our hand-rolled GP3/GP4 parser doesn't
 * understand (GP5, GP6/GPX, GP7). alphatab is a maintained TS library with
 * full coverage; we just adapt its Score model to our Song/GameNote shape.
 */

import * as alphaTab from '@coderline/alphatab';
import type { Song, GameNote, SongTrack } from './types';
import type { InstrumentKind } from './Instrument';
import type { GpFileSummary, GpTrackInfo } from './Gp4Reader';
import { midiProgramName } from './Gp4Reader';
import { extractLyricsFromScore } from './extractLyrics';

// Promote beat-text annotations to real lyrics for older GP3-5 files that
// stored vocals there before the dedicated lyrics feature existed.
try {
  (alphaTab.importer.ScoreLoader as any).beatTextAsLyrics = true;
} catch { /* alphaTab API may rename this in future versions */ }

const TICKS_PER_QUARTER = 960; // alphatab's MidiUtils.QuarterTime

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function trackKind(track: alphaTab.model.Track): InstrumentKind {
  // Drum tracks are picked up separately (isDrums flag); for melodic tracks,
  // bass = ≤4 strings or "bass" in the program name.
  const tuning = track.staves[0]?.tuning ?? [];
  if (tuning.length && tuning.length <= 4) return 'bass';
  const program = track.playbackInfo?.program ?? -1;
  if (program >= 32 && program <= 39) return 'bass'; // GM bass patches
  return 'guitar';
}

function isDrumTrack(track: alphaTab.model.Track): boolean {
  if (track.staves[0]?.isPercussion) return true;
  // GM drum channel is 9 (0-indexed).
  if (track.playbackInfo && track.playbackInfo.primaryChannel === 9) return true;
  return false;
}

/**
 * Build a per-bar (start_ms, ms_per_tick) map so we can convert tick offsets
 * to milliseconds even when the song has tempo automations across bars.
 */
function buildBarTiming(score: alphaTab.model.Score): { startMs: number; msPerTick: number }[] {
  const bars = score.masterBars;
  const out: { startMs: number; msPerTick: number }[] = [];
  let curTempo = score.tempo;
  let cursor = 0;
  for (const mb of bars) {
    // Pick up tempo change at the start of this bar, if any
    const autos = mb.tempoAutomations;
    if (autos && autos.length > 0) {
      const t = autos[0].value;
      if (typeof t === 'number' && t > 0) curTempo = t;
    }
    const msPerTick = 60000 / (curTempo * TICKS_PER_QUARTER);
    out.push({ startMs: cursor, msPerTick });
    const durationTicks = mb.calculateDuration();
    cursor += durationTicks * msPerTick;
  }
  return out;
}

interface ConvertOptions {
  trackIndex?: number;
  instrumentHint?: InstrumentKind;
}

function convertScore(score: alphaTab.model.Score, options: ConvertOptions = {}): Song {
  const barTiming = buildBarTiming(score);
  const songTracks: SongTrack[] = [];

  for (let ti = 0; ti < score.tracks.length; ti++) {
    const track = score.tracks[ti];
    const staff = track.staves[0];
    if (!staff) continue;

    const stringCount = staff.tuning?.length ?? 0;
    const isDrums = isDrumTrack(track);
    const kind = trackKind(track);
    const notes: GameNote[] = [];

    for (const bar of staff.bars) {
      const timing = barTiming[bar.index] ?? barTiming[barTiming.length - 1];
      if (!timing) continue;
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.isEmpty || beat.notes.length === 0) continue;
          // beat.playbackStart is ticks-within-bar. Combine with bar start.
          const startMs = timing.startMs + beat.playbackStart * timing.msPerTick;
          const durMs = beat.playbackDuration * timing.msPerTick;
          for (const n of beat.notes) {
            // Skip notes with no real fret position (tied destinations, dead
            // notes, ghost markers — alphatab returns fret < 0 for these).
            // Also reject implausible frets (>30) — these come from malformed
            // GP files where the fret byte is a sentinel like 0xFF.
            if (
              !isDrums &&
              (n.fret < 0 || n.fret > 30 || n.isTieDestination || n.isDead)
            ) {
              continue;
            }

            // alphatab string is 1-indexed from the lowest-pitch string;
            // our convention is 0-indexed from the highest. Translate.
            const ourString = stringCount > 0
              ? Math.max(0, Math.min(stringCount - 1, stringCount - n.string))
              : 0;
            const realValue = n.calculateRealValue(true, false);
            notes.push({
              time: startMs,
              duration: Math.max(60, durMs),
              string: ourString,
              fret: isDrums ? realValue : n.fret,
              frequency: isDrums ? 0 : midiToFreq(realValue),
            });
          }
        }
      }
    }

    notes.sort((a, b) => a.time - b.time);

    const program = track.playbackInfo?.program ?? -1;
    const programLabel = !isDrums && program >= 0 ? midiProgramName(program) : '';
    const displayName = track.name + (programLabel && programLabel !== `Program ${program}` ? ` — ${programLabel}` : '');

    songTracks.push({
      index: ti,
      name: displayName,
      instrument: kind,
      isDrums,
      notes,
      tuning: (staff.tuning ?? []).slice(),
    });
  }

  // Pick the player track.
  let chosenIdx = 0;
  if (typeof options.trackIndex === 'number' && options.trackIndex >= 0 && options.trackIndex < songTracks.length) {
    chosenIdx = options.trackIndex;
  } else if (options.instrumentHint) {
    const want = options.instrumentHint;
    const m = songTracks.findIndex((t) => t.instrument === want && !t.isDrums);
    if (m >= 0) chosenIdx = m;
  } else {
    const m = songTracks.findIndex((t) => !t.isDrums);
    if (m >= 0) chosenIdx = m;
  }

  const backingEnabled = new Set<number>();
  for (let i = 0; i < songTracks.length; i++) if (i !== chosenIdx) backingEnabled.add(i);
  if (backingEnabled.size === 0) backingEnabled.add(chosenIdx);

  const chosen = songTracks[chosenIdx];
  const lyrics = extractLyricsFromScore(score);
  return {
    title: score.title || 'Untitled',
    artist: score.artist || undefined,
    tempo: score.tempo,
    tracks: songTracks,
    playerTrackIndex: chosenIdx,
    backingEnabled,
    notes: chosen?.notes ?? [],
    instrument: chosen?.instrument ?? 'guitar',
    lyrics: lyrics.length > 0 ? lyrics : undefined,
  };
}

function loadScore(bytes: Uint8Array): alphaTab.model.Score {
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
  } catch (err) {
    // alphatab throws raw RangeErrors etc on malformed/truncated files.
    // Wrap into a friendlier message that tells the user what to try next.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse Guitar Pro file (alphatab: ${detail}). ` +
      `The file may be corrupted or use an unsupported variant. ` +
      `Try re-saving it from Guitar Pro 6/7 or TuxGuitar as a fresh .gp5 / .gp4.`,
    );
  }
}

export function parseGpWithAlphatab(
  bytes: Uint8Array,
  instrumentHint?: InstrumentKind,
  trackIndex?: number
): Song {
  const score = loadScore(bytes);
  return convertScore(score, { trackIndex, instrumentHint });
}

export function inspectGpWithAlphatab(bytes: Uint8Array): GpFileSummary {
  const score = loadScore(bytes);
  const tracks: GpTrackInfo[] = score.tracks.map((track, idx) => {
    const staff = track.staves[0];
    const tuning = staff?.tuning ?? [];
    const isBass = trackKind(track) === 'bass';
    const program = track.playbackInfo?.program ?? -1;
    const programLabel = program >= 0 ? midiProgramName(program) : 'Unknown';
    return {
      index: idx,
      name: track.name + (programLabel && programLabel !== 'Unknown' ? ` — ${programLabel}` : ''),
      stringCount: tuning.length,
      midiTunings: tuning.slice(),
      instrument: isBass ? 'bass' : 'guitar',
    };
  });
  return {
    title: score.title || 'Untitled',
    artist: score.artist || '',
    tempo: score.tempo,
    numMeasures: score.masterBars.length,
    tracks,
  };
}
