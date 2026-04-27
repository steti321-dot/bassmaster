/**
 * Kids Mode helpers — derive a beginner-friendly notes list from a song's
 * player track. Two passes run in sequence:
 *
 *   1. Chord reduction with musical context:
 *        Power chord (root + 5th, possibly + octaves) → keep ROOT (lowest).
 *          The bass/rhythm tracks already carry the root sometimes, but for
 *          power-chord textures playing the root is what feels right.
 *        Full chord (root + 3rd + 5th, etc.)         → keep the 5TH.
 *          Backing tracks usually carry the root, so layering the 5th on
 *          top makes the kid's note sound supportive instead of doubled.
 *        Diminished / sus / no-5th voicings          → fall back to root.
 *      Detection is purely from the chord's pitch-class set — no key
 *      analysis, no Roman-numeral parsing.
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

/**
 * Pick a single note out of a chord group using the power-vs-full rule.
 * `tuning[noteString]` must be defined for every member of `group`.
 */
function pickFromChord(group: GameNote[], tuning: number[]): GameNote {
  if (group.length === 1) return group[0];

  // Compute absolute MIDI for each note + bookkeep the lowest.
  const midis: number[] = group.map((n) => tuning[n.string] + n.fret);
  let rootIdx = 0;
  for (let i = 1; i < midis.length; i++) {
    if (midis[i] < midis[rootIdx]) rootIdx = i;
  }
  const root = midis[rootIdx];
  const rootPc = ((root % 12) + 12) % 12;
  const fifthPc = (rootPc + 7) % 12;

  // Build the pitch-class set so we can classify the chord shape.
  const pcs = new Set<number>();
  for (const m of midis) pcs.add(((m % 12) + 12) % 12);

  // Power chord (or unison/octaves): only root + perfect-5th pitch classes.
  // Either size 1 (just root, in different octaves) or size 2 with the 5th.
  if (pcs.size === 1 || (pcs.size === 2 && pcs.has(fifthPc))) {
    return group[rootIdx];
  }

  // Full chord — find a note whose pitch class is the 5th. If multiple
  // candidates, prefer the one whose absolute MIDI is closest to the root
  // (so we don't pluck a 5th two octaves above the bass note).
  let fifthIdx = -1;
  let fifthDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < midis.length; i++) {
    const pc = ((midis[i] % 12) + 12) % 12;
    if (pc === fifthPc) {
      const d = Math.abs(midis[i] - root);
      if (d < fifthDist) {
        fifthDist = d;
        fifthIdx = i;
      }
    }
  }
  if (fifthIdx >= 0) return group[fifthIdx];

  // Diminished, sus2, sus4-without-5th, or any voicing missing a perfect
  // 5th — fall back to the root.
  return group[rootIdx];
}

export function simplifyForKids(notes: GameNote[], tuning: number[]): GameNote[] {
  // Drum tracks (no tuning data) and empty inputs are returned as-is —
  // simplification only makes sense for stringed-instrument note streams.
  if (!notes || notes.length === 0 || tuning.length === 0) return notes;

  // Step 1 — chord reduction. Group by exact `time` value (parsers emit
  // simultaneous chord notes with identical times) and pick one note via
  // the power-vs-full chord policy.
  const reduced: GameNote[] = [];
  let groupStart = 0;
  for (let i = 1; i <= notes.length; i++) {
    if (i === notes.length || notes[i].time !== notes[groupStart].time) {
      const group = notes.slice(groupStart, i);
      reduced.push(pickFromChord(group, tuning));
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
