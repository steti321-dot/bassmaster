/**
 * Instrument profile — tunings, ranges, fret count, MIDI metadata.
 * Ported from cli/src/instrument.rs so renderer-side game and Tab 1 stay in sync.
 */

export type InstrumentKind = 'guitar' | 'bass';

export interface InstrumentProfile {
  kind: InstrumentKind;
  /** Open-string tunings in Hz, ordered from highest pitch (index 0) to lowest. */
  tuningsHz: number[];
  /** MIDI note numbers per string, same order as tuningsHz. */
  midiTunings: number[];
  /** String name labels, same order. */
  stringLabels: string[];
  /** Color per string (used for note bulbs). */
  stringColors: string[];
  /** Pitch detection lower bound (Hz). */
  minPitchHz: number;
  /** Pitch detection upper bound (Hz). */
  maxPitchHz: number;
  fretCount: number;
  trackName: string;
}

/**
 * Standard 6-string guitar (high E to low E).
 * Colors: Rocksmith-inspired per-string scheme.
 */
export const GUITAR: InstrumentProfile = {
  kind: 'guitar',
  tuningsHz: [329.63, 246.94, 196.0, 146.83, 110.0, 82.41],
  midiTunings: [64, 59, 55, 50, 45, 40],
  stringLabels: ['e', 'B', 'G', 'D', 'A', 'E'],
  stringColors: ['#ff2860', '#ff9d00', '#fff066', '#2dff8b', '#00f5ff', '#ff44ff'],
  minPitchHz: 70,
  maxPitchHz: 1500,
  fretCount: 24,
  trackName: 'Guitar',
};

/**
 * Standard 4-string bass (G to E1).
 * Colors: Rocksmith bass scheme — red/yellow/blue/green per string.
 */
export const BASS: InstrumentProfile = {
  kind: 'bass',
  tuningsHz: [98.0, 73.42, 55.0, 41.2],
  midiTunings: [43, 38, 33, 28],
  stringLabels: ['G', 'D', 'A', 'E'],
  stringColors: ['#2dff8b', '#00f5ff', '#ff9d00', '#ff2860'],
  minPitchHz: 35,
  maxPitchHz: 450,
  fretCount: 24,
  trackName: 'Bass',
};

export function getInstrument(kind: InstrumentKind): InstrumentProfile {
  return kind === 'bass' ? BASS : GUITAR;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Build a profile from arbitrary tuning data — supports 4-string bass,
 * 5-string bass with low B, 7-string guitar, drop-D, etc. The tuning array
 * MUST be ordered high → low (matching `Note.string` index 0 = highest pitch).
 *
 * Used by the game when rendering files whose tuning differs from the
 * canonical BASS/GUITAR profile (e.g. 5-string bass, drop-D, 7-string).
 */
export function buildProfileFromTuning(
  midiTunings: number[],
  kind: InstrumentKind,
): InstrumentProfile {
  if (midiTunings.length === 0) {
    return getInstrument(kind);
  }
  const tuningsHz = midiTunings.map(midiToHz);

  // Letter labels (no octave number — keeps the fretboard column header tidy).
  const stringLabels = midiTunings.map((m) => NOTE_NAMES[((m % 12) + 12) % 12]);

  // 8-color palette covers up to 8-string instruments. We index from the top
  // (highest pitch) downward so the highest string keeps the same colour
  // across instruments — feels consistent across switches.
  const palette = [
    '#ff2860', '#ff9d00', '#fff066', '#2dff8b',
    '#00f5ff', '#ff44ff', '#bb88ff', '#88ffbb',
  ];
  const stringColors = midiTunings.map((_, i) => palette[i % palette.length]);

  const lowestHz = Math.min(...tuningsHz);
  const highestHz = Math.max(...tuningsHz);
  return {
    kind,
    tuningsHz,
    midiTunings: midiTunings.slice(),
    stringLabels,
    stringColors,
    // Pad detection range below the lowest open string and above the highest
    // open string + 24 frets (which is highest * 4 in pitch).
    minPitchHz: Math.max(30, lowestHz * 0.85),
    maxPitchHz: highestHz * 4.2,
    fretCount: 24,
    trackName: kind === 'bass' ? 'Bass' : 'Guitar',
  };
}

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 12-color chromatic palette indexed by pitch class (MIDI mod 12).
 * Each semitone gets its own hue so consecutive notes on the same string
 * look visibly different — making note changes obvious in the note rain.
 */
const PITCH_CLASS_COLORS = [
  '#ff2860', // C   – red
  '#ff5a2c', // C#  – red-orange
  '#ff9d00', // D   – orange
  '#ffc83a', // D#  – amber
  '#fff066', // E   – yellow
  '#bfff5c', // F   – yellow-green
  '#2dff8b', // F#  – green
  '#00ffd5', // G   – teal
  '#00f5ff', // G#  – cyan
  '#5b9bff', // A   – blue
  '#a86bff', // A#  – violet
  '#ff44ff', // B   – magenta
];

/** Return a chip color for a played note based on its pitch class. */
export function pitchClassColor(midi: number): string {
  return PITCH_CLASS_COLORS[((midi % 12) + 12) % 12];
}

/**
 * Convert (string index, fret) to expected frequency for that instrument.
 * String index 0 = highest pitch, matching tuningsHz order.
 */
export function fretToHz(profile: InstrumentProfile, stringIdx: number, fret: number): number {
  const open = profile.tuningsHz[stringIdx];
  if (open === undefined) return 0;
  return open * Math.pow(2, fret / 12);
}
