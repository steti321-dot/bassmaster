/**
 * Hardcoded demo songs so the game has something to render before the user
 * imports their own GP files.
 */

import type { Song, GameNote } from './types';
import { fretToHz, BASS } from './Instrument';

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

/**
 * Built-in demo songs; the game can load these without any file picker.
 */
export const DEMO_SONGS: { id: string; label: string; build: () => Song }[] = [
  {
    id: 'queen-aobtd-intro',
    label: '🎵 Queen — Another One Bites The Dust (bass intro)',
    build: queenBassIntro,
  },
];
