/**
 * Per-song settings persisted to localStorage.
 *
 * Keyed by song source (filename). Stores the user's last selections so
 * coming back to a previously-played song restores difficulty, speed,
 * track choices, and audio preferences.
 */

import type { Difficulty } from './types';

export interface SongSettings {
  playerTrackIdx: number;
  backingSet: number[]; // serialized Set
  difficulty: Difficulty;
  playbackRate: number;
  backingVolume: number;
  backingMuted: boolean;
  monitorVolume: number;
  monitorMuted: boolean;
  noiseSuppress: boolean;
  /** ms to compensate audio interface / mic round-trip latency. Positive = your audio arrives late. Default 0. */
  latencyOffsetMs?: number;
  /** When set, replaces the difficulty preset's pitch tolerance for scoring. */
  customPitchToleranceCents?: number;
  /** Kids mode: chord-to-single-note + 0–5 fret window. Default off. */
  kidsMode?: boolean;
  /** Wait mode: song clock freezes on each note until the right pitch is played. */
  waitMode?: boolean;
}

const KEY_PREFIX = 'lgg-settings:';

function key(songKey: string): string {
  return KEY_PREFIX + songKey;
}

export function loadSettings(songKey: string): SongSettings | null {
  try {
    const raw = localStorage.getItem(key(songKey));
    if (!raw) return null;
    return JSON.parse(raw) as SongSettings;
  } catch (err) {
    console.warn('[songSettings] load failed:', err);
    return null;
  }
}

export function saveSettings(songKey: string, settings: SongSettings): void {
  try {
    localStorage.setItem(key(songKey), JSON.stringify(settings));
  } catch (err) {
    console.warn('[songSettings] save failed:', err);
  }
}

export function deleteSettings(songKey: string): void {
  try {
    localStorage.removeItem(key(songKey));
  } catch {}
}
