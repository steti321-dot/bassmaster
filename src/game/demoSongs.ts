/**
 * Hardcoded demo / kids-default songs so the game has something to render
 * before the user imports their own GP files. These are surfaced in the
 * FilePicker as a "Quick start" section.
 */

import type { Song, GameNote, LyricLine } from './types';
import { fretToHz, BASS, GUITAR } from './Instrument';

/**
 * Queen — Another One Bites The Dust (bass riff).
 *
 * Notes were extracted directly from the GP3 file shipped by the user:
 *   `queen-another_one_bites_the_dust.gp3` → bass track → first 8 bars.
 * See `scripts/extract-queen-bass.mjs` if you ever need to refresh them.
 */
function queenBassIntro(): Song {
  // tempo=110, tuning=[43,38,33,28] (G2 D2 A1 E1) — auto-generated.
  const QUEEN_TEMPO = 110;
  const data: Array<{ time: number; duration: number; string: number; fret: number }> = [
    { time: 1909, duration: 136, string: 3, fret: 5 },
    { time: 2045, duration: 136, string: 3, fret: 3 },
    { time: 2182, duration: 273, string: 3, fret: 0 },
    { time: 2727, duration: 273, string: 3, fret: 0 },
    { time: 3273, duration: 273, string: 3, fret: 0 },
    { time: 4227, duration: 136, string: 3, fret: 0 },
    { time: 4364, duration: 273, string: 3, fret: 0 },
    { time: 4636, duration: 273, string: 3, fret: 0 },
    { time: 4909, duration: 273, string: 3, fret: 3 },
    { time: 5182, duration: 136, string: 3, fret: 0 },
    { time: 5318, duration: 136, string: 3, fret: 5 },
    { time: 6273, duration: 136, string: 3, fret: 5 },
    { time: 6409, duration: 136, string: 3, fret: 3 },
    { time: 6545, duration: 273, string: 3, fret: 0 },
    { time: 7091, duration: 273, string: 3, fret: 0 },
    { time: 7636, duration: 273, string: 3, fret: 0 },
    { time: 8591, duration: 136, string: 3, fret: 0 },
    { time: 8727, duration: 273, string: 3, fret: 0 },
    { time: 9000, duration: 273, string: 3, fret: 0 },
    { time: 9273, duration: 273, string: 3, fret: 3 },
    { time: 9545, duration: 136, string: 3, fret: 0 },
    { time: 9682, duration: 136, string: 3, fret: 5 },
    { time: 10909, duration: 273, string: 3, fret: 0 },
    { time: 11455, duration: 273, string: 3, fret: 0 },
    { time: 12000, duration: 273, string: 3, fret: 0 },
    { time: 12955, duration: 136, string: 3, fret: 0 },
    { time: 13091, duration: 273, string: 3, fret: 0 },
    { time: 13364, duration: 273, string: 3, fret: 0 },
    { time: 13636, duration: 273, string: 3, fret: 3 },
    { time: 13909, duration: 136, string: 3, fret: 0 },
    { time: 14045, duration: 136, string: 3, fret: 5 },
    { time: 15273, duration: 273, string: 3, fret: 0 },
    { time: 15818, duration: 273, string: 3, fret: 0 },
    { time: 16364, duration: 273, string: 3, fret: 0 },
    { time: 17318, duration: 136, string: 3, fret: 0 },
  ];
  const notes: GameNote[] = data.map((n) => ({
    time: n.time,
    duration: n.duration,
    string: n.string,
    fret: n.fret,
    frequency: fretToHz(BASS, n.string, n.fret),
  }));

  const playerTrack = {
    index: 0,
    name: 'Bass — Another One Bites The Dust',
    instrument: 'bass' as const,
    isDrums: false,
    notes,
    tuning: BASS.midiTunings.slice(),
  };
  return {
    title: 'Queen — Another One Bites The Dust (bass)',
    artist: 'Queen',
    tempo: QUEEN_TEMPO,
    tracks: [playerTrack],
    playerTrackIndex: 0,
    // Single-track demo: default the player track ON so Play makes sound.
    backingEnabled: new Set<number>([0]),
    instrument: 'bass',
    notes,
    source: 'builtin:queen-aobtd',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Kids defaults — three popular beginner pieces, all on guitar so they
// share the same tuning and the chord-policy + position-remap stay
// meaningful when Kids Mode is on. Kept simple: one player track each,
// no backing.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a single-note GameNote at a given (string, fret) on the guitar.
 * Helper to keep the song definitions readable.
 */
function gNote(string: number, fret: number, time: number, durationMs: number): GameNote {
  return {
    time,
    duration: durationMs,
    string,
    fret,
    frequency: fretToHz(GUITAR, string, fret),
  };
}

/** Twinkle Twinkle Little Star — first 14 notes on the high strings. */
function twinkleTwinkle(): Song {
  const tempo = 96;
  const quarter = 60000 / tempo;          // 625 ms
  const half = quarter * 2;
  // Guitar string indices (our convention: 0 = high e, 5 = low E):
  //   high e (string 0) = E4, fret 0
  //   B      (string 1) = B3, fret 0
  // Notes used (B / high-e strings, all within fret 5):
  //   C4 = B fret 1   D4 = B fret 3   E4 = e fret 0
  //   F4 = e fret 1   G4 = e fret 3   A4 = e fret 5
  type Step = [string: number, fret: number, dur: number];
  const phrase: Step[] = [
    // "Twinkle twinkle little star"
    [1, 1, quarter], [1, 1, quarter], [0, 3, quarter], [0, 3, quarter],
    [0, 5, quarter], [0, 5, quarter], [0, 3, half],
    // "How I wonder what you are"
    [0, 1, quarter], [0, 1, quarter], [0, 0, quarter], [0, 0, quarter],
    [1, 3, quarter], [1, 3, quarter], [1, 1, half],
  ];

  const notes: GameNote[] = [];
  let t = 800; // brief lead-in so the player can find the first note
  for (const [s, f, d] of phrase) {
    notes.push(gNote(s, f, t, d * 0.9));
    t += d;
  }

  // Hand-aligned lyrics — one syllable per note. Useful as a known-good
  // karaoke test case since most public GP files don't carry lyrics in
  // the per-beat field that the lyrics strip needs.
  const SYLLABLES = [
    'Twin', 'kle', 'twin', 'kle', 'lit', 'tle', 'star',
    'How',  'I',   'won',  'der', 'what', 'you', 'are',
  ];
  const lyrics: LyricLine[] = [];
  notes.forEach((note, i) => {
    // Verse break between "...star" and "How I wonder..." — drives the
    // karaoke line shift even though the two phrases are back-to-back in time.
    if (i === 7) lyrics.push({ time: note.time, text: '', isLineBreak: true });
    lyrics.push({ time: note.time, text: SYLLABLES[i] });
  });

  const playerTrack = {
    index: 0,
    name: 'Twinkle Twinkle — Melody',
    instrument: 'guitar' as const,
    isDrums: false,
    notes,
    tuning: GUITAR.midiTunings.slice(),
  };
  return {
    title: 'Twinkle Twinkle Little Star',
    artist: 'Traditional',
    tempo,
    tracks: [playerTrack],
    playerTrackIndex: 0,
    backingEnabled: new Set<number>([0]), // hear yourself when the synth plays it
    instrument: 'guitar',
    notes,
    lyrics,
    source: 'builtin:twinkle',
  };
}

/**
 * Smoke on the Water (rhythm guitar).
 *
 * Notes extracted from the user's GP4 file:
 *   `deep_purple-smoke_on_the_water_4.gp4` → track 1 "Rythm Guitar".
 * The lick is played as G + D string power-chord pairs at frets 0/3/5/6.
 * With Kids Mode on, the chord-policy reduces each pair to a single note
 * (the D string at the same fret) so beginners can play the iconic riff
 * one-fingered. See `scripts/extract-gp-track.mjs` to refresh.
 */
function smokeOnTheWater(): Song {
  // tempo=120, tuning=[64,59,55,50,45,40] (E4 B3 G3 D3 A2 E2)
  const SOTW_TEMPO = 120;
  const data: Array<{ time: number; duration: number; string: number; fret: number }> = [
    { time: 0, duration: 500, string: 2, fret: 0 },
    { time: 0, duration: 500, string: 3, fret: 0 },
    { time: 500, duration: 500, string: 2, fret: 3 },
    { time: 500, duration: 500, string: 3, fret: 3 },
    { time: 1000, duration: 500, string: 2, fret: 5 },
    { time: 1000, duration: 500, string: 3, fret: 5 },
    { time: 1750, duration: 250, string: 2, fret: 0 },
    { time: 1750, duration: 250, string: 3, fret: 0 },
    { time: 2250, duration: 250, string: 2, fret: 3 },
    { time: 2250, duration: 250, string: 3, fret: 3 },
    { time: 2750, duration: 250, string: 2, fret: 6 },
    { time: 2750, duration: 250, string: 3, fret: 6 },
    { time: 3000, duration: 1000, string: 2, fret: 5 },
    { time: 3000, duration: 1000, string: 3, fret: 5 },
    { time: 4000, duration: 500, string: 2, fret: 0 },
    { time: 4000, duration: 500, string: 3, fret: 0 },
    { time: 4500, duration: 500, string: 2, fret: 3 },
    { time: 4500, duration: 500, string: 3, fret: 3 },
    { time: 5000, duration: 500, string: 2, fret: 5 },
    { time: 5000, duration: 500, string: 3, fret: 5 },
    { time: 5750, duration: 250, string: 2, fret: 3 },
    { time: 5750, duration: 250, string: 3, fret: 3 },
    { time: 6250, duration: 250, string: 2, fret: 0 },
    { time: 6250, duration: 250, string: 3, fret: 0 },
    { time: 8000, duration: 500, string: 2, fret: 0 },
    { time: 8000, duration: 500, string: 3, fret: 0 },
    { time: 8500, duration: 500, string: 2, fret: 3 },
    { time: 8500, duration: 500, string: 3, fret: 3 },
    { time: 9000, duration: 500, string: 2, fret: 5 },
    { time: 9000, duration: 500, string: 3, fret: 5 },
    { time: 9750, duration: 250, string: 2, fret: 0 },
    { time: 9750, duration: 250, string: 3, fret: 0 },
    { time: 10250, duration: 250, string: 2, fret: 3 },
    { time: 10250, duration: 250, string: 3, fret: 3 },
    { time: 10750, duration: 250, string: 2, fret: 6 },
    { time: 10750, duration: 250, string: 3, fret: 6 },
    { time: 11000, duration: 1000, string: 2, fret: 5 },
    { time: 11000, duration: 1000, string: 3, fret: 5 },
    { time: 12000, duration: 500, string: 2, fret: 0 },
    { time: 12000, duration: 500, string: 3, fret: 0 },
    { time: 12500, duration: 500, string: 2, fret: 3 },
    { time: 12500, duration: 500, string: 3, fret: 3 },
    { time: 13000, duration: 500, string: 2, fret: 5 },
    { time: 13000, duration: 500, string: 3, fret: 5 },
    { time: 13750, duration: 250, string: 2, fret: 3 },
    { time: 13750, duration: 250, string: 3, fret: 3 },
    { time: 14250, duration: 250, string: 2, fret: 0 },
    { time: 14250, duration: 250, string: 3, fret: 0 },
  ];
  const notes: GameNote[] = data.map((n) => ({
    time: n.time,
    duration: n.duration,
    string: n.string,
    fret: n.fret,
    frequency: fretToHz(GUITAR, n.string, n.fret),
  }));

  const playerTrack = {
    index: 0,
    name: 'Smoke on the Water — Rhythm Guitar',
    instrument: 'guitar' as const,
    isDrums: false,
    notes,
    tuning: GUITAR.midiTunings.slice(),
  };
  return {
    title: 'Smoke on the Water (rhythm guitar)',
    artist: 'Deep Purple',
    tempo: SOTW_TEMPO,
    tracks: [playerTrack],
    playerTrackIndex: 0,
    backingEnabled: new Set<number>([0]),
    instrument: 'guitar',
    notes,
    source: 'builtin:smoke',
  };
}

/**
 * The Four Chords — G, D, Em, C strummed once each. The progression
 * "I-V-vi-IV" famously powers a huge slice of pop music (Axis of Awesome's
 * 4 Chord Song demo). With Kids Mode on, the chord-policy reduces each
 * strum to a single note (root for the power chord shapes, 5th for the
 * full triads), so a beginner can play one note per bar.
 */
function fourChords(): Song {
  const tempo = 80;
  const beat = 60000 / tempo;             // 750 ms / beat
  const bar = beat * 4;                   // 3000 ms / 4-beat bar

  type ChordVoicing = Array<[string: number, fret: number]>;
  // Open-position voicings, all member notes within fret 0–5.
  // String index: 0 = high e, 1 = B, 2 = G, 3 = D, 4 = A, 5 = low E.
  const G: ChordVoicing = [
    [5, 3], [4, 2], [3, 0], [2, 0], [1, 0], [0, 3],   // G major
  ];
  const D: ChordVoicing = [
    [3, 0], [2, 2], [1, 3], [0, 2],                   // D major (no low strings)
  ];
  const Em: ChordVoicing = [
    [5, 0], [4, 2], [3, 2], [2, 0], [1, 0], [0, 0],   // E minor
  ];
  const C: ChordVoicing = [
    [4, 3], [3, 2], [2, 0], [1, 1], [0, 0],           // C major (no low E)
  ];

  // Two passes through the progression so kids hear a loop.
  const sequence: ChordVoicing[] = [G, D, Em, C, G, D, Em, C];
  const SEQUENCE_NAMES = ['G', 'D', 'E-mi', 'C', 'G', 'D', 'E-mi', 'C'];

  const notes: GameNote[] = [];
  const lyrics: LyricLine[] = [];
  let t = 800;
  sequence.forEach((chord, i) => {
    // One "syllable" per chord change — chord name as the lyric text. Useful
    // both as a karaoke smoke-test and as a beginner reading aid: when you're
    // learning the I-V-vi-IV progression, having the chord name highlight
    // in time with the strum is a real practice cue.
    if (i === 4) lyrics.push({ time: t, text: '', isLineBreak: true });
    lyrics.push({ time: t, text: SEQUENCE_NAMES[i] });
    for (const [s, f] of chord) {
      // Each strum sustains nearly the full bar so the chord rings.
      notes.push(gNote(s, f, t, bar * 0.9));
    }
    t += bar;
  });

  const playerTrack = {
    index: 0,
    name: 'Four Chords — G · D · Em · C',
    instrument: 'guitar' as const,
    isDrums: false,
    notes,
    tuning: GUITAR.midiTunings.slice(),
  };
  return {
    title: 'The Four Chords (G · D · Em · C)',
    artist: 'Practice',
    tempo,
    tracks: [playerTrack],
    playerTrackIndex: 0,
    backingEnabled: new Set<number>([0]),
    instrument: 'guitar',
    notes,
    lyrics,
    source: 'builtin:four-chords',
  };
}

/**
 * Built-in demo songs; the game can load these without any file picker.
 */
export const DEMO_SONGS: { id: string; label: string; build: () => Song }[] = [
  {
    id: 'twinkle-twinkle',
    label: '⭐ Twinkle Twinkle Little Star',
    build: twinkleTwinkle,
  },
  {
    id: 'smoke-on-the-water',
    label: '🎸 Smoke on the Water (intro)',
    build: smokeOnTheWater,
  },
  {
    id: 'four-chords',
    label: '🎵 The Four Chords (G · D · Em · C)',
    build: fourChords,
  },
  {
    id: 'queen-aobtd-intro',
    label: '🎵 Queen — Another One Bites The Dust (bass intro)',
    build: queenBassIntro,
  },
];
