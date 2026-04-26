/**
 * Kids Mode helpers — derive a beginner-friendly notes list from a song's
 * player track. Two passes run in sequence:
 *
 *   1. Chord reduction: collapse simultaneous notes (same `time`) to the
 *      single lowest-pitched note. v1 picks the lowest; the project memory
 *      `project_kids_mode_chord_policy.md` records the planned refinement
 *      (power-chord → root, full-chord → 5th).
 *   2. Position remap with string-smoothing: enumerate every (string, fret)
 *      candidate within the 0–5 fret window producing the same MIDI pitch,
 *      then prefer the candidate matching the PREVIOUS output note's
 *      string — keeping consecutive notes on one string when possible
 *      (kids find single-string runs much easier than string-jumps).
 *
 * The output frequencies are unchanged — only the (string, fret) display
 * positions move — so the existing pitch-detection scoring keeps working.
 */

import type { GameNote } from './types';

const FRET_WINDOW = 5;

export function simplifyForKids(notes: GameNote[], tuning: number[]): GameNote[] {
  // Drum tracks (no tuning data) and empty inputs are returned as-is —
  // simplification only makes sense for stringed-instrument note streams.
  if (!notes || notes.length === 0 || tuning.length === 0) return notes;

  // Step 1 — chord reduction. Group by exact `time` value (parsers emit
  // simultaneous chord notes with identical times) and keep the lowest pitch.
  const reduced: GameNote[] = [];
  let groupStart = 0;
  for (let i = 1; i <= notes.length; i++) {
    if (i === notes.length || notes[i].time !== notes[groupStart].time) {
      if (i - groupStart === 1) {
        reduced.push(notes[groupStart]);
      } else {
        let lowestIdx = groupStart;
        let lowestPitch = tuning[notes[groupStart].string] + notes[groupStart].fret;
        for (let j = groupStart + 1; j < i; j++) {
          const p = tuning[notes[j].string] + notes[j].fret;
          if (p < lowestPitch) {
            lowestPitch = p;
            lowestIdx = j;
          }
        }
        reduced.push(notes[lowestIdx]);
      }
      groupStart = i;
    }
  }

  // Step 2 — position remap with string-smoothing. For each note we
  // enumerate every (string, fret) producing the same MIDI pitch within
  // the 0–5 window, then score each candidate to prefer ones on the
  // PREVIOUS output note's string. This dramatically reduces forced
  // string-jumping for sequences that could fit on a single string.
  //
  // Cost function (lower is better):
  //   same string as prev:     |fret - prevFret|
  //   different string:        100 + |fret - prevFret| + |stringDiff| * 5
  //   open-string bonus:       -1 when fret === 0
  //
  // The 100-unit penalty means a same-string candidate always beats a
  // string change — the open-string bonus only matters as a tie-breaker
  // among same-class candidates.
  let prevString: number | null = null;
  let prevFret = 0;
  return reduced.map((n) => {
    const targetMidi = tuning[n.string] + n.fret;

    // Build the candidate list (always includes the original position
    // when it sits within the window).
    const candidates: Array<{ string: number; fret: number }> = [];
    for (let s = 0; s < tuning.length; s++) {
      const f = targetMidi - tuning[s];
      if (f >= 0 && f <= FRET_WINDOW) candidates.push({ string: s, fret: f });
    }
    if (candidates.length === 0) {
      // High note that can't be reached within the window — keep original.
      // Track it as the new "prev" so subsequent notes can still smooth
      // against the actual played position.
      prevString = n.string;
      prevFret = n.fret;
      return n;
    }

    let best = candidates[0];
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      let cost: number;
      if (prevString === null) {
        // First note in the run — prefer lowest-pitch string voicing
        // (matches v1's behaviour) with a small open-string bonus.
        cost = c.fret + (tuning.length - 1 - c.string) * 0.1;
      } else if (c.string === prevString) {
        cost = Math.abs(c.fret - prevFret);
      } else {
        cost = 100 + Math.abs(c.fret - prevFret) + Math.abs(c.string - prevString) * 5;
      }
      if (c.fret === 0) cost -= 1;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }

    prevString = best.string;
    prevFret = best.fret;
    return best.string === n.string && best.fret === n.fret
      ? n
      : { ...n, string: best.string, fret: best.fret };
  });
}
