import type { InstrumentKind } from './Instrument';

/**
 * A single playable note in the game timeline.
 * Identical shape to the Note used by Tab 1's TabPreview / transcribe CLI.
 */
export interface GameNote {
  /** Time of note onset in milliseconds from song start. */
  time: number;
  /** Note duration in milliseconds. */
  duration: number;
  /** String index, 0 = highest-pitch string (matches Instrument.tuningsHz order). */
  string: number;
  /** Fret number, 0 = open. */
  fret: number;
  /** Expected fundamental frequency at this fret. */
  frequency: number;
  /**
   * Left-hand fingering when known.
   * 0 = thumb, 1 = index, 2 = middle, 3 = ring, 4 = pinky.
   * undefined = not specified in source; UI may compute a recommendation.
   */
  finger?: number;
  /** Measure (bar) index where this note starts, 0-indexed. Populated during GP file parse. */
  measureNumber?: number;
  /** Numerator of the time signature at this measure (e.g., 4 for 4/4). */
  timeSignatureNumerator?: number;
  /** Denominator of the time signature at this measure (e.g., 4 for 4/4). */
  timeSignatureDenominator?: number;
}

/**
 * One track of a song. Every parsed GP file produces a list of these — one
 * for each track in the file. The "player" track is the one the user plays;
 * the others can be enabled as backing tracks.
 */
export interface SongTrack {
  index: number;
  name: string;
  instrument: InstrumentKind;
  isDrums: boolean;
  notes: GameNote[];
  /** MIDI numbers per string, ordered high → low (matches GameNote.string index). */
  tuning: number[];
}

/**
 * One karaoke-style syllable in the song's vocal line, sorted by time.
 * Extracted by `extractLyrics.ts` from the first track that carries lyrics
 * in the parsed alphaTab score (`Beat.lyrics`).
 */
export interface LyricLine {
  /** Onset time of the syllable, in milliseconds from song start. */
  time: number;
  /** The text to show — typically a syllable like "walk" / "in'" / "the". */
  text: string;
  /**
   * True at sentence/line breaks. Renderer inserts a small visual gap so
   * phrases don't run together while still rendering on a single horizontal
   * row. alphaTab encodes line breaks with a `\r` between chunks.
   */
  isLineBreak?: boolean;
}

export interface Song {
  title: string;
  artist?: string;
  tempo: number;
  /** All tracks parsed from the source file. */
  tracks: SongTrack[];
  /** Which entry in `tracks` the player plays. */
  playerTrackIndex: number;
  /** Which other tracks are enabled as backing (set of track indices). */
  backingEnabled: Set<number>;
  /** Convenience accessor: tracks[playerTrackIndex].notes */
  notes: GameNote[];
  /** Convenience accessor: tracks[playerTrackIndex].instrument */
  instrument: InstrumentKind;
  /** Source file path (or 'demo' for the synthetic demo). */
  source?: string;
  /**
   * Karaoke-style per-syllable lyric timings, sorted by time. Absent if the
   * source file carries no lyrics (or if it was loaded via the hand-rolled
   * `Gp4Reader.ts` fallback path which discards lyrics).
   */
  lyrics?: LyricLine[];
}

export type Difficulty = 'easy' | 'medium' | 'strict';

export interface DifficultyConfig {
  /** Pitch tolerance, ± cents. */
  pitchToleranceCents: number;
  /** Timing window, ± milliseconds. */
  timingWindowMs: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { pitchToleranceCents: 50, timingWindowMs: 250 },
  medium: { pitchToleranceCents: 50, timingWindowMs: 150 },
  strict: { pitchToleranceCents: 25, timingWindowMs: 75 },
};

export type NoteResult = 'pending' | 'hit' | 'miss';

export interface ScoreState {
  score: number;
  combo: number;
  bestCombo: number;
  hits: number;
  misses: number;
}

export const INITIAL_SCORE: ScoreState = {
  score: 0,
  combo: 0,
  bestCombo: 0,
  hits: 0,
  misses: 0,
};
