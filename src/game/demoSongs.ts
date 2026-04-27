/**
 * Hardcoded demo / kids-default songs so the game has something to render
 * before the user imports their own GP files. These are surfaced in the
 * FilePicker as a "Quick start" section.
 */

import type { Song, GameNote } from './types';
import { fretToHz, BASS, GUITAR } from './Instrument';

/**
 * Queen — Another One Bites The Dust (bass intro, simplified).
 * Iconic 4-bar riff at ~110 BPM, mostly low E open + a couple of frets.
 *
 * Tab (E string, low to high time):
 *   E|--0--0--0----0--3--0----0--1--0--0----0--3--0----|
 */
function queenBassIntro(): Song {
  // Eighth note at 110 BPM = 60000 / 110 / 2 = 272.7 ms
  const eighthMs = 60000 / 110 / 2;
  const E_STRING = 3; // bass: index 3 = lowest = E
  const A_STRING = 2;

  const pattern: Array<{ string: number; fret: number; eighths: number }> = [
    // Bar 1
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 }, // rest-ish
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 3, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    // Bar 2
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 1, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: E_STRING, fret: 3, eighths: 1 },
    { string: E_STRING, fret: 0, eighths: 1 },
    { string: A_STRING, fret: 0, eighths: 1 }, // A string open as a bass walk
  ];

  const notes: GameNote[] = [];
  let t = 1000; // start at 1s so the player has lead-in
  for (const p of pattern) {
    notes.push({
      time: t,
      duration: eighthMs * p.eighths * 0.85,
      string: p.string,
      fret: p.fret,
      frequency: fretToHz(BASS, p.string, p.fret),
    });
    t += eighthMs * p.eighths;
  }

  const playerTrack = {
    index: 0,
    name: 'Bass — Demo',
    instrument: 'bass' as const,
    isDrums: false,
    notes,
    tuning: BASS.midiTunings.slice(),
  };
  return {
    title: 'Queen — Another One Bites The Dust (bass intro, demo)',
    artist: 'Queen',
    tempo: 110,
    tracks: [playerTrack],
    playerTrackIndex: 0,
    // Single-track demo: default the player track ON so Play makes sound.
    backingEnabled: new Set<number>([0]),
    instrument: 'bass',
    notes,
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
    source: 'builtin:twinkle',
  };
}

/** Smoke on the Water — single-note simplified intro lick. */
function smokeOnTheWater(): Song {
  const tempo = 112;
  const eighth = 60000 / tempo / 2;       // ~268 ms
  const quarter = eighth * 2;
  const halfNote = quarter * 2;

  // The lick: G3 - Bb3 - C4 / G3 - Bb3 - Db4 - C4, repeated.
  // All fit on G + B strings inside fret 0–5:
  //   G3  = string 2 (G) fret 0
  //   Bb3 = string 2 fret 3
  //   C4  = string 2 fret 5
  //   Db4 = string 1 (B) fret 2
  type Step = [string: number, fret: number, dur: number];
  const G3: Step = [2, 0, eighth];
  const Bb3: Step = [2, 3, eighth];
  const C4q: Step = [2, 5, quarter];      // landing note is longer
  const Db4: Step = [1, 2, eighth];
  const C4l: Step = [2, 5, halfNote];     // last note rings

  const phrase: Step[] = [
    G3, Bb3, C4q,
    G3, Bb3, Db4, C4l,
  ];

  const notes: GameNote[] = [];
  let t = 800;
  // Two iterations of the lick, separated by an eighth-rest
  for (let rep = 0; rep < 2; rep++) {
    for (const [s, f, d] of phrase) {
      notes.push(gNote(s, f, t, d * 0.9));
      t += d;
    }
    t += eighth; // rest
  }

  const playerTrack = {
    index: 0,
    name: 'Smoke on the Water — Riff',
    instrument: 'guitar' as const,
    isDrums: false,
    notes,
    tuning: GUITAR.midiTunings.slice(),
  };
  return {
    title: 'Smoke on the Water (intro)',
    artist: 'Deep Purple',
    tempo,
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

  const notes: GameNote[] = [];
  let t = 800;
  for (const chord of sequence) {
    for (const [s, f] of chord) {
      // Each strum sustains nearly the full bar so the chord rings.
      notes.push(gNote(s, f, t, bar * 0.9));
    }
    t += bar;
  }

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
