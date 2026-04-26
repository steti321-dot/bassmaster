/**
 * Helpers for left-hand fingering display + recommendation.
 *
 * Convention: 0=thumb (T), 1=index (1), 2=middle (2), 3=ring (3), 4=pinky (4).
 * Negative or undefined = unknown / open.
 */

export interface FingerSuggestion {
  /** Number to display, or "T" for thumb, or "—" if open. */
  label: string;
  /** Whether this came from the file (true) or was recommended by us (false). */
  fromSource: boolean;
}

/**
 * Recommend a finger for a fret using a simple "one-finger-per-fret" heuristic
 * based on neck position. Good enough for beginners — assumes the hand sits
 * with the index finger anchored at the position closest to the played fret.
 */
export function recommendFinger(fret: number): number | undefined {
  if (fret <= 0) return undefined; // open string — no finger
  // Map fret → finger using "1 finger per fret" within a 4-fret window.
  // Frets 1-4: 1, 2, 3, 4. Frets 5-8: same again. Etc.
  const within = ((fret - 1) % 4) + 1;
  return within;
}

/**
 * Get the finger label to display for a note. Prefers source data when present.
 */
export function fingerLabel(fret: number, sourceFinger?: number): FingerSuggestion {
  if (fret <= 0) {
    return { label: 'open', fromSource: sourceFinger !== undefined };
  }
  if (sourceFinger !== undefined && sourceFinger >= 0) {
    return {
      label: sourceFinger === 0 ? 'T' : String(sourceFinger),
      fromSource: true,
    };
  }
  const rec = recommendFinger(fret);
  return {
    label: rec === undefined ? '—' : String(rec),
    fromSource: false,
  };
}

/** Long-form finger name, for tooltip / accessibility. */
export function fingerName(label: string): string {
  switch (label) {
    case 'T': return 'thumb';
    case '1': return 'index';
    case '2': return 'middle';
    case '3': return 'ring';
    case '4': return 'pinky';
    case 'open': return 'open string';
    default: return 'unknown';
  }
}
