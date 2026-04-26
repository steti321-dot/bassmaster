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
}

export type Difficulty = 'easy' | 'medium' | 'strict';

export interface DifficultyConfig {
  /** Pitch tolerance, ± cents. */
  pitchToleranceCents: number;
  /** Timing window, ± milliseconds. */
  timingWindowMs: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { pitchToleranceCents: 150, timingWindowMs: 250 },
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
